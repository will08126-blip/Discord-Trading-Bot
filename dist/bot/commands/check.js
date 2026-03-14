"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const engine_1 = require("../../engine");
const embeds_1 = require("../embeds");
function normalizeSymbol(input) {
    const upper = input.toUpperCase().trim();
    if (upper.includes('/'))
        return upper.split(':')[0]; // strip :USDT suffix if present → BTC/USDT
    const base = upper.replace(/USDT$/, ''); // strip trailing USDT if present
    return `${base}/USDT`;
}
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('check')
    .setDescription('Immediately scan any crypto for trade setups across all 4 strategies')
    .addStringOption((opt) => opt
    .setName('symbol')
    .setDescription('Coin ticker or pair (e.g. SOL, DOGE, ETH/USDT)')
    .setRequired(true));
async function execute(interaction) {
    const raw = interaction.options.getString('symbol', true);
    const symbol = normalizeSymbol(raw);
    await interaction.deferReply();
    const result = await (0, engine_1.scanSingleAsset)(symbol);
    if (result.error) {
        const errEmbed = new discord_js_1.EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('⚠️ Scan Failed')
            .setDescription(`Could not fetch data for **${symbol}**.\n\n` +
            `Make sure it is a valid symbol available on spot markets (e.g. \`SOL\`, \`DOGE\`, \`BTC/USDT\`).\n\n` +
            `*Error: ${result.error}*`)
            .setTimestamp();
        await interaction.editReply({ embeds: [errEmbed] });
        return;
    }
    // Summary embed: regime + all 4 strategies' scores
    await interaction.editReply({ embeds: [(0, embeds_1.buildCheckSummaryEmbed)(result)] });
    // Full signal embeds for qualifying signals (MEDIUM / STRONG / ELITE)
    const qualifying = result.signals.filter((s) => s.tier !== 'NO_TRADE');
    for (const signal of qualifying) {
        await interaction.followUp((0, embeds_1.buildSignalEmbed)(signal));
    }
}
//# sourceMappingURL=check.js.map