"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const signalManager_1 = require("../../signals/signalManager");
const riskCalculator_1 = require("../../risk/riskCalculator");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('positions')
    .setDescription('List all currently tracked (confirmed) positions');
async function execute(interaction) {
    await interaction.deferReply();
    const positions = (0, signalManager_1.getAllActivePositions)();
    if (positions.length === 0) {
        await interaction.editReply({ content: '📭 No active positions being tracked.' });
        return;
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x8888ff)
        .setTitle(`📋 Active Positions (${positions.length})`)
        .setTimestamp();
    for (const pos of positions) {
        const asset = pos.signal.asset.split('/')[0];
        const isLong = pos.signal.direction === 'LONG';
        const held = Math.round((Date.now() - pos.confirmedAt) / 60000);
        embed.addFields({
            name: `${isLong ? '🟢' : '🔴'} ${asset} ${pos.signal.direction}  (ID: ${pos.id.slice(0, 8)})`,
            value: [
                `Entry: **${(0, riskCalculator_1.formatPrice)(pos.entryPrice, asset)}**`,
                `SL: ${(0, riskCalculator_1.formatPrice)(pos.currentStopLoss, asset)}${pos.currentStopLoss !== pos.signal.stopLoss ? ' *(trailing)*' : ''}`,
                `TP: ${(0, riskCalculator_1.formatPrice)(pos.currentTakeProfit, asset)}${pos.currentTakeProfit !== pos.signal.takeProfit ? ' *(extended)*' : ''}`,
                `Lev: ${pos.suggestedLeverage}x  |  Type: ${pos.signal.tradeType}  |  Held: ${held} min`,
            ].join('\n'),
            inline: false,
        });
    }
    // One close button per position (bot caps at 3 open positions — fits in one row)
    const buttons = positions.map((pos) => new discord_js_1.ButtonBuilder()
        .setCustomId(`closePosition:${pos.id}`)
        .setLabel(`Close ${pos.signal.asset.split('/')[0]}`)
        .setStyle(discord_js_1.ButtonStyle.Danger)
        .setEmoji('🔴'));
    const row = new discord_js_1.ActionRowBuilder().addComponents(...buttons);
    await interaction.editReply({ embeds: [embed], components: [row] });
}
//# sourceMappingURL=positions.js.map