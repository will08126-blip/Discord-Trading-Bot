import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { loadState } from '../../adaptation/adaptation';
import { getAllActivePositions, getAllPendingSignals } from '../../signals/signalManager';
import { dailyPnl } from '../../performance/tracker';
import { regimeLabel, getLastRegimes } from '../../regime/regimeDetector';
import { config } from '../../config';
import type { BotState } from '../../types';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show bot status: regime, pending signals, open positions, and daily P&L');

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const errors: string[] = [];

  // 1. Load bot state — defensive
  let state: BotState;
  try {
    state = loadState();
  } catch (err) {
    errors.push(`loadState: ${String(err)}`);
    state = { enabled: false, dailyLoss: 0, dailyLossDate: '', strategyWeights: {} };
  }

  // 2. Signal/position counts — in-memory reads
  let pending: ReturnType<typeof getAllPendingSignals> = [];
  let active: ReturnType<typeof getAllActivePositions> = [];
  try {
    pending = getAllPendingSignals();
    active = getAllActivePositions();
  } catch (err) {
    errors.push(`signalManager: ${String(err)}`);
  }

  // 3. Daily P&L — reads from disk
  let pnlStr = 'N/A';
  try {
    const pnlToday = dailyPnl();
    pnlStr = pnlToday >= 0 ? `+${pnlToday.toFixed(2)}R` : `${pnlToday.toFixed(2)}R`;
  } catch (err) {
    errors.push(`dailyPnl: ${String(err)}`);
  }

  // 4. Regime cache — in-memory read
  let regimeLines = '_No data yet — waiting for first scan_';
  try {
    const regimes = getLastRegimes();
    if (regimes.size > 0) {
      regimeLines = [...regimes.entries()]
        .map(([asset, r]) => `**${asset}:** ${regimeLabel(r.regime)} (ADX=${r.adx.toFixed(1)})`)
        .join('\n');
    }
  } catch (err) {
    errors.push(`getLastRegimes: ${String(err)}`);
    regimeLines = '_Error loading regime data_';
  }

  // 5. Strategy weights — guard against undefined/null
  let stratWeights = 'Default (100%)';
  try {
    const entries = Object.entries(state.strategyWeights ?? {});
    if (entries.length > 0) {
      stratWeights = entries
        .map(([name, w]) => `  ${name}: ${((w as number) * 100).toFixed(0)}%`)
        .join('\n');
    }
  } catch (err) {
    errors.push(`strategyWeights: ${String(err)}`);
  }

  const embed = new EmbedBuilder()
    .setColor(state.enabled ? 0x00ff87 : 0xff4444)
    .setTitle(`🤖 Bot Status — ${state.enabled ? '🟢 Active' : '🔴 Disabled'}`)
    .addFields(
      {
        name: '📡 Market Regimes',
        value: regimeLines,
        inline: false,
      },
      {
        name: '📅 Today',
        value: `P&L: **${pnlStr}**  |  Daily loss limit: ${config.trading.maxDailyLoss}R`,
        inline: false,
      },
      {
        name: '📊 Signals',
        value: `Pending: **${pending.length}**  |  Active positions: **${active.length}** / ${config.trading.maxOpenPositions}`,
        inline: false,
      },
      {
        name: '⚖️ Strategy Weights',
        value: stratWeights,
        inline: false,
      },
      {
        name: '⚙️ Settings',
        value: [
          `Min score: ${config.trading.minScoreThreshold}`,
          `Risk: ELITE 2% | STRONG 1.5% | MEDIUM 1% of capital`,
          `Max lev (scalp): ${config.trading.maxLeverageScalp}x`,
          `Max lev (swing): ${config.trading.maxLeverageSwing}x`,
          `Scan interval: ${config.engine.scanIntervalMinutes} min`,
        ].join('  |  '),
        inline: false,
      }
    )
    .setTimestamp();

  if (errors.length > 0) {
    embed.addFields({
      name: '⚠️ Errors (partial data shown)',
      value: errors.map((e) => `• ${e}`).join('\n').slice(0, 1024),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
