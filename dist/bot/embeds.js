"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSignalEmbed = buildSignalEmbed;
exports.buildPositionEmbed = buildPositionEmbed;
exports.buildExitAlertEmbed = buildExitAlertEmbed;
exports.buildTPUpdateEmbed = buildTPUpdateEmbed;
exports.buildCheckSummaryEmbed = buildCheckSummaryEmbed;
exports.buildWatchlistEmbed = buildWatchlistEmbed;
exports.buildEarlyProfitAlertEmbed = buildEarlyProfitAlertEmbed;
exports.buildClosedTradeEmbed = buildClosedTradeEmbed;
const discord_js_1 = require("discord.js");
const riskCalculator_1 = require("../risk/riskCalculator");
const regimeDetector_1 = require("../regime/regimeDetector");
const votingEngine_1 = require("../scoring/votingEngine");
const config_1 = require("../config");
const LINE = '━━━━━━━━━━━━━━━━━━━━━━━';
function dirEmoji(dir) {
    return dir === 'LONG' ? '🟢' : '🔴';
}
function pct(price, reference) {
    const p = ((price - reference) / reference) * 100;
    return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}
/**
 * Renders a 10-dot emoji scale showing capital deployment confidence.
 * Dot colour reflects conviction level; unfilled dots are shown as ⚪.
 *
 *   score ≥ 70 → 🟢  |  40–69 → 🟡  |  < 40 → 🔴
 *
 * Example (score 82):
 *   🟢🟢🟢🟢🟢🟢🟢🟢🟡⚪  82/100
 *   VERY HIGH — strong conditions to size up
 */
function buildDeploymentMeter(score) {
    const filled = Math.round(score / 10);
    const dot = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
    const dots = dot.repeat(filled) + '⚪'.repeat(10 - filled);
    const label = score >= 80 ? 'VERY HIGH — strong conditions to size up' :
        score >= 60 ? 'HIGH — solid conditions' :
            score >= 40 ? 'MODERATE — be selective with size' :
                'LOW — consider sitting this one out';
    return `${dots}  ${score}/100\n${label}`;
}
// ─── Signal embed ─────────────────────────────────────────────────────────────
function buildSignalEmbed(signal) {
    const risk = (0, riskCalculator_1.calculateRisk)(signal);
    const asset = signal.asset.split('/')[0];
    const entry = risk.entryPrice;
    const title = `${(0, votingEngine_1.tierEmoji)(signal.tier)} ${signal.tier} ${signal.direction}  —  ${asset}/USDT`;
    const tradeTypeLabel = signal.tradeType === 'SCALP' ? '⚡ Scalp' : signal.tradeType === 'HYBRID' ? '🔀 Hybrid' : '🌊 Swing';
    const embed = new discord_js_1.EmbedBuilder()
        .setColor((0, votingEngine_1.tierColor)(signal.tier))
        .setTitle(title)
        .setDescription(`**Strategy:** ${signal.strategy}  |  ${tradeTypeLabel}  |  **Score:** ${signal.score}/100\n` +
        `**Regime:** ${(0, regimeDetector_1.regimeLabel)(signal.regime)}`)
        .addFields({
        name: LINE,
        value: [
            `📍 **Entry Zone:**  ${(0, riskCalculator_1.formatPrice)(signal.entryZone[0], asset)} – ${(0, riskCalculator_1.formatPrice)(signal.entryZone[1], asset)}`,
            `🎯 **Take Profit:** ${(0, riskCalculator_1.formatPrice)(signal.takeProfit, asset)}  (${pct(signal.takeProfit, entry)})`,
            `📐 **R:R:** ${risk.rewardRiskRatio.toFixed(2)}:1  |  **Lev:** ${risk.suggestedLeverage}x`,
        ].join('\n'),
        inline: false,
    }, {
        name: '💰 Capital Deployment Confidence',
        value: buildDeploymentMeter(risk.deploymentScore),
        inline: false,
    }, {
        name: LINE,
        value: [
            `HTF Align ${signal.components.htfAlignment}/20  |  Setup ${signal.components.setupQuality}/20  |  Momentum ${signal.components.momentum}/15`,
            `Volatility ${signal.components.volatilityQuality}/10  |  Regime ${signal.components.regimeFit}/10  |  Liquidity ${signal.components.liquidity}/10`,
            `Slippage ${signal.components.slippageRisk}/5  |  Session ${signal.components.sessionQuality}/5  |  Perf ${signal.components.recentPerformance}/5`,
            signal.notes ? `\n📝 ${signal.notes}` : '',
        ].filter(Boolean).join('\n'),
        inline: false,
    }, {
        name: LINE,
        value: '**Took this trade on your exchange?** Click ✅ **Entered** below — the bot will track it for you and alert you when to exit.',
        inline: false,
    })
        .setTimestamp(signal.timestamp)
        .setFooter({ text: `Signal ID: ${signal.id.slice(0, 8)}` });
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(`enter:${signal.id}`)
        .setLabel(`Entered ${signal.direction}`)
        .setStyle(signal.direction === 'LONG' ? discord_js_1.ButtonStyle.Success : discord_js_1.ButtonStyle.Danger)
        .setEmoji('✅'), new discord_js_1.ButtonBuilder()
        .setCustomId(`dismiss:${signal.id}`)
        .setLabel('Dismiss')
        .setStyle(discord_js_1.ButtonStyle.Secondary)
        .setEmoji('❌'));
    return { embeds: [embed], components: [row] };
}
// ─── Position tracking embed ──────────────────────────────────────────────────
function buildPositionEmbed(position, currentPrice) {
    const asset = position.signal.asset.split('/')[0];
    const isLong = position.signal.direction === 'LONG';
    const unrealizedPnlPct = currentPrice
        ? (isLong
            ? (currentPrice - position.entryPrice) / position.entryPrice
            : (position.entryPrice - currentPrice) / position.entryPrice)
        : null;
    const pnlLine = unrealizedPnlPct !== null
        ? `📊 **Unrealised P&L:** ${unrealizedPnlPct >= 0 ? '+' : ''}${(unrealizedPnlPct * 100).toFixed(2)}%`
        : '';
    const priceLine = currentPrice
        ? `💹 **Current Price:** ${(0, riskCalculator_1.formatPrice)(currentPrice, asset)}`
        : '';
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(isLong ? 0x00cc44 : 0xff4444)
        .setTitle(`${dirEmoji(position.signal.direction)} TRACKING: ${asset} ${position.signal.direction}`)
        .setDescription('Your trade is being tracked. When you close it on your exchange, click **Close Position** below — the bot will fetch the current price for you.')
        .addFields({
        name: LINE,
        value: [
            `📍 **Entry:** ${(0, riskCalculator_1.formatPrice)(position.entryPrice, asset)}`,
            `🎯 **Current TP:** ${(0, riskCalculator_1.formatPrice)(position.currentTakeProfit, asset)}  ${position.currentTakeProfit !== position.signal.takeProfit ? '*(extended)*' : ''}`,
            priceLine,
            pnlLine,
            `📐 **Leverage:** ${position.suggestedLeverage}x`,
            `⚡ **Type:** ${position.signal.tradeType}  |  **Strategy:** ${position.signal.strategy}`,
        ].filter(Boolean).join('\n'),
        inline: false,
    })
        .setTimestamp()
        .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });
    const closeRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(`closePosition:${position.id}`)
        .setLabel('Close Position')
        .setStyle(discord_js_1.ButtonStyle.Danger)
        .setEmoji('🔴'));
    return { embeds: [embed], components: [closeRow] };
}
// ─── Exit alert embed ─────────────────────────────────────────────────────────
function buildExitAlertEmbed(position, type, currentPrice, newTP) {
    const asset = position.signal.asset.split('/')[0];
    const isLong = position.signal.direction === 'LONG';
    const labels = {
        TP_APPROACH: { emoji: '🔔', title: 'TP APPROACHING', color: 0x00ccff, desc: 'Price is near your take profit. Consider locking in gains.' },
        TP_HIT: { emoji: '🎯', title: 'TAKE PROFIT HIT', color: 0x00ff00, desc: 'Your take profit has been hit. Exit the trade on your exchange, then click **Close Position** below to record it.' },
    };
    const { emoji, title, color, desc } = labels[type];
    const pnlPct = isLong
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(color)
        .setTitle(`${emoji} ${asset} ${position.signal.direction} — ${title}`)
        .setDescription(desc)
        .addFields({
        name: LINE,
        value: [
            `💹 **Current Price:** ${(0, riskCalculator_1.formatPrice)(currentPrice, asset)}`,
            `📍 **Entry:** ${(0, riskCalculator_1.formatPrice)(position.entryPrice, asset)}`,
            newTP ? `🎯 **TP (updated):** ${(0, riskCalculator_1.formatPrice)(newTP, asset)}` : `🎯 **TP:** ${(0, riskCalculator_1.formatPrice)(position.currentTakeProfit, asset)}`,
            `📊 **Unrealised P&L:** ${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(2)}%`,
        ].filter(Boolean).join('\n'),
        inline: false,
    })
        .setTimestamp()
        .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });
    const closeRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(`closePosition:${position.id}`)
        .setLabel('Close Position')
        .setStyle(discord_js_1.ButtonStyle.Danger)
        .setEmoji('🔴'));
    return { embeds: [embed], components: [closeRow] };
}
// ─── TP update embed ──────────────────────────────────────────────────────────
function buildTPUpdateEmbed(position, oldTP, newTP, currentPrice) {
    const asset = position.signal.asset.split('/')[0];
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x8888ff)
        .setTitle(`🔄 ${asset} ${position.signal.direction} — Take Profit Extended`)
        .addFields({
        name: 'Level Changes',
        value: [
            `🎯 TP: ${(0, riskCalculator_1.formatPrice)(oldTP, asset)} → **${(0, riskCalculator_1.formatPrice)(newTP, asset)}**`,
            `💹 Current: ${(0, riskCalculator_1.formatPrice)(currentPrice, asset)}`,
        ].join('\n'),
        inline: false,
    })
        .setTimestamp()
        .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });
    return { embeds: [embed] };
}
// ─── /check summary embed ─────────────────────────────────────────────────────
function buildCheckSummaryEmbed(result) {
    const assetLabel = result.asset.split('/')[0];
    const regimeStr = result.regime ? (0, regimeDetector_1.regimeLabel)(result.regime.regime) : 'Unknown';
    const adxStr = result.regime ? ` (ADX: ${result.regime.adx.toFixed(1)}, ATR×: ${result.regime.atrRatio.toFixed(2)})` : '';
    const strategyNames = ['Trend Pullback', 'Breakout Retest', 'Liquidity Sweep', 'Volatility Expansion'];
    const signalsByStrategy = new Map(result.signals.map((s) => [s.strategy, s]));
    const strategyLines = strategyNames.map((name) => {
        const s = signalsByStrategy.get(name);
        if (!s)
            return `**${name}** — no pattern detected`;
        const risk = (0, riskCalculator_1.calculateRisk)(s);
        return (`**${name}** — ${dirEmoji(s.direction)} ${s.direction}  |  ` +
            `Score: **${s.score}/100** ${(0, votingEngine_1.tierEmoji)(s.tier)}  |  ` +
            `Lev: **${risk.suggestedLeverage}x**  |  Risk: **${risk.riskPct}%**`);
    });
    return new discord_js_1.EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🔍 ${assetLabel}/USDT — Manual Scan`)
        .setDescription(`**Regime:** ${regimeStr}${adxStr}`)
        .addFields({
        name: LINE,
        value: strategyLines.join('\n'),
        inline: false,
    })
        .setTimestamp()
        .setFooter({ text: 'Qualifying signals (score ≥ 60) posted below with full details' });
}
// ─── /watchlist + /live summary embed ─────────────────────────────────────────
function buildWatchlistEmbed(results, isLive = false) {
    const lines = results.map((result) => {
        const assetLabel = result.asset.split('/')[0];
        if (result.error) {
            return `**${assetLabel}** — ⚠️ fetch error`;
        }
        const regimeStr = result.regime ? (0, regimeDetector_1.regimeLabel)(result.regime.regime) : '?';
        const qualifying = result.signals.filter((s) => s.tier !== 'NO_TRADE');
        if (qualifying.length === 0) {
            return `**${assetLabel}** — no setup  *(${regimeStr})*`;
        }
        return qualifying.map((s) => {
            const risk = (0, riskCalculator_1.calculateRisk)(s);
            return (`**${assetLabel}** ${dirEmoji(s.direction)} ${s.direction}  |  ` +
                `Score: **${s.score}** ${(0, votingEngine_1.tierEmoji)(s.tier)}  |  ` +
                `Lev: **${risk.suggestedLeverage}x**  |  Risk: **${risk.riskPct}%**  ` +
                `*(${s.strategy})*`);
        }).join('\n');
    });
    const title = isLive ? '📡 Live Watchlist — BTC · ETH · SOL · XRP · PEPE' : '📊 Watchlist Scan — BTC · ETH · SOL · XRP · PEPE';
    const footer = isLive ? `🔄 Auto-refreshes every ${config_1.config.engine.scanIntervalMinutes} min — use /live stop to stop` : 'Use /check <symbol> for full signal details';
    const fullValue = lines.join('\n') || 'No setups found across watchlist.';
    // Discord embed field values must be ≤1024 chars — truncate if needed
    const fieldValue = fullValue.length > 1024 ? fullValue.slice(0, 1021) + '…' : fullValue;
    return {
        embeds: [
            new discord_js_1.EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(title)
                .addFields({ name: LINE, value: fieldValue, inline: false })
                .setTimestamp()
                .setFooter({ text: footer }),
        ],
    };
}
// ─── Early profit alert embed ─────────────────────────────────────────────────
function buildEarlyProfitAlertEmbed(position, currentPrice, returnOnCapital // fraction, e.g. 0.50 = 50%
) {
    const asset = position.signal.asset.split('/')[0];
    const isLong = position.signal.direction === 'LONG';
    const pnlPct = isLong
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`💰 ${asset} ${position.signal.direction} — Early Profit Target Hit!`)
        .setDescription(`Your position has returned **+${(returnOnCapital * 100).toFixed(0)}%** on capital ` +
        `at **${position.suggestedLeverage}x** leverage. Consider taking profits or tightening your stop.`)
        .addFields({
        name: LINE,
        value: [
            `💹 **Current Price:** ${(0, riskCalculator_1.formatPrice)(currentPrice, asset)}`,
            `📍 **Entry:** ${(0, riskCalculator_1.formatPrice)(position.entryPrice, asset)}`,
            `📊 **Price Move:** +${(pnlPct * 100).toFixed(2)}%`,
            `💰 **Capital Return (${position.suggestedLeverage}x):** +${(returnOnCapital * 100).toFixed(0)}%`,
            `🎯 **Full TP:** ${(0, riskCalculator_1.formatPrice)(position.currentTakeProfit, asset)}`,
        ].join('\n'),
        inline: false,
    })
        .setTimestamp()
        .setFooter({ text: `Position ID: ${position.id.slice(0, 8)}` });
    const closeRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(`closePosition:${position.id}`)
        .setLabel('Close Position')
        .setStyle(discord_js_1.ButtonStyle.Success)
        .setEmoji('💰'));
    return { embeds: [embed], components: [closeRow] };
}
// ─── Closed trade embed ────────────────────────────────────────────────────────
function buildClosedTradeEmbed(trade) {
    const asset = trade.signal.asset.split('/')[0];
    const isWin = trade.pnlDollar > 0; // pnlDollar stores R-multiple
    const rMultiple = trade.pnlDollar;
    const pnlStr = `${(trade.pnlPct * 100).toFixed(2)}%  (${rMultiple >= 0 ? '+' : ''}${rMultiple.toFixed(2)}R)`;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(isWin ? 0x00ff87 : 0xff4444)
        .setTitle(`${isWin ? '✅' : '❌'} ${asset} ${trade.signal.direction} — Trade Closed`)
        .addFields({
        name: LINE,
        value: [
            `📍 **Entry:** ${(0, riskCalculator_1.formatPrice)(trade.entryPrice, asset)}`,
            `🚪 **Exit:** ${(0, riskCalculator_1.formatPrice)(trade.exitPrice, asset)}`,
            `📊 **P&L:** ${pnlStr}`,
            `🔑 **Exit reason:** ${trade.exitReason}`,
            `⚡ **Type:** ${trade.signal.tradeType}  |  **Strategy:** ${trade.signal.strategy}`,
            `🎯 **Score:** ${trade.signal.score}/100`,
        ].join('\n'),
        inline: false,
    })
        .setTimestamp(trade.closedAt)
        .setFooter({ text: `Session closed` });
    return { embeds: [embed] };
}
//# sourceMappingURL=embeds.js.map