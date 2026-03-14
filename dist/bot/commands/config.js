"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const config_1 = require("../../config");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('config')
    .setDescription('Show current bot configuration settings');
async function execute(interaction) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚙️ Bot Configuration')
        .addFields({
        name: '📈 Assets Monitored',
        value: config_1.config.trading.assets.join('\n'),
        inline: false,
    }, {
        name: '🔁 Scan Engine',
        value: [
            `Scan interval: **${config_1.config.engine.scanIntervalMinutes} min**`,
            `Min score threshold: **${config_1.config.trading.minScoreThreshold}**`,
        ].join('\n'),
        inline: false,
    }, {
        name: '🛡️ Risk Controls',
        value: [
            `Max open positions: **${config_1.config.trading.maxOpenPositions}**`,
            `Daily loss limit: **$${config_1.config.trading.maxDailyLoss}**`,
            `Risk per trade: ELITE 2% | STRONG 1.5% | MEDIUM 1%`,
        ].join('\n'),
        inline: false,
    }, {
        name: '⚡ Leverage Caps',
        value: [
            `Scalp — ELITE: ${config_1.config.leverageTiers.scalp.ELITE}x | STRONG: ${config_1.config.leverageTiers.scalp.STRONG}x | MEDIUM: ${config_1.config.leverageTiers.scalp.MEDIUM}x`,
            `Swing — ELITE: ${config_1.config.leverageTiers.swing.ELITE}x | STRONG: ${config_1.config.leverageTiers.swing.STRONG}x | MEDIUM: ${config_1.config.leverageTiers.swing.MEDIUM}x`,
        ].join('\n'),
        inline: false,
    }, {
        name: '🎯 Score Tiers',
        value: [
            `ELITE: ≥ ${config_1.config.scoreTiers.ELITE}`,
            `STRONG: ≥ ${config_1.config.scoreTiers.STRONG}`,
            `MEDIUM: ≥ ${config_1.config.scoreTiers.MEDIUM}`,
        ].join('  |  '),
        inline: false,
    }, {
        name: '🤖 AI Summaries',
        value: process.env.ANTHROPIC_API_KEY ? '✅ Enabled (ANTHROPIC_API_KEY set)' : '❌ Disabled (no ANTHROPIC_API_KEY)',
        inline: false,
    })
        .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
}
//# sourceMappingURL=config.js.map