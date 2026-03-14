"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const tracker_1 = require("../../performance/tracker");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('history')
    .setDescription('Show recent closed trades')
    .addIntegerOption((opt) => opt
    .setName('count')
    .setDescription('Number of trades to show (default 5, max 20)')
    .setMinValue(1)
    .setMaxValue(20)
    .setRequired(false));
async function execute(interaction) {
    const count = interaction.options.getInteger('count') ?? 5;
    await interaction.deferReply({ ephemeral: true });
    const trades = (0, tracker_1.loadTrades)().slice(-count).reverse();
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📜 Last ${count} Closed Trade${count !== 1 ? 's' : ''}`)
        .setTimestamp();
    if (trades.length === 0) {
        embed.setDescription('_No closed trades yet._');
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    const lines = trades.map((t) => {
        const date = new Date(t.closedAt).toISOString().slice(0, 10);
        const rStr = t.pnlDollar >= 0 ? `+${t.pnlDollar.toFixed(2)}R` : `${t.pnlDollar.toFixed(2)}R`;
        const dir = t.signal.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        return `**${t.signal.asset}** ${dir} | ${t.signal.strategy} | ${rStr} | ${t.exitReason} | ${date}`;
    });
    // Truncate to Discord's 4096-char description limit
    const desc = lines.join('\n');
    embed.setDescription(desc.length > 4096 ? desc.slice(0, 4093) + '…' : desc);
    await interaction.editReply({ embeds: [embed] });
}
//# sourceMappingURL=history.js.map