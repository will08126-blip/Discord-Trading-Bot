import type { Client } from 'discord.js';
import { deployCommands } from '../commands/index';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export async function onReady(client: Client): Promise<void> {
  logger.info(`Discord bot ready — logged in as ${client.user?.tag}`);

  // Determine guild ID for command registration.
  // Guild-scoped commands are available INSTANTLY; global commands take up to 1 hour.
  // Strategy: use DISCORD_GUILD_ID env var if set, otherwise auto-detect from the
  // signal channel so we always get instant registration without manual config.
  let guildId: string | undefined = process.env.DISCORD_GUILD_ID || undefined;

  if (!guildId) {
    try {
      const channel = await client.channels.fetch(config.discord.signalChannelId);
      if (channel && 'guildId' in channel && typeof (channel as any).guildId === 'string') {
        guildId = (channel as any).guildId as string;
        logger.info(`Auto-detected guild ID ${guildId} from signal channel — commands will be available instantly`);
      }
    } catch (err) {
      logger.warn('Could not auto-detect guild ID from signal channel:', err);
    }
  } else {
    logger.info(`DISCORD_GUILD_ID set — deploying guild-scoped commands (instant)`);
  }

  if (!guildId) {
    logger.warn('No guild ID available — falling back to global commands (up to 1h propagation)');
  }

  await deployCommands(guildId);
}
