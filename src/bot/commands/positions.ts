import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { getAllActivePositions } from '../../signals/signalManager';
import { formatPrice } from '../../risk/riskCalculator';

export const data = new SlashCommandBuilder()
  .setName('positions')
  .setDescription('List all currently tracked (confirmed) positions');

export async function execute(interaction: ChatInputCommandInteraction) {
  const positions = getAllActivePositions();

  if (positions.length === 0) {
    await interaction.reply({ content: '📭 No active positions being tracked.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x8888ff)
    .setTitle(`📋 Active Positions (${positions.length})`)
    .setTimestamp();

  for (const pos of positions) {
    const asset = pos.signal.asset.split('/')[0];
    const isLong = pos.signal.direction === 'LONG';
    const held = Math.round((Date.now() - pos.confirmedAt) / 60000);
    embed.addFields({
      name: `${isLong ? '🟢' : '🔴'} ${asset} ${pos.signal.direction}  (ID: ${pos.id.slice(0, 8)})`,
      value: [
        `Entry: **${formatPrice(pos.entryPrice, asset)}**`,
        `SL: ${formatPrice(pos.currentStopLoss, asset)}${pos.currentStopLoss !== pos.signal.stopLoss ? ' *(trailing)*' : ''}`,
        `TP: ${formatPrice(pos.currentTakeProfit, asset)}${pos.currentTakeProfit !== pos.signal.takeProfit ? ' *(extended)*' : ''}`,
        `Lev: ${pos.suggestedLeverage}x  |  Type: ${pos.signal.tradeType}  |  Held: ${held} min`,
      ].join('\n'),
      inline: false,
    });
  }

  // One close button per position (bot caps at 3 open positions — fits in one row)
  const buttons = positions.map((pos) =>
    new ButtonBuilder()
      .setCustomId(`closePosition:${pos.id}`)
      .setLabel(`Close ${pos.signal.asset.split('/')[0]}`)
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔴')
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);

  await interaction.reply({ embeds: [embed], components: [row] });
}
