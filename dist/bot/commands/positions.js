"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataAlias = exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const signalManager_1 = require("../../signals/signalManager");
const riskCalculator_1 = require("../../risk/riskCalculator");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('positions')
    .setDescription('List all currently tracked (confirmed) positions');
// Singular alias — registered separately in index.ts so both /position and /positions work
exports.dataAlias = new discord_js_1.SlashCommandBuilder()
    .setName('position')
    .setDescription('List all currently tracked (confirmed) positions');
async function execute(interaction) {
    // Use reply() directly — getAllActivePositions() is a synchronous in-memory read,
    // so this completes in <1ms, well within the 3-second interaction window.
    const positions = (0, signalManager_1.getAllActivePositions)();
    if (positions.length === 0) {
        await interaction.reply({
            content: [
                '📭 **No confirmed positions tracked.**',
                '',
                'To track a trade, click the **✅ Entered LONG** or **✅ Entered SHORT** button',
                'under any signal posted in this channel — the bot will then monitor it for you.',
                '',
                'Use `/status` to see the full bot status.',
            ].join('\n'),
        });
        return;
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x8888ff)
        .setTitle(`📋 Active Positions (${positions.length})`)
        .setDescription('Use the **Close** buttons below to manually exit a trade.')
        .setTimestamp();
    for (const pos of positions) {
        const asset = pos.signal.asset.split('/')[0];
        const isLong = pos.signal.direction === 'LONG';
        const held = Math.round((Date.now() - pos.confirmedAt) / 60000);
        // Live P&L from entry — no price fetch, use last known values
        const pnlPct = isLong
            ? (pos.highestPrice - pos.entryPrice) / pos.entryPrice
            : (pos.entryPrice - pos.lowestPrice) / pos.entryPrice;
        const stopDist = Math.abs(pos.entryPrice - pos.currentStopLoss) / pos.entryPrice;
        const rMultiple = stopDist > 0 ? pnlPct / stopDist : 0;
        const capitalReturn = pnlPct * pos.suggestedLeverage;
        const pnlLine = `P&L peak: **${(0, riskCalculator_1.formatPct)(pnlPct)}** (${rMultiple.toFixed(1)}R) | Capital: **${(0, riskCalculator_1.formatPct)(capitalReturn)}**`;
        embed.addFields({
            name: `${isLong ? '🟢' : '🔴'} ${asset} ${pos.signal.direction}  (ID: ${pos.id.slice(0, 8)})`,
            value: [
                `Entry: **${(0, riskCalculator_1.formatPrice)(pos.entryPrice, asset)}**  |  Held: ${held} min`,
                `SL: ${(0, riskCalculator_1.formatPrice)(pos.currentStopLoss, asset)}${pos.currentStopLoss !== pos.signal.stopLoss ? ' *(trailing)*' : ''}`,
                `TP: ${(0, riskCalculator_1.formatPrice)(pos.currentTakeProfit, asset)}${pos.currentTakeProfit !== pos.signal.takeProfit ? ' *(extended)*' : ''}`,
                `Lev: **${pos.suggestedLeverage}x**  |  Type: ${pos.signal.tradeType}  |  Score: ${pos.signal.score}`,
                pnlLine,
            ].join('\n'),
            inline: false,
        });
    }
    // One close button per position — use array form of addComponents (v14-safe)
    const buttons = positions.map((pos) => new discord_js_1.ButtonBuilder()
        .setCustomId(`closePosition:${pos.id}`)
        .setLabel(`Close ${pos.signal.asset.split('/')[0]}`)
        .setStyle(discord_js_1.ButtonStyle.Danger)
        .setEmoji('🔴'));
    const row = new discord_js_1.ActionRowBuilder().addComponents(buttons);
    await interaction.reply({ embeds: [embed], components: [row] });
}
//# sourceMappingURL=positions.js.map