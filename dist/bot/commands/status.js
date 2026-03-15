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
    // Use reply() directly — all data is in-memory so this completes in <100ms,
    // well within Discord's 3-second interaction window. Avoids the deferReply+editReply
    // two-step chain that can silently fail when either network call errors.
    const errors = [];
    // 1. Load bot state with inline fallback to avoid TS definite-assignment issues
    let state = { enabled: false, dailyLoss: 0, dailyLossDate: '', strategyWeights: {} };
    try {
        state = (0, adaptation_1.loadState)();
    }
    catch (err) {
        errors.push(`loadState: ${String(err)}`);
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
    // 6. Active position summary
    let positionSummary = 'None';
    if (active.length > 0) {
        positionSummary = active
            .map((p) => {
            const dir = p.signal.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
            const asset = p.signal.asset.split('/')[0];
            const heldMin = Math.round((Date.now() - p.confirmedAt) / 60000);
            return `${dir} **${asset}** @ ${p.entryPrice.toFixed(2)} — held ${heldMin}m`;
        })
            .join('\n');
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
        value: `Pending: **${pending.length}**  |  Active: **${active.length}** / ${config_1.config.trading.maxOpenPositions}`,
        inline: false,
    }, {
        name: '📈 Open Positions',
        value: positionSummary,
        inline: false,
    }, {
        name: '⚖️ Strategy Weights',
        value: stratWeights,
        inline: false,
    }, {
        name: '⚙️ Settings',
        value: [
            `Min score: **${config_1.config.trading.minScoreThreshold}**`,
            `Max positions: **${config_1.config.trading.maxOpenPositions}**`,
            `Lev caps: scalp **${config_1.config.trading.maxLeverageScalp}x** | swing **${config_1.config.trading.maxLeverageSwing}x**`,
            `Scan: every **${config_1.config.engine.scanIntervalMinutes} min**`,
            `Profit alert: **${(config_1.config.trading.earlyProfitAlertPct * 100).toFixed(0)}%** capital return`,
            `Auto-close TP: **${(config_1.config.trading.targetReturnPct * 100).toFixed(0)}%** capital return`,
        ].join('\n'),
        inline: false,
    })
        .setFooter({ text: `Type /positions to see detailed position info  •  /help for all commands` })
        .setTimestamp();
    if (errors.length > 0) {
        embed.addFields({
            name: '⚠️ Errors (partial data shown)',
            value: errors.map((e) => `• ${e}`).join('\n').slice(0, 1024),
            inline: false,
        });
    }
    await interaction.reply({ embeds: [embed] });
}
//# sourceMappingURL=status.js.map