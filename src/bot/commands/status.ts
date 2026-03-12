import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { loadState } from '../../adaptation/adaptation';
import { getAllActivePositions, getAllPendingSignals } from '../../signals/signalManager';
import { dailyPnl } from '../../performance/tracker';
import { regimeLabel } from '../../regime/regimeDetector';
import { config } from '../../config';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show bot status: regime, pending signals, open positions, and daily P&L');

export async function execute(interaction: ChatInputCommandInteraction) {
  const state = loadState();
  const pending = getAllPendingSignals();
  const active = getAllActivePositions();
  const pnlToday = dailyPnl();
  const pnlStr = pnlToday >= 0 ? `+$${pnlToday.toFixed(2)}` : `-$${Math.abs(pnlToday).toFixed(2)}`;

  const stratWeights = Object.entries(state.strategyWeights)
    .map(([name, w]) => `  ${name}: ${(w * 100).toFixed(0)}%`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(state.enabled ? 0x00ff87 : 0xff4444)
    .setTitle(`🤖 Bot Status — ${state.enabled ? '🟢 Active' : '🔴 Disabled'}`)
    .addFields(
      {
        name: '📅 Today',
        value: `P&L: **${pnlStr}**  |  Limit: $${config.trading.maxDailyLoss}`,
        inline: false,
      },
      {
        name: '📊 Signals',
        value: `Pending: **${pending.length}**  |  Active positions: **${active.length}** / ${config.trading.maxOpenPositions}`,
        inline: false,
      },
      {
        name: '⚖️ Strategy Weights',
        value: stratWeights || 'Default (100%)',
        inline: false,
      },
      {
        name: '⚙️ Settings',
        value: [
          `Min score: ${config.trading.minScoreThreshold}`,
          `Risk/trade: $${config.trading.riskPerTrade}`,
          `Max lev (scalp): ${config.trading.maxLeverageScalp}x`,
          `Max lev (swing): ${config.trading.maxLeverageSwing}x`,
          `Scan interval: ${config.engine.scanIntervalMinutes} min`,
        ].join('  |  '),
        inline: false,
      }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: false });
}
