"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const engine_1 = require("../../engine");
const embeds_1 = require("../embeds");
const config_1 = require("../../config");
const logger_1 = require("../../utils/logger");
const WATCHLIST = [
    'BTC/USDT',
    'ETH/USDT',
    'SOL/USDT',
    'XRP/USDT',
    'PEPE/USDT',
];
// Module-scoped state — only one live dashboard active at a time
let liveDashboard = null;
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('live')
    .setDescription('Auto-updating watchlist dashboard for BTC, ETH, SOL, XRP, PEPE')
    .addStringOption((opt) => opt
    .setName('action')
    .setDescription('start (default) or stop')
    .setRequired(false)
    .addChoices({ name: 'start', value: 'start' }, { name: 'stop', value: 'stop' }));
async function execute(interaction) {
    const action = (interaction.options.getString('action') ?? 'start');
    // ── Stop ──────────────────────────────────────────────────────────────────
    if (action === 'stop') {
        if (!liveDashboard) {
            await interaction.reply({ content: 'No live dashboard is currently running.', ephemeral: true });
            return;
        }
        clearInterval(liveDashboard.timer);
        try {
            await liveDashboard.message.edit({
                embeds: [
                    new discord_js_1.EmbedBuilder()
                        .setColor(0xff4444)
                        .setTitle('🔴 Live Watchlist — Stopped')
                        .setDescription('Dashboard was stopped via `/live stop`.')
                        .setTimestamp(),
                ],
            });
        }
        catch (err) {
            logger_1.logger.warn('Could not edit stopped live dashboard message:', err);
        }
        liveDashboard = null;
        await interaction.reply({ content: '✅ Live dashboard stopped.', ephemeral: true });
        return;
    }
    // ── Start ─────────────────────────────────────────────────────────────────
    if (liveDashboard) {
        await interaction.reply({
            content: 'A live dashboard is already running. Use `/live stop` first.',
            ephemeral: true,
        });
        return;
    }
    await interaction.deferReply();
    const results = await Promise.all(WATCHLIST.map((asset) => (0, engine_1.scanSingleAsset)(asset)));
    // editReply() returns the Message directly in discord.js v14 — no extra fetch needed
    const message = (await interaction.editReply((0, embeds_1.buildWatchlistEmbed)(results, true)));
    const intervalMs = config_1.config.engine.scanIntervalMinutes * 60 * 1000;
    const timer = setInterval(async () => {
        try {
            const fresh = await Promise.all(WATCHLIST.map((asset) => (0, engine_1.scanSingleAsset)(asset)));
            await message.edit((0, embeds_1.buildWatchlistEmbed)(fresh, true));
        }
        catch (err) {
            logger_1.logger.error('Live dashboard refresh error:', err);
        }
    }, intervalMs);
    liveDashboard = { timer, message };
    logger_1.logger.info(`Live dashboard started — refreshing every ${config_1.config.engine.scanIntervalMinutes} min`);
}
//# sourceMappingURL=live.js.map