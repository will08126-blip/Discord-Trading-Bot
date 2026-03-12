import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { runScanCycle } from '../../engine';

export const data = new SlashCommandBuilder()
  .setName('scan')
  .setDescription('Manually trigger an immediate market scan for new trade setups');

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const result = await runScanCycle();

  const embed = new EmbedBuilder().setTimestamp();

  if (result.skipped) {
    embed
      .setColor(0xff9900)
      .setTitle('⏸ Scan Skipped')
      .setDescription(`Scan was not run: **${result.reason ?? 'unknown reason'}**`);
  } else if (result.signalCount > 0) {
    embed
      .setColor(0x00ff87)
      .setTitle('🔍 Scan Complete')
      .setDescription(`Found **${result.signalCount}** qualifying signal${result.signalCount !== 1 ? 's' : ''} — check the signals channel.`);
  } else {
    embed
      .setColor(0x5865f2)
      .setTitle('🔍 Scan Complete')
      .setDescription('No qualifying signals found this cycle. Market conditions may not meet the score threshold.');
  }

  await interaction.editReply({ embeds: [embed] });
}
