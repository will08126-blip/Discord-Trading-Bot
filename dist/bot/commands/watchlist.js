"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const engine_1 = require("../../engine");
const embeds_1 = require("../embeds");
const signalManager_1 = require("../../signals/signalManager");
const WATCHLIST = [
    'BTC/USDT',
    'ETH/USDT',
    'SOL/USDT',
    'XRP/USDT',
    'PEPE/USDT',
];
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Instant scan of BTC, ETH, SOL, XRP, PEPE — scores, leverage, and deployment');
async function execute(interaction) {
    await interaction.deferReply();
    const results = await Promise.all(WATCHLIST.map((asset) => (0, engine_1.scanSingleAsset)(asset)));
    // Compact summary embed
    await interaction.editReply((0, embeds_1.buildWatchlistEmbed)(results));
    // Full signal embeds for every qualifying signal across all assets
    for (const result of results) {
        const qualifying = result.signals.filter((s) => s.tier !== 'NO_TRADE');
        for (const signal of qualifying) {
            const msg = await interaction.followUp((0, embeds_1.buildSignalEmbed)(signal));
            (0, signalManager_1.addPendingSignal)(signal);
            (0, signalManager_1.markSignalSent)(signal);
            void msg; // message ref not needed here
        }
    }
}
//# sourceMappingURL=watchlist.js.map