import type { Client } from 'discord.js';
import { deployCommands } from '../commands/index';
import { logger } from '../../utils/logger';

export async function onReady(client: Client): Promise<void> {
  logger.info(`Discord bot ready — logged in as ${client.user?.tag}`);

  // Deploy commands globally on startup
  // For faster testing, pass a guildId: deployCommands('YOUR_GUILD_ID')
  await deployCommands();
}
