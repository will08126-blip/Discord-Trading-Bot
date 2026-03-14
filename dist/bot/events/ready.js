"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onReady = onReady;
const index_1 = require("../commands/index");
const config_1 = require("../../config");
const logger_1 = require("../../utils/logger");
async function onReady(client) {
    logger_1.logger.info(`Discord bot ready — logged in as ${client.user?.tag}`);
    // Determine guild ID for command registration.
    // Guild-scoped commands are available INSTANTLY; global commands take up to 1 hour.
    // Strategy: use DISCORD_GUILD_ID env var if set, otherwise auto-detect from the
    // signal channel so we always get instant registration without manual config.
    let guildId = process.env.DISCORD_GUILD_ID || undefined;
    if (!guildId) {
        try {
            const channel = await client.channels.fetch(config_1.config.discord.signalChannelId);
            if (channel && 'guildId' in channel && typeof channel.guildId === 'string') {
                guildId = channel.guildId;
                logger_1.logger.info(`Auto-detected guild ID ${guildId} from signal channel — commands will be available instantly`);
            }
        }
        catch (err) {
            logger_1.logger.warn('Could not auto-detect guild ID from signal channel:', err);
        }
    }
    else {
        logger_1.logger.info(`DISCORD_GUILD_ID set — deploying guild-scoped commands (instant)`);
    }
    if (!guildId) {
        logger_1.logger.warn('No guild ID available — falling back to global commands (up to 1h propagation)');
    }
    await (0, index_1.deployCommands)(guildId);
}
//# sourceMappingURL=ready.js.map