import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { getAllActivePositions } from '../../signals/signalManager';
import { fetchOHLCV, fetchCurrentPrice } from '../../data/marketData';
import { rsi, ema } from '../../indicators/indicators';
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

  const results: string[] = [];

  for (const position of positions) {
    try {
      const asset = position.signal.asset as Asset;
      const [candles5m, currentPrice] = await Promise.all([
        fetchOHLCV(asset, '5m'),
        fetchCurrentPrice(asset),
      ]);

      const rsiVals = rsi(candles5m, 14);
      const emaVals = ema(candles5m, 9);
      const currentRsi = rsiVals[rsiVals.length - 1] ?? NaN;
      const currentEma = emaVals[emaVals.length - 1] ?? NaN;

      // Reset the 15-min timer so the next auto-check is 15 min from now
      position.lastHealthUpdatePrice = currentPrice;
      position.lastHealthUpdateAt = Date.now();

      await interaction.followUp(
        buildPositionHealthEmbed(position, currentPrice, currentRsi, currentEma, 'PRICE')
      );
    } catch (err) {
      results.push(`⚠️ Failed to check ${position.signal.asset}: ${(err as Error).message}`);
    }
  }

  // Surface any per-position errors as a single follow-up
  if (results.length > 0) {
    await interaction.followUp({ content: results.join('\n'), ephemeral: true });
  }

  // If deferReply was called but no followUp succeeded (all failed), send a fallback
  if (positions.length > 0 && results.length === positions.length) {
    await interaction.editReply('❌ All health checks failed — check bot logs.');
  } else {
    // Clean up the "Bot is thinking…" deferred reply placeholder
    await interaction.deleteReply().catch(() => {/* ignore if already gone */});
  }
}
