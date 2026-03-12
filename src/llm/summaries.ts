import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import {
  buildDailySummaryContext,
  buildWeeklySummaryContext,
  computeStats,
  loadTrades,
} from '../performance/tracker';
import { logger } from '../utils/logger';
import type { ClosedTrade } from '../types';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set — LLM summaries disabled');
    }
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const response = await getClient().messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

const SYSTEM_PROMPT = `You are a professional trading performance analyst.
You analyze crypto futures trading data and provide concise, actionable summaries.
Keep responses under 400 words. Use plain text — no markdown headers, just short paragraphs.
Be direct. Focus on patterns, what worked, what didn't, and key takeaways.
Never provide financial advice or tell the trader what to do next.`;

// ─── Daily Summary ─────────────────────────────────────────────────────────

export async function generateDailySummary(): Promise<string> {
  try {
    const context = buildDailySummaryContext();
    const stats = computeStats(loadTrades().filter(
      (t) => new Date(t.closedAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
    ));

    if (stats.totalTrades === 0) {
      return '📊 **Daily Summary** — No trades completed today.';
    }

    const response = await callClaude(
      SYSTEM_PROMPT,
      `Here is today's trading data:\n\n${context}\n\nPlease provide a brief daily performance summary.`
    );

    return `📊 **Daily Summary**\n\n${response}`;
  } catch (err) {
    logger.error('Failed to generate daily summary:', err);
    return fallbackDailySummary();
  }
}

// ─── Weekly Summary ────────────────────────────────────────────────────────

export async function generateWeeklySummary(): Promise<string> {
  try {
    const context = buildWeeklySummaryContext();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stats = computeStats(loadTrades().filter((t) => t.closedAt >= weekAgo));

    if (stats.totalTrades === 0) {
      return '📈 **Weekly Summary** — No trades completed this week.';
    }

    const response = await callClaude(
      SYSTEM_PROMPT,
      `Here is this week's trading data:\n\n${context}\n\nPlease provide a weekly performance summary with key insights.`
    );

    return `📈 **Weekly Summary**\n\n${response}`;
  } catch (err) {
    logger.error('Failed to generate weekly summary:', err);
    return fallbackWeeklySummary();
  }
}

// ─── Trade Anomaly Explanation ─────────────────────────────────────────────

export async function explainTrade(trade: ClosedTrade): Promise<string> {
  try {
    const dir = trade.signal.direction;
    const asset = trade.signal.asset.replace('/USDT:USDT', '');
    const pnl = trade.pnlDollar >= 0 ? `+$${trade.pnlDollar.toFixed(2)}` : `-$${Math.abs(trade.pnlDollar).toFixed(2)}`;
    const context = [
      `Asset: ${asset}`,
      `Direction: ${dir}`,
      `Trade type: ${trade.signal.tradeType}`,
      `Strategy: ${trade.signal.strategy}`,
      `Setup score: ${trade.signal.score}/100 (${trade.signal.tier})`,
      `Regime: ${trade.signal.regime}`,
      `Entry: $${trade.entryPrice.toFixed(2)}`,
      `Exit: $${trade.exitPrice.toFixed(2)}`,
      `Result: ${pnl} (${(trade.pnlPct * 100).toFixed(2)}%)`,
      `Exit reason: ${trade.exitReason}`,
      `Notes: ${trade.signal.notes ?? 'none'}`,
    ].join('\n');

    const response = await callClaude(
      SYSTEM_PROMPT,
      `Please briefly explain this trade outcome and what the data suggests about why it performed this way:\n\n${context}`
    );

    return `🔍 **Trade Analysis**\n\n${response}`;
  } catch (err) {
    logger.error('Failed to explain trade:', err);
    return '🔍 Trade analysis unavailable — ANTHROPIC_API_KEY may not be set.';
  }
}

// ─── Fallback summaries (no API key) ──────────────────────────────────────

function fallbackDailySummary(): string {
  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = loadTrades().filter(
    (t) => new Date(t.closedAt).toISOString().slice(0, 10) === today
  );
  const stats = computeStats(todayTrades);
  const pnlStr = stats.totalPnlDollar >= 0 ? `+$${stats.totalPnlDollar.toFixed(2)}` : `-$${Math.abs(stats.totalPnlDollar).toFixed(2)}`;

  return [
    `📊 **Daily Summary** — ${today}`,
    `Trades: ${stats.totalTrades} | W: ${stats.wins} L: ${stats.losses} | WR: ${(stats.winRate * 100).toFixed(0)}%`,
    `P&L: ${pnlStr} | Profit Factor: ${stats.profitFactor.toFixed(2)}`,
    `Avg Setup Score: ${stats.avgScore.toFixed(1)}/100`,
    Object.entries(stats.byStrategy)
      .map(([n, s]) => `  ${n}: ${s.totalTrades} trades, ${(s.winRate * 100).toFixed(0)}% WR`)
      .join('\n'),
  ].join('\n');
}

function fallbackWeeklySummary(): string {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekTrades = loadTrades().filter((t) => t.closedAt >= weekAgo);
  const stats = computeStats(weekTrades);
  const pnlStr = stats.totalPnlDollar >= 0 ? `+$${stats.totalPnlDollar.toFixed(2)}` : `-$${Math.abs(stats.totalPnlDollar).toFixed(2)}`;

  return [
    `📈 **Weekly Summary**`,
    `Trades: ${stats.totalTrades} | W: ${stats.wins} L: ${stats.losses} | WR: ${(stats.winRate * 100).toFixed(0)}%`,
    `P&L: ${pnlStr} | Profit Factor: ${stats.profitFactor.toFixed(2)}`,
    `Scalp WR: ${(stats.byTradeType['SCALP']?.winRate * 100 || 0).toFixed(0)}% | Swing WR: ${(stats.byTradeType['SWING']?.winRate * 100 || 0).toFixed(0)}%`,
    `\nStrategy breakdown:`,
    ...Object.entries(stats.byStrategy).map(
      ([n, s]) => `  ${n}: ${s.totalTrades} trades, ${(s.winRate * 100).toFixed(0)}% WR, avg score ${s.avgScore.toFixed(1)}`
    ),
  ].join('\n');
}
