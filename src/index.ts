import { Events } from 'discord.js';
import { discordClient } from './bot/client';
import { onReady } from './bot/events/ready';
import { onInteractionCreate } from './bot/events/interactionCreate';
import { startScheduler, runScanCycle } from './engine';
import { config } from './config';
import { logger } from './utils/logger';

async function main() {
  logger.info('Starting Discord Trading Bot...');

  // Register Discord event handlers
  discordClient.once(Events.ClientReady, async (client) => {
    await onReady(client);
    startScheduler();

    // Run one scan immediately on startup so you don't wait 5 minutes
    logger.info('Running initial scan...');
    setTimeout(() => {
      runScanCycle().catch((err) => logger.error('Initial scan error:', err));
    }, 3000); // small delay to let Discord settle
  });

  discordClient.on(Events.InteractionCreate, onInteractionCreate);

  discordClient.on(Events.Error, (err) => {
    logger.error('Discord client error:', err);
  });

  // Login
  await discordClient.login(config.discord.token);
}

main().catch((err) => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});
