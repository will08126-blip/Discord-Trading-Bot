import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { generateDailySummary, generateWeeklySummary } from '../../llm/summaries';
import { config } from '../../config';

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Generate a performance report using AI')
  .addStringOption((opt) =>
    opt
      .setName('type')
      .setDescription('Report type')
      .setRequired(true)
      .addChoices(
        { name: 'Daily', value: 'daily' },
        { name: 'Weekly', value: 'weekly' }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const type = interaction.options.getString('type', true) as 'daily' | 'weekly';
  await interaction.deferReply();

  const summary = type === 'daily'
    ? await generateDailySummary()
    : await generateWeeklySummary();

  // Discord message limit is 2000 chars — chunk if needed
  if (summary.length <= 2000) {
    await interaction.editReply(summary);
  } else {
    const chunks = summary.match(/[\s\S]{1,1900}/g) ?? [summary];
    await interaction.editReply(chunks[0]);
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp(chunk);
    }
  }

  // Also post to summary channel if different
  if (interaction.channelId !== config.discord.summaryChannelId) {
    const summaryChannel = await interaction.client.channels.fetch(config.discord.summaryChannelId);
    if (summaryChannel?.isTextBased()) {
      await (summaryChannel as any).send(summary.slice(0, 2000));
    }
  }
}
