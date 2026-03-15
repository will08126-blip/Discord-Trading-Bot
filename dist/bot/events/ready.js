"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onReady = onReady;
const discord_js_1 = require("discord.js");
const index_1 = require("../commands/index");
const config_1 = require("../../config");
const logger_1 = require("../../utils/logger");
async function onReady(client) {
    logger_1.logger.info(`Discord bot ready — logged in as ${client.user?.tag}`);
    // ── Determine guild ID for command registration ────────────────────────────
    // Guild-scoped commands are available INSTANTLY; global commands take up to 1 hour.
    // Strategy:
    //   1. Use DISCORD_GUILD_ID env var if set (explicit, most reliable)
    //   2. Auto-detect from signal channel guildId
    //   3. Fallback: first guild in the bot's guild cache (works when bot is in 1 server)
    //   4. Last resort: global deployment (1h delay — avoid if possible)
    let guildId = process.env.DISCORD_GUILD_ID || undefined;
    if (!guildId) {
        try {
            const channel = await client.channels.fetch(config_1.config.discord.signalChannelId);
            if (channel && 'guildId' in channel && typeof channel.guildId === 'string') {
                guildId = channel.guildId;
                logger_1.logger.info(`Auto-detected guild ID ${guildId} from signal channel — commands will be instant`);
            }
        }
        catch (err) {
            logger_1.logger.warn('Could not auto-detect guild ID from signal channel:', err);
        }
    }
    else {
        logger_1.logger.info(`DISCORD_GUILD_ID set — deploying guild-scoped commands (instant)`);
    }
    // Fallback: use first guild in cache (reliable when bot is in exactly one server)
    if (!guildId) {
        const firstGuild = client.guilds.cache.first();
        if (firstGuild) {
            guildId = firstGuild.id;
            logger_1.logger.info(`Guild ID fallback — using first cached guild ${guildId}`);
        }
    }
    if (!guildId) {
        logger_1.logger.warn('No guild ID found — falling back to global commands (up to 1h propagation)');
    }
    // ── Deploy commands ────────────────────────────────────────────────────────
    let deployError = null;
    try {
        await (0, index_1.deployCommands)(guildId);
    }
    catch (err) {
        deployError = String(err);
        logger_1.logger.error('Command deployment failed:', err);
    }
    // ── Post startup confirmation to signal channel ────────────────────────────
    // This lets the user see in Discord that commands are ready and what they're called.
    try {
        const channel = await client.channels.fetch(config_1.config.discord.signalChannelId);
        if (!channel?.isTextBased())
            return;
        const commandList = [...index_1.commands.keys()]
            .map((name) => `\`/${name}\``)
            .join('  ');
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(deployError ? 0xff4444 : 0x00ff87)
            .setTitle(deployError ? '⚠️ Bot Online — Command Registration Failed' : '✅ Bot Online — Commands Ready')
            .setDescription(deployError
            ? `Commands could not be registered: \`${deployError}\`\n\nSlash commands may not be available. Check the bot logs.`
            : [
                `All slash commands are now ${guildId ? '**instantly available**' : 'registered globally (may take up to 1h)'}.`,
                '',
                '**Available commands:**',
                commandList,
            ].join('\n'))
            .setFooter({ text: `Logged in as ${client.user?.tag}` })
            .setTimestamp();
        await channel.send({ embeds: [embed] });
    }
    catch (err) {
        logger_1.logger.warn('Could not post startup confirmation message:', err);
    }
}
//# sourceMappingURL=ready.js.map