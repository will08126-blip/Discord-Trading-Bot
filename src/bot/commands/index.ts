import { REST, Routes } from 'discord.js';
import { config } from '../../config';
import { logger } from '../../utils/logger';

import * as statusCmd from './status';
import * as positionsCmd from './positions';
import * as closeCmd from './close';
import * as performanceCmd from './performance';
import * as toggleCmd from './toggle';
import * as reportCmd from './report';

export interface Command {
  data: { toJSON: () => unknown; name: string };
  execute: (interaction: any) => Promise<void>;
}

export const commands = new Map<string, Command>([
  ['status', statusCmd],
  ['positions', positionsCmd],
  ['close', closeCmd],
  ['performance', performanceCmd],
  ['toggle', toggleCmd],
  ['report', reportCmd],
]);

/** Deploy (register) all slash commands with Discord's API */
export async function deployCommands(guildId?: string): Promise<void> {
  const rest = new REST().setToken(config.discord.token);
  const commandBodies = [...commands.values()].map((c) => c.data.toJSON());

  try {
    if (guildId) {
      // Guild-scoped (instant update, good for testing)
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, guildId),
        { body: commandBodies }
      );
      logger.info(`Deployed ${commandBodies.length} guild commands to guild ${guildId}`);
    } else {
      // Global commands (up to 1h propagation delay)
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commandBodies }
      );
      logger.info(`Deployed ${commandBodies.length} global commands`);
    }
  } catch (err) {
    logger.error('Failed to deploy commands:', err);
  }
}
