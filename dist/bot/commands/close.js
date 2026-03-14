"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const signalManager_1 = require("../../signals/signalManager");
const embeds_1 = require("../embeds");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('close')
    .setDescription('Record that you manually closed a position')
    .addStringOption((opt) => opt
    .setName('id')
    .setDescription('Position ID prefix (leave blank if only one trade is open)')
    .setRequired(false))
    .addNumberOption((opt) => opt
    .setName('price')
    .setDescription('The price at which you exited the trade')
    .setRequired(true));
async function execute(interaction) {
    const shortId = interaction.options.getString('id')?.trim() ?? null;
    const exitPrice = interaction.options.getNumber('price', true);
    const positions = (0, signalManager_1.getAllActivePositions)();
    let position;
    if (shortId) {
        // ID was provided — match by prefix
        position = positions.find((p) => p.id.startsWith(shortId));
        if (!position) {
            await interaction.reply({
                content: `❌ No active position found with ID starting with \`${shortId}\`. Use \`/positions\` to see active positions.`,
                ephemeral: true,
            });
            return;
        }
    }
    else {
        // No ID — auto-select if exactly one position is active
        if (positions.length === 0) {
            await interaction.reply({
                content: '❌ No active positions to close.',
                ephemeral: true,
            });
            return;
        }
        if (positions.length > 1) {
            const list = positions
                .map((p) => `• \`${p.id.slice(0, 8)}\` — ${p.signal.asset.split('/')[0]} ${p.signal.direction}`)
                .join('\n');
            await interaction.reply({
                content: `❌ Multiple active positions — please specify an ID:\n${list}\n\nExample: \`/close id:${positions[0].id.slice(0, 8)} price:${exitPrice}\``,
                ephemeral: true,
            });
            return;
        }
        position = positions[0];
    }
    const trade = (0, signalManager_1.closePositionManually)(position.id, exitPrice);
    if (!trade) {
        await interaction.reply({ content: '❌ Failed to close position.', ephemeral: true });
        return;
    }
    const msg = (0, embeds_1.buildClosedTradeEmbed)(trade);
    await interaction.reply(msg);
}
//# sourceMappingURL=close.js.map