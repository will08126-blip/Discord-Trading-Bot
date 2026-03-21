import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import type { StrategySignal, PaperTrade, PaperState, ScalpEntryMetadata } from '../types';
import { fetchCurrentPrice, fetchOHLCV } from '../data/marketData';
import type { Asset } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { cachedRsi, cachedAtr, cachedMacd, cachedFVGs, cachedEmaQuickTrend } from '../indicators/cache';
import { volumeAverage } from '../indicators/indicators';

// ─── State persistence ────────────────────────────────────────────────────────

function ensureDataDir(): void {
  fs.mkdirSync(config.paths.data, { recursive: true });
}

export function loadPaperState(): PaperState {
  ensureDataDir();
  try {
    if (fs.existsSync(config.paths.paperStateFile)) {
      const raw = fs.readFileSync(config.paths.paperStateFile, 'utf-8');
      return JSON.parse(raw) as PaperState;
    }
  } catch {
    logger.warn('paperTrading: could not load paper state, using defaults');
  }
  return {
    virtualBalance: config.paper.startingBalance,
    startingBalance: config.paper.startingBalance,
    lastUpdated: new Date().toISOString(),
  };
}

function savePaperState(state: PaperState): void {
  ensureDataDir();
  state.lastUpdated = new Date().toISOString();
  const tmp = config.paths.paperStateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, config.paths.paperStateFile);
}

export function loadPaperTrades(): PaperTrade[] {
  ensureDataDir();
  try {
    if (fs.existsSync(config.paths.paperTradesFile)) {
      const raw = fs.readFileSync(config.paths.paperTradesFile, 'utf-8');
      return JSON.parse(raw) as PaperTrade[];
    }
  } catch {
    logger.warn('paperTrading: could not load paper trades, starting fresh');
  }
  return [];
}

function savePaperTrades(trades: PaperTrade[]): void {
  ensureDataDir();
  const tmp = config.paths.paperTradesFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(trades, null, 2));
  fs.renameSync(tmp, config.paths.paperTradesFile);
}

// ─── Embed builders ────────────────────────────────────────────────────────────

function buildPaperEntryEmbed(trade: PaperTrade): { embeds: EmbedBuilder[] } {
  const assetLabel = trade.asset.split('/')[0];
  const dirEmoji = trade.direction === 'LONG' ? '🟢' : '🔴';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📄 Paper Trade Entered: ${dirEmoji} ${trade.direction} ${assetLabel}`)
    .setDescription(
      `**@ $${trade.entryPrice.toFixed(4)}** | SL: $${trade.stopLoss.toFixed(4)} | TP: $${trade.takeProfit.toFixed(4)}\n` +
      `Size: $${trade.positionSizeDollars.toFixed(2)} | Leverage: ${trade.leverage}x | Strategy: ${trade.strategy}`
    )
    .setTimestamp()
    .setFooter({ text: `Paper Trade • ID: ${trade.id.slice(0, 8)}` });
  return { embeds: [embed] };
}

function buildPaperCloseEmbed(trade: PaperTrade): { embeds: EmbedBuilder[] } {
  const assetLabel = trade.asset.split('/')[0];
  const isWin = (trade.pnlDollar ?? 0) > 0;
  const pnlSign = isWin ? '+' : '';
  const pnlDollar = trade.pnlDollar ?? 0;
  const pnlR = trade.pnlR ?? 0;
  const rSign = pnlR >= 0 ? '+' : '';
  const embed = new EmbedBuilder()
    .setColor(isWin ? 0x00ff87 : 0xff4444)
    .setTitle(`📄 Paper Trade Closed: ${assetLabel} ${isWin ? 'WIN ✅' : 'LOSS ❌'}`)
    .setDescription(
      `**Entry:** $${trade.entryPrice.toFixed(4)} → **Exit:** $${(trade.exitPrice ?? 0).toFixed(4)}\n` +
      `**P&L:** ${pnlSign}$${pnlDollar.toFixed(2)} (${rSign}${pnlR.toFixed(2)}R)\n` +
      `**Reason:** ${trade.closeReason ?? 'unknown'} | **Balance:** $${(trade.balanceAfter ?? 0).toFixed(2)}`
    )
    .setTimestamp()
    .setFooter({ text: `Paper Trade • Strategy: ${trade.strategy}` });
  return { embeds: [embed] };
}

// ─── Core functions ────────────────────────────────────────────────────────────

/**
 * Captures a rich indicator snapshot at the time of paper trade entry.
 * Used later by the 7-day analysis engine to find what correlates with wins.
 */
async function captureEntryMetadata(
  signal: StrategySignal,
  currentPrice: number,
): Promise<ScalpEntryMetadata | undefined> {
  try {
    const asset = signal.asset as Asset;
    const [candles1m, candles5m, candles15m] = await Promise.all([
      fetchOHLCV(asset, '1m', 50).catch(() => null),
      fetchOHLCV(asset, '5m', 50).catch(() => null),
      fetchOHLCV(asset, '15m', 30).catch(() => null),
    ]);

    const now = new Date();
    const meta: ScalpEntryMetadata = {
      hourUTC: now.getUTCHours(),
      dayOfWeekUTC: now.getUTCDay(),
      rsi5m: NaN,
      macdHist5m: NaN,
      macdCrossed5m: false,
      trend5m: 'NEUTRAL',
      rsi1m: NaN,
      atr1m: NaN,
      volumeRatio1m: 1,
      trend15m: 'NEUTRAL',
      rsi15m: NaN,
      hasFVG: false,
      fvgType: 'NONE',
      fvgStrength: 0,
      signalScore: signal.score,
      signalTier: signal.tier,
      regime: signal.regime,
      stopDistPct: Math.abs(currentPrice - signal.stopLoss) / currentPrice,
    };

    if (candles5m && candles5m.length >= 20) {
      const n5 = candles5m.length - 1;
      meta.rsi5m   = cachedRsi(candles5m, 14)[n5] ?? NaN;
      meta.trend5m = cachedEmaQuickTrend(candles5m, 8, 21);
      const macd5  = cachedMacd(candles5m, 5, 13, 3);
      meta.macdHist5m = macd5.histogram[n5] ?? NaN;
      const prevHist  = macd5.histogram[n5 - 1] ?? NaN;
      const prevMacd  = macd5.macdLine[n5 - 1] ?? NaN;
      const prevSig   = macd5.signalLine[n5 - 1] ?? NaN;
      const curMacd   = macd5.macdLine[n5] ?? NaN;
      const curSig    = macd5.signalLine[n5] ?? NaN;
      meta.macdCrossed5m =
        !isNaN(prevMacd) && !isNaN(prevSig) && !isNaN(curMacd) && !isNaN(curSig) &&
        ((prevMacd <= prevSig && curMacd > curSig) || (prevMacd >= prevSig && curMacd < curSig));
      void prevHist; // suppress unused

      // FVG check on 5m
      const fvgs5m = cachedFVGs(candles5m, 5);
      const isLong = signal.direction === 'LONG';
      const nearby = fvgs5m.filter(
        (z) => Math.abs(z.midpoint - currentPrice) / currentPrice <= 0.015 &&
               (isLong ? z.type === 'BULLISH' : z.type === 'BEARISH')
      );
      if (nearby.length > 0) {
        meta.hasFVG      = true;
        meta.fvgType     = nearby[0].type;
        meta.fvgStrength = nearby[0].strength;
      }
    }

    if (candles1m && candles1m.length >= 15) {
      const n1 = candles1m.length - 1;
      meta.rsi1m  = cachedRsi(candles1m, 14)[n1] ?? NaN;
      meta.atr1m  = cachedAtr(candles1m, 14)[n1] ?? NaN;
      const volAvg = volumeAverage(candles1m, 20);
      meta.volumeRatio1m = volAvg > 0 ? (candles1m[n1].volume / volAvg) : 1;

      // FVG on 1m overrides 5m if present (more precise)
      if (!meta.hasFVG) {
        const fvgs1m = cachedFVGs(candles1m, 8);
        const isLong = signal.direction === 'LONG';
        const nearby = fvgs1m.filter(
          (z) => Math.abs(z.midpoint - currentPrice) / currentPrice <= 0.015 &&
                 (isLong ? z.type === 'BULLISH' : z.type === 'BEARISH')
        );
        if (nearby.length > 0) {
          meta.hasFVG      = true;
          meta.fvgType     = nearby[0].type;
          meta.fvgStrength = nearby[0].strength;
        }
      }
    }

    if (candles15m && candles15m.length >= 20) {
      const n15 = candles15m.length - 1;
      meta.rsi15m   = cachedRsi(candles15m, 14)[n15] ?? NaN;
      meta.trend15m = cachedEmaQuickTrend(candles15m, 8, 21);
    }

    return meta;
  } catch (err) {
    logger.warn(`paperTrading: captureEntryMetadata failed for ${signal.asset}: ${err}`);
    return undefined;
  }
}

export async function enterPaperTrade(
  signal: StrategySignal,
  currentPrice: number,
  channel: TextChannel
): Promise<void> {
  if (!config.paper.enabled) return;

  try {
    const state = loadPaperState();
    const riskDollars = state.virtualBalance * 0.02; // 2% risk per trade
    const stopDistPct = Math.abs(currentPrice - signal.stopLoss) / currentPrice;
    const leverage = stopDistPct > 0 ? Math.min(Math.round(0.02 / stopDistPct), 100) : 10;

    // Capture rich indicator snapshot asynchronously (don't block on failure)
    const meta = await captureEntryMetadata(signal, currentPrice);

    const trade: PaperTrade = {
      id: uuidv4(),
      asset: signal.asset,
      direction: signal.direction,
      entryPrice: currentPrice,
      currentPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      positionSizeDollars: riskDollars,
      leverage,
      strategy: signal.strategy,
      tradeType: signal.tradeType,
      status: 'active',
      openTime: new Date().toISOString(),
      meta,
    };

    const trades = loadPaperTrades();
    trades.push(trade);
    savePaperTrades(trades);

    await channel.send(buildPaperEntryEmbed(trade));
    logger.info(`paperTrading: entered ${trade.direction} ${trade.asset} @ ${currentPrice} (id=${trade.id.slice(0, 8)})`);
  } catch (err) {
    logger.error('paperTrading: enterPaperTrade error:', err);
  }
}

export async function checkPaperPositions(channel: TextChannel): Promise<void> {
  if (!config.paper.enabled) return;

  const trades = loadPaperTrades();
  const activeTrades = trades.filter((t) => t.status === 'active');
  if (activeTrades.length === 0) return;

  const state = loadPaperState();
  let stateChanged = false;
  let tradesChanged = false;

  for (const trade of activeTrades) {
    try {
      const currentPrice = await fetchCurrentPrice(trade.asset as Asset);
      trade.currentPrice = currentPrice;
      tradesChanged = true;

      const isLong = trade.direction === 'LONG';
      const hitSL = isLong ? currentPrice <= trade.stopLoss : currentPrice >= trade.stopLoss;
      const hitTP = isLong ? currentPrice >= trade.takeProfit : currentPrice <= trade.takeProfit;

      if (hitSL || hitTP) {
        const exitPrice = currentPrice;
        const pnlPct = isLong
          ? (exitPrice - trade.entryPrice) / trade.entryPrice
          : (trade.entryPrice - exitPrice) / trade.entryPrice;
        const stopDistPct = Math.abs(trade.entryPrice - trade.stopLoss) / trade.entryPrice;
        const pnlR = stopDistPct > 0 ? pnlPct / stopDistPct : 0;
        // Dollar P&L = pnl% * notional value
        const notional = trade.positionSizeDollars * trade.leverage;
        const pnlDollar = pnlPct * notional;

        const closeTime = new Date().toISOString();
        const holdMinutes = Math.round(
          (new Date(closeTime).getTime() - new Date(trade.openTime).getTime()) / 60000
        );
        trade.status = 'closed';
        trade.closeTime = closeTime;
        trade.exitPrice = exitPrice;
        trade.pnlDollar = pnlDollar;
        trade.pnlR = pnlR;
        trade.pnlPct = pnlPct;
        trade.holdMinutes = holdMinutes;
        trade.closeReason = hitTP ? 'TP hit' : 'SL hit';
        trade.balanceAfter = state.virtualBalance + pnlDollar;

        state.virtualBalance += pnlDollar;
        stateChanged = true;

        await channel.send(buildPaperCloseEmbed(trade));
        logger.info(
          `paperTrading: closed ${trade.direction} ${trade.asset} — ` +
          `${trade.closeReason} P&L=$${pnlDollar.toFixed(2)} (${pnlR.toFixed(2)}R) balance=$${state.virtualBalance.toFixed(2)}`
        );
      }
    } catch (err) {
      logger.warn(`paperTrading: error checking position ${trade.id.slice(0, 8)}:`, err);
    }
  }

  if (tradesChanged) savePaperTrades(trades);
  if (stateChanged) savePaperState(state);
}

export async function closePaperPosition(
  tradeId: string,
  channel: TextChannel,
  reason: 'EMA breakdown' | 'manual' = 'manual'
): Promise<void> {
  const trades = loadPaperTrades();
  const trade = trades.find((t) => t.id === tradeId && t.status === 'active');
  if (!trade) return;

  const state = loadPaperState();
  try {
    const currentPrice = await fetchCurrentPrice(trade.asset as Asset);
    const isLong = trade.direction === 'LONG';
    const pnlPct = isLong
      ? (currentPrice - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - currentPrice) / trade.entryPrice;
    const stopDistPct = Math.abs(trade.entryPrice - trade.stopLoss) / trade.entryPrice;
    const pnlR = stopDistPct > 0 ? pnlPct / stopDistPct : 0;
    const notional = trade.positionSizeDollars * trade.leverage;
    const pnlDollar = pnlPct * notional;

    trade.status = 'closed';
    trade.closeTime = new Date().toISOString();
    trade.exitPrice = currentPrice;
    trade.pnlDollar = pnlDollar;
    trade.pnlR = pnlR;
    trade.closeReason = reason;
    trade.balanceAfter = state.virtualBalance + pnlDollar;

    state.virtualBalance += pnlDollar;
    savePaperTrades(trades);
    savePaperState(state);

    await channel.send(buildPaperCloseEmbed(trade));
  } catch (err) {
    logger.error('paperTrading: closePaperPosition error:', err);
  }
}

// ─── Stats & query functions ───────────────────────────────────────────────────

export interface PaperStats {
  virtualBalance: number;
  startingBalance: number;
  balanceChangePct: number;
  openPositions: number;
  todayTrades: number;
  todayWins: number;
  todayLosses: number;
  todayPnlDollar: number;
  allTimeTrades: number;
  allTimeWins: number;
  winRate: number;
  totalPnlDollar: number;
  profitFactor: number;
  currentStreak: number;
  streakType: 'win' | 'loss' | 'none';
  lastUpdated: string;
}

export function getPaperStats(): PaperStats {
  const state = loadPaperState();
  const trades = loadPaperTrades();
  const closed = trades.filter((t) => t.status === 'closed');
  const open = trades.filter((t) => t.status === 'active');
  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = closed.filter((t) => (t.closeTime ?? '').slice(0, 10) === today);
  const todayWins = todayTrades.filter((t) => (t.pnlDollar ?? 0) > 0);
  const todayLosses = todayTrades.filter((t) => (t.pnlDollar ?? 0) <= 0);

  const wins = closed.filter((t) => (t.pnlDollar ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnlDollar ?? 0) <= 0);
  const grossProfit = wins.reduce((s, t) => s + (t.pnlDollar ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnlDollar ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  // Current streak
  let streak = 0;
  let streakType: 'win' | 'loss' | 'none' = 'none';
  for (let i = closed.length - 1; i >= 0; i--) {
    const pnl = closed[i].pnlDollar ?? 0;
    const isWin = pnl > 0;
    if (streak === 0) {
      streakType = isWin ? 'win' : 'loss';
      streak = 1;
    } else if ((isWin && streakType === 'win') || (!isWin && streakType === 'loss')) {
      streak++;
    } else {
      break;
    }
  }

  return {
    virtualBalance: state.virtualBalance,
    startingBalance: state.startingBalance,
    balanceChangePct: (state.virtualBalance - state.startingBalance) / state.startingBalance,
    openPositions: open.length,
    todayTrades: todayTrades.length,
    todayWins: todayWins.length,
    todayLosses: todayLosses.length,
    todayPnlDollar: todayTrades.reduce((s, t) => s + (t.pnlDollar ?? 0), 0),
    allTimeTrades: closed.length,
    allTimeWins: wins.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    totalPnlDollar: grossProfit - grossLoss,
    profitFactor,
    currentStreak: streak,
    streakType: closed.length > 0 ? streakType : 'none',
    lastUpdated: state.lastUpdated,
  };
}

export function getOpenPaperPositions(): PaperTrade[] {
  return loadPaperTrades().filter((t) => t.status === 'active');
}

export function getPaperHistory(count: number): PaperTrade[] {
  const trades = loadPaperTrades().filter((t) => t.status === 'closed');
  return trades.slice(-count).reverse();
}

export function getTodayPaperTrades(): PaperTrade[] {
  const today = new Date().toISOString().slice(0, 10);
  return loadPaperTrades().filter(
    (t) => t.status === 'closed' && (t.closeTime ?? '').slice(0, 10) === today
  );
}

export function getPaperTradesByPeriod(period: 'daily' | 'weekly' | 'all'): PaperTrade[] {
  const trades = loadPaperTrades().filter((t) => t.status === 'closed');
  if (period === 'all') return trades;
  const now = Date.now();
  const cutoff = period === 'daily'
    ? new Date().toISOString().slice(0, 10)
    : null;
  if (period === 'daily') {
    return trades.filter((t) => (t.closeTime ?? '').slice(0, 10) === cutoff);
  }
  // weekly
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  return trades.filter((t) => t.closeTime && new Date(t.closeTime).getTime() >= weekAgo);
}

export function getPaperBalanceJourney(): { starting: number; peak: number; current: number } {
  const state = loadPaperState();
  const trades = loadPaperTrades().filter((t) => t.status === 'closed');
  let peak = state.startingBalance;
  let running = state.startingBalance;
  for (const t of trades) {
    running += t.pnlDollar ?? 0;
    if (running > peak) peak = running;
  }
  return { starting: state.startingBalance, peak, current: state.virtualBalance };
}

export function buildDailyPaperReportEmbed(date: string) {
  const trades = loadPaperTrades().filter(
    (t) => t.status === 'closed' && (t.closeTime ?? '').slice(0, 10) === date
  );
  const state = loadPaperState();
  const wins = trades.filter((t) => (t.pnlDollar ?? 0) > 0);
  const losses = trades.filter((t) => (t.pnlDollar ?? 0) <= 0);
  const netPnl = trades.reduce((s, t) => s + (t.pnlDollar ?? 0), 0);
  const bestTrade = trades.reduce<PaperTrade | null>((best, t) =>
    best === null || (t.pnlDollar ?? 0) > (best.pnlDollar ?? 0) ? t : best, null);
  const worstTrade = trades.reduce<PaperTrade | null>((worst, t) =>
    worst === null || (t.pnlDollar ?? 0) < (worst.pnlDollar ?? 0) ? t : worst, null);

  // Best strategy today
  const stratStats: Record<string, { pnl: number; count: number }> = {};
  for (const t of trades) {
    if (!stratStats[t.strategy]) stratStats[t.strategy] = { pnl: 0, count: 0 };
    stratStats[t.strategy].pnl += t.pnlDollar ?? 0;
    stratStats[t.strategy].count++;
  }
  const bestStrategy = Object.entries(stratStats)
    .sort((a, b) => b[1].pnl - a[1].pnl)[0]?.[0] ?? 'N/A';

  const isProfit = netPnl >= 0;
  const embed = new EmbedBuilder()
    .setColor(trades.length === 0 ? 0x5865f2 : isProfit ? 0x00ff87 : 0xff4444)
    .setTitle(`📊 Daily Paper Trading Report — ${date}`)
    .addFields(
      {
        name: '📈 Today\'s Trades',
        value: trades.length === 0
          ? 'No paper trades today.'
          : [
              `Trades: **${trades.length}** (W: ${wins.length} / L: ${losses.length})`,
              `Net P&L: **${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}**`,
              bestTrade ? `Best: ${bestTrade.asset.split('/')[0]} **+$${(bestTrade.pnlDollar ?? 0).toFixed(2)}**` : '',
              worstTrade ? `Worst: ${worstTrade.asset.split('/')[0]} **$${(worstTrade.pnlDollar ?? 0).toFixed(2)}**` : '',
            ].filter(Boolean).join('\n'),
        inline: false,
      },
      {
        name: '💰 Balance',
        value: [
          `Current: **$${state.virtualBalance.toFixed(2)}**`,
          `Starting: $${state.startingBalance.toFixed(2)}`,
          `Best Strategy: ${bestStrategy}`,
        ].join('\n'),
        inline: false,
      }
    )
    .setTimestamp()
    .setFooter({ text: 'Use /paper-performance for full breakdown' });

  return { embeds: [embed] };
}
