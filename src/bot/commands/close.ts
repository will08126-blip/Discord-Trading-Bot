import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { getAllActivePositions, closePositionManually } from '../../signals/signalManager';
import { buildClosedTradeEmbed } from '../embeds';

export const data = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Record that you manually closed a position')
  .addStringOption((opt) =>
    opt
      .setName('id')
      .setDescription('Position ID (first 8 characters shown in /positions)')
      .setRequired(true)
  )
  .addNumberOption((opt) =>
    opt
      .setName('price')
      .setDescription('The price at which you exited the trade')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const shortId = interaction.options.getString('id', true).trim();
  const exitPrice = interaction.options.getNumber('price', true);

  // Find full position ID from the short prefix
  const positions = getAllActivePositions();
  const position = positions.find((p) => p.id.startsWith(shortId));

  if (!position) {
    await interaction.reply({
      content: `❌ No active position found with ID starting with \`${shortId}\`. Use \`/positions\` to see active positions.`,
      ephemeral: true,
    });
    return;
  }

  const trade = closePositionManually(position.id, exitPrice);
  if (!trade) {
    await interaction.reply({ content: '❌ Failed to close position.', ephemeral: true });
    return;
  }

  const msg = buildClosedTradeEmbed(trade);
  await interaction.reply(msg);
}
