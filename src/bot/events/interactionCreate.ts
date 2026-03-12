import type { Interaction } from 'discord.js';
import { commands } from '../commands/index';
import {
  getPendingSignal,
  confirmEntry,
  dismissPendingSignal,
} from '../../signals/signalManager';
import { buildPositionEmbed } from '../embeds';
import { logger } from '../../utils/logger';
import { config } from '../../config';

export async function onInteractionCreate(interaction: Interaction): Promise<void> {
  // ── Slash commands ────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(`Command /${interaction.commandName} error:`, err);
      const msg = { content: '❌ An error occurred running this command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    }
    return;
  }

  // ── Button interactions (Enter / Dismiss) ─────────────────────────────────
  if (interaction.isButton()) {
    const [action, signalId] = interaction.customId.split(':');

    if (action === 'dismiss') {
      dismissPendingSignal(signalId);
      await interaction.update({ content: '❌ Signal dismissed.', embeds: [], components: [] });
      return;
    }

    if (action === 'enter') {
      const signal = getPendingSignal(signalId);
      if (!signal) {
        await interaction.reply({ content: '⚠️ Signal expired or already confirmed.', ephemeral: true });
        return;
      }

      // Use the midpoint of the entry zone as the assumed entry price
      const entryPrice = (signal.entryZone[0] + signal.entryZone[1]) / 2;

      const position = confirmEntry(
        signalId,
        entryPrice,
        interaction.message.id,
        interaction.channelId
      );

      if (!position) {
        await interaction.reply({
          content: `⚠️ Could not confirm — max positions (${config.trading.maxOpenPositions}) already reached.`,
          ephemeral: true,
        });
        return;
      }

      // Update the original signal message to remove buttons, then post tracking embed
      await interaction.update({ components: [] });

      const trackMsg = buildPositionEmbed(position);
      await interaction.followUp(trackMsg);

      logger.info(`Position confirmed via button: ${signal.asset} ${signal.direction} @ ${entryPrice}`);
      return;
    }
  }
}
