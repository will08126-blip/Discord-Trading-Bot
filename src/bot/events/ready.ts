import type { Client, TextChannel } from 'discord.js';
import { ChannelType, EmbedBuilder } from 'discord.js';
import { deployCommands, commands } from '../commands/index';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export async function onReady(client: Client): Promise<void> {
  logger.info(`Discord bot ready — logged in as ${client.user?.tag}`);

  // ── Determine guild ID for command registration ────────────────────────────
  // Guild-scoped commands are available INSTANTLY; global commands take up to 1 hour.
  // Strategy:
  //   1. Use DISCORD_GUILD_ID env var if set (explicit, most reliable)
  //   2. Auto-detect from signal channel guildId
  //   3. Fallback: first guild in the bot's guild cache (works when bot is in 1 server)
  //   4. Last resort: global deployment (1h delay — avoid if possible)

  let guildId: string | undefined = process.env.DISCORD_GUILD_ID || undefined;

  if (!guildId) {
    try {
      const channel = await client.channels.fetch(config.discord.signalChannelId);
      if (channel && 'guildId' in channel && typeof (channel as any).guildId === 'string') {
        guildId = (channel as any).guildId as string;
        logger.info(`Auto-detected guild ID ${guildId} from signal channel — commands will be instant`);
      }
    } catch (err) {
      logger.warn('Could not auto-detect guild ID from signal channel:', err);
    }
  } else {
    logger.info(`DISCORD_GUILD_ID set — deploying guild-scoped commands (instant)`);
  }

  // Fallback: use first guild in cache (reliable when bot is in exactly one server)
  if (!guildId) {
    const firstGuild = client.guilds.cache.first();
    if (firstGuild) {
      guildId = firstGuild.id;
      logger.info(`Guild ID fallback — using first cached guild ${guildId}`);
    }
  }

  if (!guildId) {
    logger.warn('No guild ID found — falling back to global commands (up to 1h propagation)');
  }

  // ── Find or create dedicated bot channel ───────────────────────────────────
  // The bot manages its own signal channel so you don't have to configure it
  // manually. On first boot it creates #bot-signals (or BOT_CHANNEL_NAME);
  // on subsequent boots it reuses the existing channel.
  if (guildId) {
    const channelName = process.env.BOT_CHANNEL_NAME ?? 'bot-signals';
    try {
      const guild = await client.guilds.fetch(guildId);
      const allChannels = await guild.channels.fetch();

      // Look for an existing text channel with our name
      const existing = allChannels.find(
        (c): c is TextChannel =>
          c !== null && c.type === ChannelType.GuildText && c.name === channelName
      ) as TextChannel | undefined;

      let botChannel: TextChannel;
      if (existing) {
        botChannel = existing;
        logger.info(`Bot channel: reusing existing #${channelName} (${botChannel.id})`);
      } else {
        // Create a fresh dedicated channel
        botChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          topic: '🤖 Trading bot signals, paper trade alerts, and daily summaries — do not post here',
          reason: 'Discord Trading Bot — auto-created dedicated signal channel',
        });
        logger.info(`Bot channel: created #${channelName} (${botChannel.id})`);
      }

      // Override config so ALL notifications go to this channel
      config.discord.signalChannelId  = botChannel.id;
      config.discord.summaryChannelId = botChannel.id;
    } catch (err) {
      // Non-fatal — continue with whatever channel ID is in env vars
      logger.warn(
        `Bot channel: could not find/create #${channelName} — ` +
        `check the bot has Manage Channels permission. Falling back to SIGNAL_CHANNEL_ID. Error: ${err}`
      );
    }
  }

  // ── Deploy commands ────────────────────────────────────────────────────────
  let deployError: string | null = null;
  try {
    await deployCommands(guildId);
  } catch (err) {
    deployError = String(err);
    logger.error('Command deployment failed:', err);
  }

  // ── Post startup confirmation to signal channel ────────────────────────────
  // This lets the user see in Discord that commands are ready and what they're called.
  try {
    const channel = await client.channels.fetch(config.discord.signalChannelId);
    if (!channel?.isTextBased()) return;

    const commandList = [...commands.keys()]
      .map((name) => `\`/${name}\``)
      .join('  ');

    const embed = new EmbedBuilder()
      .setColor(deployError ? 0xff4444 : 0x00ff87)
      .setTitle(deployError ? '⚠️ Bot Online — Command Registration Failed' : '✅ Bot Online — Commands Ready')
      .setDescription(
        deployError
          ? `Commands could not be registered: \`${deployError}\`\n\nSlash commands may not be available. Check the bot logs.`
          : [
              `All slash commands are now ${guildId ? '**instantly available**' : 'registered globally (may take up to 1h)'}.`,
              '',
              '**Available commands:**',
              commandList,
            ].join('\n')
      )
      .setFooter({ text: `Logged in as ${client.user?.tag}` })
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    logger.warn('Could not post startup confirmation message:', err);
  }
}
