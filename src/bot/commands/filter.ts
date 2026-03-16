import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { setMinScoreThreshold, getMinScoreThreshold } from '../../adaptation/adaptation';

const PRESETS = {
  strict:  { threshold: 75, label: 'Strict',  emoji: '🔒', tier: 'ELITE only',              desc: 'Highest-conviction setups only. Expect 1–3 signals per day at most.' },
  normal:  { threshold: 60, label: 'Normal',  emoji: '⚖️', tier: 'STRONG + ELITE',          desc: 'Balanced default. Good quality with reasonable frequency.' },
  relaxed: { threshold: 45, label: 'Relaxed', emoji: '🔓', tier: 'MEDIUM + STRONG + ELITE', desc: 'All qualifying setups. More signals, lower average conviction.' },
} as const;

export const data = new SlashCommandBuilder()
  .setName('filter')
  .setDescription('Control how often signals appear by adjusting the minimum quality threshold')
  .addStringOption((opt) =>
    opt
      .setName('mode')
      .setDescription('Signal sensitivity preset')
      .setRequired(true)
      .addChoices(
        { name: '🔒 Strict  — ELITE only (score ≥ 75),  fewest signals',  value: 'strict'  },
        { name: '⚖️ Normal  — STRONG + ELITE (score ≥ 60), default',       value: 'normal'  },
        { name: '🔓 Relaxed — all setups (score ≥ 45),   most signals',    value: 'relaxed' },
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const mode = interaction.options.getString('mode', true) as keyof typeof PRESETS;
  const preset = PRESETS[mode];

  setMinScoreThreshold(preset.threshold);

  const currentThreshold = getMinScoreThreshold();

  const embed = new EmbedBuilder()
    .setColor(mode === 'strict' ? 0xff6600 : mode === 'relaxed' ? 0x00cc44 : 0x5865f2)
    .setTitle(`${preset.emoji} Signal Filter — ${preset.label}`)
    .setDescription(preset.desc)
    .addFields(
      {
        name: 'Threshold',
        value: `Score ≥ **${currentThreshold}** / 100`,
        inline: true,
      },
      {
        name: 'Tiers Posted',
        value: `**${preset.tier}**`,
        inline: true,
      },
      {
        name: 'What changes',
        value:
          mode === 'strict'
            ? 'Only 🏆 ELITE signals (score 80–100) will be posted. Rare but very high quality.'
            : mode === 'relaxed'
            ? '⚡ MEDIUM signals (score 45–59) are now included alongside STRONG and ELITE. Expect more pings.'
            : '💪 Back to the default. STRONG (60–79) and ELITE (80–100) signals are posted.',
        inline: false,
      }
    )
    .setFooter({ text: 'Setting persists across restarts — use /filter again to change it' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
