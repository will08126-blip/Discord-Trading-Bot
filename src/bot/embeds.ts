import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { StrategySignal, ActivePosition, ClosedTrade } from '../types';
import { calculateRisk, formatPrice } from '../risk/riskCalculator';
import { regimeLabel } from '../regime/regimeDetector';
import { tierEmoji, tierColor } from '../scoring/votingEngine';

const LINE = '━━━━━━━━━━━━━━━━━━━━━━━';

function dirEmoji(dir: string): string {
  return dir === 'LONG' ? '🟢' : '🔴';
}

function pct(price: number, reference: number): string {
  const p = ((price - reference) / reference) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

// ─── Signal embed ─────────────────────────────────────────────────────────────

export function buildSignalEmbed(signal: StrategySignal) {
  const risk = calculateRisk(signal);
  const asset = signal.asset.replace('/USDT:USDT', '');
  const entry = risk.entryPrice;

  const title = `${tierEmoji(signal.tier)} ${signal.tier} ${signal.direction}  —  ${asset}/USDT`;
  const tradeTypeLabel = signal.tradeType === 'SCALP' ? '⚡ Scalp' : '🌊 Swing';

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
          `🛑 **Stop Loss:**  ${formatPrice(signal.stopLoss, asset)}  (${pct(signal.stopLoss, entry)})`,
          `🎯 **Take Profit:** ${formatPrice(signal.takeProfit, asset)}  (${pct(signal.takeProfit, entry)})`,
          `📐 **R:R:** ${risk.rewardRiskRatio.toFixed(2)}:1  |  **Lev:** ${risk.suggestedLeverage}x  |  **SL dist:** ${(risk.stopDistancePct * 100).toFixed(2)}%`,
        ].join('\n'),
        inline: false,
      },
      {
        name: `💰 Suggested Risk: ${risk.riskPct}% of your capital`,
        value: risk.referenceTable
          .map((r) => `$${r.capital.toLocaleString()} → risk **$${r.riskDollars}** (pos ~$${r.positionSize.toLocaleString()})`)
          .join('\n'),
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
        value: '✅ **Click "Entered"** if you took this trade  |  ❌ to dismiss',
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
  const asset = position.signal.asset.replace('/USDT:USDT', '');
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
    .addFields({
      name: LINE,
      value: [
        `📍 **Entry:** ${formatPrice(position.entryPrice, asset)}`,
        `🛑 **Current SL:** ${formatPrice(position.currentStopLoss, asset)}  ${
          position.currentStopLoss !== position.signal.stopLoss ? '*(trailing)*' : ''
        }`,
        `🎯 **Current TP:** ${formatPrice(position.currentTakeProfit, asset)}  ${
          position.currentTakeProfit !== position.signal.takeProfit ? '*(extended)*' : ''
        }`,
        priceLine,
        pnlLine,
        `📐 **Leverage:** ${position.suggestedLeverage}x  |  **Risk:** ${position.riskPct}% of capital`,
        `⚡ **Type:** ${position.signal.tradeType}  |  **Strategy:** ${position.signal.strategy}`,
      ].filter(Boolean).join('\n'),
      inline: false,
    })
    .setTimestamp()
    .setFooter({ text: `Position ID: ${position.id.slice(0, 8)} — use /close ${position.id.slice(0, 8)} <price> to close` });

  return { embeds: [embed] };
}

// ─── Exit alert embed ─────────────────────────────────────────────────────────

export function buildExitAlertEmbed(
  position: ActivePosition,
  type: 'SL_APPROACH' | 'TP_APPROACH' | 'SL_HIT' | 'TP_HIT',
  currentPrice: number,
  newSL?: number,
  newTP?: number
) {
  const asset = position.signal.asset.replace('/USDT:USDT', '');
  const isLong = position.signal.direction === 'LONG';

  const labels: Record<string, { emoji: string; title: string; color: number }> = {
    SL_APPROACH: { emoji: '⚠️', title: 'SL APPROACHING', color: 0xffa500 },
    TP_APPROACH: { emoji: '🔔', title: 'TP APPROACHING', color: 0x00ccff },
    SL_HIT:      { emoji: '🛑', title: 'STOP LOSS HIT — Consider Exiting', color: 0xff0000 },
    TP_HIT:      { emoji: '🎯', title: 'TAKE PROFIT HIT — Consider Exiting', color: 0x00ff00 },
  };

  const { emoji, title, color } = labels[type];
  const pnlPct = isLong
    ? (currentPrice - position.entryPrice) / position.entryPrice
    : (position.entryPrice - currentPrice) / position.entryPrice;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} ${asset} ${position.signal.direction} — ${title}`)
    .addFields({
      name: LINE,
      value: [
        `💹 **Current Price:** ${formatPrice(currentPrice, asset)}`,
        `📍 **Entry:** ${formatPrice(position.entryPrice, asset)}`,
        newSL ? `🛑 **SL (updated):** ${formatPrice(newSL, asset)}` : `🛑 **SL:** ${formatPrice(position.currentStopLoss, asset)}`,
        newTP ? `🎯 **TP (updated):** ${formatPrice(newTP, asset)}` : `🎯 **TP:** ${formatPrice(position.currentTakeProfit, asset)}`,
        `📊 **Unrealised P&L:** ${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(2)}%`,
        '',
        `Use \`/close ${position.id.slice(0, 8)} <exit-price>\` to record your exit.`,
      ].filter(Boolean).join('\n'),
      inline: false,
    })
    .setTimestamp()
    .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });

  return { embeds: [embed] };
}

// ─── SL/TP update embed ───────────────────────────────────────────────────────

export function buildSLTPUpdateEmbed(
  position: ActivePosition,
  oldSL: number,
  newSL: number,
  oldTP: number,
  newTP: number,
  currentPrice: number
) {
  const asset = position.signal.asset.replace('/USDT:USDT', '');
  const embed = new EmbedBuilder()
    .setColor(0x8888ff)
    .setTitle(`🔄 ${asset} ${position.signal.direction} — SL/TP Updated`)
    .addFields({
      name: 'Level Changes',
      value: [
        oldSL !== newSL ? `🛑 SL: ${formatPrice(oldSL, asset)} → **${formatPrice(newSL, asset)}**` : '',
        oldTP !== newTP ? `🎯 TP: ${formatPrice(oldTP, asset)} → **${formatPrice(newTP, asset)}**` : '',
        `💹 Current: ${formatPrice(currentPrice, asset)}`,
      ].filter(Boolean).join('\n'),
      inline: false,
    })
    .setTimestamp()
    .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });

  return { embeds: [embed] };
}

// ─── Closed trade embed ────────────────────────────────────────────────────────

export function buildClosedTradeEmbed(trade: ClosedTrade) {
  const asset = trade.signal.asset.replace('/USDT:USDT', '');
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
