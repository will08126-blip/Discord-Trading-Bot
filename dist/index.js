"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const client_1 = require("./bot/client");
const ready_1 = require("./bot/events/ready");
const interactionCreate_1 = require("./bot/events/interactionCreate");
const engine_1 = require("./engine");
const signalManager_1 = require("./signals/signalManager");
const config_1 = require("./config");
const logger_1 = require("./utils/logger");
// ─── Global error guards ──────────────────────────────────────────────────────
// Without these, a single unhandled rejection crashes Node 15+ (Render uses 20+).
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled promise rejection:', reason);
    // Do NOT exit — log and keep the bot alive for the next interaction.
});
process.on('uncaughtException', (err) => {
    logger_1.logger.error('Uncaught exception — restarting:', err);
    process.exit(1); // Render will auto-restart the worker
});
async function main() {
    logger_1.logger.info('Starting Discord Trading Bot...');
    // Restore active positions from the previous session before anything else
    (0, signalManager_1.loadPositions)();
    // Register Discord event handlers
    client_1.discordClient.once(discord_js_1.Events.ClientReady, async (client) => {
        await (0, ready_1.onReady)(client);
        (0, engine_1.startScheduler)();
        // Run one scan immediately on startup so you don't wait 5 minutes
        logger_1.logger.info('Running initial scan...');
        setTimeout(() => {
            (0, engine_1.runScanCycle)().catch((err) => logger_1.logger.error('Initial scan error:', err));
        }, 3000); // small delay to let Discord settle
    });
    client_1.discordClient.on(discord_js_1.Events.InteractionCreate, interactionCreate_1.onInteractionCreate);
    client_1.discordClient.on(discord_js_1.Events.Error, (err) => {
        logger_1.logger.error('Discord client error:', err);
    });
    // Login
    await client_1.discordClient.login(config_1.config.discord.token);
}
main().catch((err) => {
    logger_1.logger.error('Fatal startup error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map