import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { getAllActivePositions } from '../../signals/signalManager';
import { fetchOHLCV, fetchCurrentPrice } from '../../data/marketData';
import { cachedRsi, cachedEma } from '../../indicators/cache';
import { buildPositionHealthEmbed } from '../embeds';
import type { Asset } from '../../types';

export const data = new SlashCommandBuilder()
  .setName('pulse')
  .setDescription('Force an immediate health check on all open positions — no need to wait 15 min');

export async function execute(interaction: ChatInputCommandInteraction) {
  const positions = getAllActivePositions();

  if (positions.length === 0) {
    await interaction.reply({
      content: [
        '📭 **No open positions to check.**',
        '',
        'Confirm a trade first by clicking the **✅ Entered LONG/SHORT** button on a signal.',
      ].join('\n'),
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const errors: string[] = [];
  let firstReplyDone = false;

  for (const position of positions) {
    try {
      const asset = position.signal.asset as Asset;
      const [candles5m, currentPrice] = await Promise.all([
        fetchOHLCV(asset, '5m'),
        fetchCurrentPrice(asset),
      ]);

      const rsiVals = cachedRsi(candles5m, 14);
      const emaVals = cachedEma(candles5m, 9);
      const currentRsi = rsiVals[rsiVals.length - 1] ?? NaN;
      const currentEma = emaVals[emaVals.length - 1] ?? NaN;

      // Reset the 15-min timer so the next auto-check is 15 min from now
      position.lastHealthUpdatePrice = currentPrice;
      position.lastHealthUpdateAt = Date.now();

      const payload = buildPositionHealthEmbed(position, currentPrice, currentRsi, currentEma, 'PRICE');

      if (!firstReplyDone) {
        // Replace the "Bot is thinking…" placeholder — keeps the message alive permanently
        await interaction.editReply(payload);
        firstReplyDone = true;
      } else {
        await interaction.followUp(payload);
      }
    } catch (err) {
      errors.push(`⚠️ Failed to check ${position.signal.asset}: ${(err as Error).message}`);
    }
  }

  if (errors.length > 0) {
    const errPayload = { content: errors.join('\n'), ephemeral: true };
    if (!firstReplyDone) {
      await interaction.editReply(errors.join('\n'));
    } else {
      await interaction.followUp(errPayload);
    }
  }
}

