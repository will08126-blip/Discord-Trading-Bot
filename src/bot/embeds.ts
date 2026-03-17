import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { StrategySignal, ActivePosition, ClosedTrade } from '../types';
import { calculateRisk, formatPrice } from '../risk/riskCalculator';
import { regimeLabel } from '../regime/regimeDetector';
import { tierEmoji, tierColor } from '../scoring/votingEngine';
import type { SingleAssetScanResult } from '../engine';
import { config } from '../config';

const LINE = '━━━━━━━━━━━━━━━━━━━━━━━';

function dirEmoji(dir: string): string {
  return dir === 'LONG' ? '🟢' : '🔴';
}

function pct(price: number, reference: number): string {
  const p = ((price - reference) / reference) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

/**
 * Renders a 10-dot emoji scale showing capital deployment confidence.
 * Dot colour reflects conviction level; unfilled dots are shown as ⚪.
 *
 *   score ≥ 70 → 🟢  |  40–69 → 🟡  |  < 40 → 🔴
 *
 * Example (score 82):
 *   🟢🟢🟢🟢🟢🟢🟢🟢🟡⚪  82/100
 *   VERY HIGH — strong conditions to size up
 */
function buildDeploymentMeter(score: number): string {
  const filled = Math.round(score / 10);
  const dot = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
  const dots = dot.repeat(filled) + '⚪'.repeat(10 - filled);

  const label =
    score >= 80 ? 'VERY HIGH — strong conditions to size up' :
    score >= 60 ? 'HIGH — solid conditions' :
    score >= 40 ? 'MODERATE — be selective with size' :
                  'LOW — consider sitting this one out';

  return `${dots}  ${score}/100\n${label}`;
}

// ─── Signal embed ─────────────────────────────────────────────────────────────

export function buildSignalEmbed(signal: StrategySignal) {
  const risk = calculateRisk(signal);
  const asset = signal.asset.split('/')[0];
  const entry = risk.entryPrice;

  const title = `${tierEmoji(signal.tier)} ${signal.tier} ${signal.direction}  —  ${asset}/USDT`;
  const tradeTypeLabel = signal.tradeType === 'SCALP' ? '⚡ Scalp' : signal.tradeType === 'HYBRID' ? '🔀 Hybrid' : '🌊 Swing';

  const embed = new EmbedBuilder()
    .setColor(tierColor(signal.tier))
    .setTitle(title)
    .setDescription(
      `**Strategy:** ${signal.strategy}  |  ${tradeTypeLabel}  |  **Score:** ${signal.score}/100\n` +
      `**Regime:** ${regimeLabel(signal.regime)}`
    )
    .addFields(
      {
        name: LINE,
        value: [
          `📍 **Entry Zone:**  ${formatPrice(signal.entryZone[0], asset)} – ${formatPrice(signal.entryZone[1], asset)}`,
          `🎯 **Take Profit:** ${formatPrice(signal.takeProfit, asset)}  (${pct(signal.takeProfit, entry)})`,
          `📐 **R:R:** ${risk.rewardRiskRatio.toFixed(2)}:1  |  **Lev:** ${risk.suggestedLeverage}x`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '💰 Capital Deployment Confidence',
        value: buildDeploymentMeter(risk.deploymentScore),
        inline: false,
      },
      {
        name: LINE,
        value: [
          `HTF Align ${signal.components.htfAlignment}/20  |  Setup ${signal.components.setupQuality}/20  |  Momentum ${signal.components.momentum}/15`,
          `Volatility ${signal.components.volatilityQuality}/10  |  Regime ${signal.components.regimeFit}/10  |  Liquidity ${signal.components.liquidity}/10`,
          `Slippage ${signal.components.slippageRisk}/5  |  Session ${signal.components.sessionQuality}/5  |  Perf ${signal.components.recentPerformance}/5`,
          signal.notes ? `\n📝 ${signal.notes}` : '',
        ].filter(Boolean).join('\n'),
        inline: false,
      },
      {
        name: LINE,
        value: '**Took this trade on your exchange?** Click ✅ **Entered** below — the bot will track it for you and alert you when to exit.',
        inline: false,
      }
    )
    .setTimestamp(signal.timestamp)
    .setFooter({ text: `Signal ID: ${signal.id.slice(0, 8)}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`enter:${signal.id}`)
      .setLabel(`Entered ${signal.direction}`)
      .setStyle(signal.direction === 'LONG' ? ButtonStyle.Success : ButtonStyle.Danger)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`dismiss:${signal.id}`)
      .setLabel('Dismiss')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❌')
  );

  return { embeds: [embed], components: [row] };
}

// ─── Position tracking embed ──────────────────────────────────────────────────

export function buildPositionEmbed(position: ActivePosition, currentPrice?: number) {
  const asset = position.signal.asset.split('/')[0];
  const isLong = position.signal.direction === 'LONG';

  const unrealizedPnlPct = currentPrice
    ? (isLong
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice)
    : null;

  const pnlLine = unrealizedPnlPct !== null
    ? `📊 **Unrealised P&L:** ${unrealizedPnlPct >= 0 ? '+' : ''}${(unrealizedPnlPct * 100).toFixed(2)}%`
    : '';

  const priceLine = currentPrice
    ? `💹 **Current Price:** ${formatPrice(currentPrice, asset)}`
    : '';

  const embed = new EmbedBuilder()
    .setColor(isLong ? 0x00cc44 : 0xff4444)
    .setTitle(`${dirEmoji(position.signal.direction)} TRACKING: ${asset} ${position.signal.direction}`)
    .setDescription('Your trade is being tracked. When you close it on your exchange, click **Close Position** below — the bot will fetch the current price for you.')
    .addFields({
      name: LINE,
      value: [
        `📍 **Entry:** ${formatPrice(position.entryPrice, asset)}`,
        `🎯 **Current TP:** ${formatPrice(position.currentTakeProfit, asset)}  ${
          position.currentTakeProfit !== position.signal.takeProfit ? '*(extended)*' : ''
        }`,
        priceLine,
        pnlLine,
        `📐 **Leverage:** ${position.suggestedLeverage}x`,
        `⚡ **Type:** ${position.signal.tradeType}  |  **Strategy:** ${position.signal.strategy}`,
      ].filter(Boolean).join('\n'),
      inline: false,
    })
    .setTimestamp()
    .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`closePosition:${position.id}`)
      .setLabel('Close Position')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔴')
  );

  return { embeds: [embed], components: [closeRow] };
}

// ─── Exit alert embed ─────────────────────────────────────────────────────────

export function buildExitAlertEmbed(
  position: ActivePosition,
  type: 'TP_APPROACH' | 'TP_HIT' | 'SL_APPROACH',
  currentPrice: number,
  newTP?: number
) {
  const asset = position.signal.asset.split('/')[0];
  const isLong = position.signal.direction === 'LONG';

  const labels: Record<string, { emoji: string; title: string; color: number; desc: string }> = {
    TP_APPROACH: { emoji: '🔔', title: 'TP APPROACHING',      color: 0x00ccff, desc: 'Price is near your take profit. Consider locking in gains.' },
    TP_HIT:      { emoji: '🎯', title: 'TAKE PROFIT HIT',     color: 0x00ff00, desc: 'Your take profit has been hit. Exit the trade on your exchange, then click **Close Position** below to record it.' },
    SL_APPROACH: { emoji: '⚠️', title: 'STOP LOSS NEARBY',   color: 0xff6600, desc: 'Price is closing in on your stop loss. Assess whether you still want to hold or cut early.' },
  };

  const { emoji, title, color, desc } = labels[type];
  const pnlPct = isLong
    ? (currentPrice - position.entryPrice) / position.entryPrice
    : (position.entryPrice - currentPrice) / position.entryPrice;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} ${asset} ${position.signal.direction} — ${title}`)
    .setDescription(desc)
    .addFields({
      name: LINE,
      value: [
        `💹 **Current Price:** ${formatPrice(currentPrice, asset)}`,
        `📍 **Entry:** ${formatPrice(position.entryPrice, asset)}`,
        newTP ? `🎯 **TP (updated):** ${formatPrice(newTP, asset)}` : `🎯 **TP:** ${formatPrice(position.currentTakeProfit, asset)}`,
        `📊 **Unrealised P&L:** ${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(2)}%`,
      ].filter(Boolean).join('\n'),
      inline: false,
    })
    .setTimestamp()
    .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`closePosition:${position.id}`)
      .setLabel('Close Position')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔴')
  );

  return { embeds: [embed], components: [closeRow] };
}

// ─── TP update embed ──────────────────────────────────────────────────────────

export function buildTPUpdateEmbed(
  position: ActivePosition,
  oldTP: number,
  newTP: number,
  currentPrice: number
) {
  const asset = position.signal.asset.split('/')[0];
  const embed = new EmbedBuilder()
    .setColor(0x8888ff)
    .setTitle(`🔄 ${asset} ${position.signal.direction} — Take Profit Extended`)
    .addFields({
      name: 'Level Changes',
      value: [
        `🎯 TP: ${formatPrice(oldTP, asset)} → **${formatPrice(newTP, asset)}**`,
        `💹 Current: ${formatPrice(currentPrice, asset)}`,
      ].join('\n'),
      inline: false,
    })
    .setTimestamp()
    .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });

  return { embeds: [embed] };
}

// ─── /check summary embed ─────────────────────────────────────────────────────

export function buildCheckSummaryEmbed(result: SingleAssetScanResult) {
  const assetLabel = result.asset.split('/')[0];
  const regimeStr = result.regime ? regimeLabel(result.regime.regime) : 'Unknown';
  const adxStr = result.regime ? ` (ADX: ${result.regime.adx.toFixed(1)}, ATR×: ${result.regime.atrRatio.toFixed(2)})` : '';

  const strategyNames = ['Trend Pullback', 'Breakout Retest', 'Liquidity Sweep', 'Volatility Expansion'];
  const signalsByStrategy = new Map(result.signals.map((s) => [s.strategy, s]));

  const strategyLines = strategyNames.map((name) => {
    const s = signalsByStrategy.get(name);
    if (!s) return `**${name}** — no pattern detected`;
    const risk = calculateRisk(s);
    return (
      `**${name}** — ${dirEmoji(s.direction)} ${s.direction}  |  ` +
      `Score: **${s.score}/100** ${tierEmoji(s.tier)}  |  ` +
      `Lev: **${risk.suggestedLeverage}x**  |  Deploy: **${risk.deploymentScore}/100**`
    );
  });

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🔍 ${assetLabel}/USDT — Manual Scan`)
    .setDescription(`**Regime:** ${regimeStr}${adxStr}`)
    .addFields({
      name: LINE,
      value: strategyLines.join('\n'),
      inline: false,
    })
    .setTimestamp()
    .setFooter({ text: 'Qualifying signals (score ≥ 60) posted below with full details' });
}

// ─── /watchlist + /live summary embed ─────────────────────────────────────────

export function buildWatchlistEmbed(results: SingleAssetScanResult[], isLive = false) {
  const lines = results.map((result) => {
    const assetLabel = result.asset.split('/')[0];

    if (result.error) {
      return `**${assetLabel}** — ⚠️ fetch error`;
    }

    const regimeStr = result.regime ? regimeLabel(result.regime.regime) : '?';
    const qualifying = result.signals.filter((s) => s.tier !== 'NO_TRADE');

    if (qualifying.length === 0) {
      return `**${assetLabel}** — no setup  *(${regimeStr})*`;
    }

    return qualifying.map((s) => {
      const risk = calculateRisk(s);
      return (
        `**${assetLabel}** ${dirEmoji(s.direction)} ${s.direction}  |  ` +
        `Score: **${s.score}** ${tierEmoji(s.tier)}  |  ` +
        `Lev: **${risk.suggestedLeverage}x**  |  Deploy: **${risk.deploymentScore}/100**  ` +
        `*(${s.strategy})*`
      );
    }).join('\n');
  });

  const title = isLive ? '📡 Live Watchlist — BTC · ETH · SOL · XRP · PEPE' : '📊 Watchlist Scan — BTC · ETH · SOL · XRP · PEPE';
  const footer = isLive ? `🔄 Auto-refreshes every ${config.engine.scanIntervalMinutes} min — use /live stop to stop` : 'Use /check <symbol> for full signal details';

  const fullValue = lines.join('\n') || 'No setups found across watchlist.';
  // Discord embed field values must be ≤1024 chars — truncate if needed
  const fieldValue = fullValue.length > 1024 ? fullValue.slice(0, 1021) + '…' : fullValue;

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(title)
        .addFields({ name: LINE, value: fieldValue, inline: false })
        .setTimestamp()
        .setFooter({ text: footer }),
    ],
  };
}

// ─── Early profit alert embed ─────────────────────────────────────────────────

export function buildEarlyProfitAlertEmbed(
  position: ActivePosition,
  currentPrice: number,
  returnOnCapital: number,   // fraction, e.g. 0.50 = 50%
  milestone: number          // the specific milestone hit (same as returnOnCapital floored to milestone)
) {
  const asset = position.signal.asset.split('/')[0];
  const isLong = position.signal.direction === 'LONG';
  const pnlPct = isLong
    ? (currentPrice - position.entryPrice) / position.entryPrice
    : (position.entryPrice - currentPrice) / position.entryPrice;

  // Pick emoji based on milestone magnitude
  const milestoneEmoji = milestone >= 3.0 ? '🚀' : milestone >= 1.5 ? '💎' : milestone >= 0.75 ? '💰' : '✅';
  const milestoneLabel = `+${(milestone * 100).toFixed(0)}% Capital`;

  const embed = new EmbedBuilder()
    .setColor(milestone >= 1.5 ? 0x00ff87 : 0xFFD700)
    .setTitle(`${milestoneEmoji} ${asset} ${position.signal.direction} — Profit Milestone: ${milestoneLabel}`)
    .setDescription(
      `Position has returned **+${(returnOnCapital * 100).toFixed(0)}%** on capital ` +
      `at **${position.suggestedLeverage}x** leverage. Consider taking partial profits or tightening your stop.`
    )
    .addFields({
      name: LINE,
      value: [
        `💹 **Current Price:** ${formatPrice(currentPrice, asset)}`,
        `📍 **Entry:** ${formatPrice(position.entryPrice, asset)}`,
        `📊 **Price Move:** +${(pnlPct * 100).toFixed(2)}%`,
        `💰 **Capital Return (${position.suggestedLeverage}x):** +${(returnOnCapital * 100).toFixed(0)}%`,
        `🎯 **Full TP:** ${formatPrice(position.currentTakeProfit, asset)}`,
      ].join('\n'),
      inline: false,
    })
    .setTimestamp()
    .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`closePosition:${position.id}`)
      .setLabel('Close Position')
      .setStyle(ButtonStyle.Success)
      .setEmoji('💰')
  );

  return { embeds: [embed], components: [closeRow] };
}

// ─── Position health update embed ─────────────────────────────────────────────
// Posted every 15 min or when price moves ≥1% — shows live confidence meter,
// P&L, and a verdict on whether the trade setup is still intact.

/**
 * Live confidence score (0-100) based on current indicators.
 * Unlike the deployment score (which is fixed at signal time), this recalculates
 * every health check so the meter reflects what the trade looks like RIGHT NOW.
 *
 *   EMA9 alignment  (0-35) — is price still on the right side of short-term trend?
 *   RSI health       (0-30) — not overextended or collapsing
 *   P&L direction    (0-20) — positive momentum adds confidence
 *   Time in window   (0-15) — still within expected hold duration for this trade type
 */
function calcLiveConfidence(
  position: ActivePosition,
  currentPrice: number,
  rsi14: number,
  ema9: number
): number {
  const isLong = position.signal.direction === 'LONG';
  let score = 0;

  // EMA alignment
  if (!isNaN(ema9)) {
    const aligned = isLong ? currentPrice > ema9 : currentPrice < ema9;
    score += aligned ? 35 : 0;
  } else {
    score += 17;
  }

  // RSI
  if (!isNaN(rsi14)) {
    const overextended = isLong ? rsi14 > 75 : rsi14 < 25;
    const healthy = isLong ? (rsi14 >= 45 && rsi14 <= 70) : (rsi14 >= 30 && rsi14 <= 55);
    score += overextended ? 5 : healthy ? 30 : 15;
  } else {
    score += 15;
  }

  // P&L direction
  const pnlPct = isLong
    ? (currentPrice - position.entryPrice) / position.entryPrice
    : (position.entryPrice - currentPrice) / position.entryPrice;
  score += pnlPct > 0.01 ? 20 : pnlPct > 0 ? 12 : pnlPct > -0.005 ? 5 : 0;

  // Time in expected window
  const hoursElapsed = (Date.now() - position.confirmedAt) / (1000 * 60 * 60);
  const expectedHours = position.signal.tradeType === 'SCALP' ? 3
    : position.signal.tradeType === 'HYBRID' ? 16 : 48;
  score += hoursElapsed <= expectedHours ? 15 : hoursElapsed <= expectedHours * 1.5 ? 7 : 0;

  return Math.min(100, Math.max(0, score));
}

function buildLiveConfidenceMeter(score: number): string {
  const filled = Math.round(score / 10);
  const dot = score >= 70 ? '🟢' : score >= 45 ? '🟡' : '🔴';
  const dots = dot.repeat(filled) + '⚪'.repeat(10 - filled);
  const label =
    score >= 80 ? 'Setup intact — holding strong' :
    score >= 60 ? 'Stable — conditions still favorable' :
    score >= 40 ? 'Softening — setup weakening, watch closely' :
                  'Breaking down — consider early exit';
  return `${dots}  ${score}/100\n${label}`;
}

export function buildPositionHealthEmbed(
  position: ActivePosition,
  currentPrice: number,
  rsi14: number,    // current RSI(14) value on 5m candles
  ema9: number,     // current EMA(9) value on 5m candles
  trigger: 'TIME' | 'PRICE' | 'PULSE' = 'PRICE'
) {
  const asset = position.signal.asset.split('/')[0];
  const isLong = position.signal.direction === 'LONG';
  const entry = position.entryPrice;

  // Live P&L from entry
  const pnlPct = isLong
    ? (currentPrice - entry) / entry
    : (entry - currentPrice) / entry;
  const stopDist = Math.abs(entry - position.currentStopLoss) / entry;
  const rMultiple = stopDist > 0 ? pnlPct / stopDist : 0;
  const capitalReturn = pnlPct * position.suggestedLeverage;

  // Live confidence meter (recalculated from current indicators)
  const liveScore = calcLiveConfidence(position, currentPrice, rsi14, ema9);

  // Price vs EMA — most reliable trend-intact signal
  const priceAboveEma = currentPrice > ema9;
  const trendIntact = isLong ? priceAboveEma : !priceAboveEma;
  const emaStatus = trendIntact
    ? `✅ Price ${isLong ? 'above' : 'below'} EMA(9) — trend intact`
    : `⚠️ Price ${isLong ? 'below' : 'above'} EMA(9) — momentum weakening`;

  // RSI status
  const rsiOverextended = isLong ? rsi14 > 75 : rsi14 < 25;
  const rsiWeak = isLong ? rsi14 < 40 : rsi14 > 60;
  const rsiTag = rsiOverextended ? '⚠️ Overextended' : rsiWeak ? '⚠️ Weakening' : '✅ Healthy';

  // Overall verdict
  let verdict: string;
  let color: number;
  if (pnlPct > 0 && trendIntact && !rsiOverextended) {
    verdict = '✅ **Still valid** — trade is healthy, hold your position.';
    color = 0x00cc44;
  } else if (rMultiple < -0.5 || (!trendIntact && rsiWeak)) {
    verdict = '🔴 **Consider exiting** — momentum has turned against this trade.';
    color = 0xff2200;
  } else {
    verdict = '⚠️ **Watch closely** — conditions are mixed, be ready to act.';
    color = 0xff8800;
  }

  const pnlSign = pnlPct >= 0 ? '+' : '';
  const capitalSign = capitalReturn >= 0 ? '+' : '';

  const triggerLabel = trigger === 'TIME' ? '⏰ 15-min check' : trigger === 'PULSE' ? '📡 /pulse check' : '📊 Price moved 1%+';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${triggerLabel} — ${asset} ${position.signal.direction} Trade Health`)
    .setDescription(verdict)
    .addFields(
      {
        name: '📡 Live Confidence',
        value: buildLiveConfidenceMeter(liveScore),
        inline: false,
      },
      {
        name: '💰 Live P&L',
        value: [
          `Price:   **${formatPrice(currentPrice, asset)}**  (entry: ${formatPrice(entry, asset)})`,
          `P&L:     **${pnlSign}${(pnlPct * 100).toFixed(2)}%**  (${pnlSign}${rMultiple.toFixed(2)}R)`,
          `Capital: **${capitalSign}${(capitalReturn * 100).toFixed(0)}%** at ${position.suggestedLeverage}x`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '📈 Technicals (5m)',
        value: [
          emaStatus,
          `RSI(14): ${isNaN(rsi14) ? 'N/A' : rsi14.toFixed(1)}  ${rsiTag}`,
          `TP: ${formatPrice(position.currentTakeProfit, asset)}`,
        ].join('\n'),
        inline: false,
      }
    )
    .setTimestamp()
    .setFooter({ text: `Position ID: ${position.id.slice(0, 8)} • Use /position to view all open trades` });

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`closePosition:${position.id}`)
      .setLabel('Close Position')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔴')
  );

  return { embeds: [embed], components: [closeRow] };
}

// ─── Closed trade embed ────────────────────────────────────────────────────────

export function buildClosedTradeEmbed(trade: ClosedTrade) {
  const asset = trade.signal.asset.split('/')[0];
  const isWin = trade.pnlDollar > 0; // pnlDollar stores R-multiple
  const rMultiple = trade.pnlDollar;
  const pnlStr = `${(trade.pnlPct * 100).toFixed(2)}%  (${rMultiple >= 0 ? '+' : ''}${rMultiple.toFixed(2)}R)`;

  const embed = new EmbedBuilder()
    .setColor(isWin ? 0x00ff87 : 0xff4444)
    .setTitle(`${isWin ? '✅' : '❌'} ${asset} ${trade.signal.direction} — Trade Closed`)
    .addFields({
      name: LINE,
      value: [
        `📍 **Entry:** ${formatPrice(trade.entryPrice, asset)}`,
        `🚪 **Exit:** ${formatPrice(trade.exitPrice, asset)}`,
        `📊 **P&L:** ${pnlStr}`,
        `🔑 **Exit reason:** ${trade.exitReason}`,
        `⚡ **Type:** ${trade.signal.tradeType}  |  **Strategy:** ${trade.signal.strategy}`,
        `🎯 **Score:** ${trade.signal.score}/100`,
      ].join('\n'),
      inline: false,
    })
    .setTimestamp(trade.closedAt)
    .setFooter({ text: `Session closed` });

  return { embeds: [embed] };
}
