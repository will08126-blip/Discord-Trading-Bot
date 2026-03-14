"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const adaptation_1 = require("../../adaptation/adaptation");
const signalManager_1 = require("../../signals/signalManager");
const tracker_1 = require("../../performance/tracker");
const regimeDetector_1 = require("../../regime/regimeDetector");
const config_1 = require("../../config");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('status')
    .setDescription('Show bot status: regime, pending signals, open positions, and daily P&L');
async function execute(interaction) {
    await interaction.deferReply();
    const errors = [];
    // 1. Load bot state — defensive
    let state;
    try {
        state = (0, adaptation_1.loadState)();
    }
    catch (err) {
        errors.push(`loadState: ${String(err)}`);
        state = { enabled: false, dailyLoss: 0, dailyLossDate: '', strategyWeights: {} };
    }
    // 2. Signal/position counts — in-memory reads
    let pending = [];
    let active = [];
    try {
        pending = (0, signalManager_1.getAllPendingSignals)();
        active = (0, signalManager_1.getAllActivePositions)();
    }
    catch (err) {
        errors.push(`signalManager: ${String(err)}`);
    }
    // 3. Daily P&L — reads from disk
    let pnlStr = 'N/A';
    try {
        const pnlToday = (0, tracker_1.dailyPnl)();
        pnlStr = pnlToday >= 0 ? `+${pnlToday.toFixed(2)}R` : `${pnlToday.toFixed(2)}R`;
    }
    catch (err) {
        errors.push(`dailyPnl: ${String(err)}`);
    }
    // 4. Regime cache — in-memory read
    let regimeLines = '_No data yet — waiting for first scan_';
    try {
        const regimes = (0, regimeDetector_1.getLastRegimes)();
        if (regimes.size > 0) {
            regimeLines = [...regimes.entries()]
                .map(([asset, r]) => `**${asset}:** ${(0, regimeDetector_1.regimeLabel)(r.regime)} (ADX=${r.adx.toFixed(1)})`)
                .join('\n');
        }
    }
    catch (err) {
        errors.push(`getLastRegimes: ${String(err)}`);
        regimeLines = '_Error loading regime data_';
    }
    // 5. Strategy weights — guard against undefined/null
    let stratWeights = 'Default (100%)';
    try {
        const entries = Object.entries(state.strategyWeights ?? {});
        if (entries.length > 0) {
            stratWeights = entries
                .map(([name, w]) => `  ${name}: ${(w * 100).toFixed(0)}%`)
                .join('\n');
        }
    }
    catch (err) {
        errors.push(`strategyWeights: ${String(err)}`);
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(state.enabled ? 0x00ff87 : 0xff4444)
        .setTitle(`🤖 Bot Status — ${state.enabled ? '🟢 Active' : '🔴 Disabled'}`)
        .addFields({
        name: '📡 Market Regimes',
        value: regimeLines,
        inline: false,
    }, {
        name: '📅 Today',
        value: `P&L: **${pnlStr}**  |  Daily loss limit: ${config_1.config.trading.maxDailyLoss}R`,
        inline: false,
    }, {
        name: '📊 Signals',
        value: `Pending: **${pending.length}**  |  Active positions: **${active.length}** / ${config_1.config.trading.maxOpenPositions}`,
        inline: false,
    }, {
        name: '⚖️ Strategy Weights',
        value: stratWeights,
        inline: false,
    }, {
        name: '⚙️ Settings',
        value: [
            `Min score: ${config_1.config.trading.minScoreThreshold}`,
            `Risk: ELITE 2% | STRONG 1.5% | MEDIUM 1% of capital`,
            `Max lev (scalp): ${config_1.config.trading.maxLeverageScalp}x`,
            `Max lev (swing): ${config_1.config.trading.maxLeverageSwing}x`,
            `Scan interval: ${config_1.config.engine.scanIntervalMinutes} min`,
        ].join('  |  '),
        inline: false,
    })
        .setTimestamp();
    if (errors.length > 0) {
        embed.addFields({
            name: '⚠️ Errors (partial data shown)',
            value: errors.map((e) => `• ${e}`).join('\n').slice(0, 1024),
            inline: false,
        });
    }
    await interaction.editReply({ embeds: [embed] });
}
//# sourceMappingURL=status.js.map