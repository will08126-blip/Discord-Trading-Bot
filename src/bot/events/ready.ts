import type { Client } from 'discord.js';
import { deployCommands } from '../commands/index';
import { logger } from '../../utils/logger';

export async function onReady(client: Client): Promise<void> {
  logger.info(`Discord bot ready — logged in as ${client.user?.tag}`);

  // If DISCORD_GUILD_ID is set, deploy guild-scoped commands (instant).
  // Leave it unset for production to deploy global commands (up to 1h propagation).
  const guildId = process.env.DISCORD_GUILD_ID || undefined;
  if (guildId) {
    logger.info(`DISCORD_GUILD_ID detected — deploying guild-scoped commands (instant)`);
  } else {
    logger.info('No DISCORD_GUILD_ID — deploying global commands (up to 1h propagation)');
  }
  await deployCommands(guildId);
}
