import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { TextChannel } from 'discord.js';
import { postDailyPaperReport } from '../../paper/dailyReport';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('daily-report')
  .setDescription('Generate the paper trading daily report — covers today\'s full UTC trading day (≈8 PM EDT prior night → now)')
  .addStringOption((opt) =>
    opt.setName('date')
      .setDescription('Override date to report on (YYYY-MM-DD). Defaults to today UTC.')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const dateArg = interaction.options.getString('date') ?? undefined;
  await interaction.deferReply({ ephemeral: false });

  try {
    await postDailyPaperReport(interaction.channel as TextChannel, dateArg);
    await interaction.editReply({ content: '✅ Daily report posted above.' });
  } catch (err) {
    logger.error('daily-report command error:', err);
    await interaction.editReply({ content: `❌ Error generating report: ${String(err)}` });
  }
}
