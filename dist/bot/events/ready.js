"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onReady = onReady;
const index_1 = require("../commands/index");
const logger_1 = require("../../utils/logger");
async function onReady(client) {
    logger_1.logger.info(`Discord bot ready — logged in as ${client.user?.tag}`);
    // If DISCORD_GUILD_ID is set, deploy guild-scoped commands (instant).
    // Leave it unset for production to deploy global commands (up to 1h propagation).
    const guildId = process.env.DISCORD_GUILD_ID || undefined;
    if (guildId) {
        logger_1.logger.info(`DISCORD_GUILD_ID detected — deploying guild-scoped commands (instant)`);
    }
    else {
        logger_1.logger.info('No DISCORD_GUILD_ID — deploying global commands (up to 1h propagation)');
    }
    await (0, index_1.deployCommands)(guildId);
}
//# sourceMappingURL=ready.js.map