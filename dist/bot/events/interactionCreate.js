"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onInteractionCreate = onInteractionCreate;
const discord_js_1 = require("discord.js");
const index_1 = require("../commands/index");
const signalManager_1 = require("../../signals/signalManager");
const embeds_1 = require("../embeds");
const marketData_1 = require("../../data/marketData");
const logger_1 = require("../../utils/logger");
const config_1 = require("../../config");
async function onInteractionCreate(interaction) {
    // ── Slash commands ────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
        const command = index_1.commands.get(interaction.commandName);
        if (!command)
            return;
        try {
            await command.execute(interaction);
        }
        catch (err) {
            logger_1.logger.error(`Command /${interaction.commandName} error:`, err);
            const msg = { content: '❌ An error occurred running this command.', ephemeral: true };
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(msg);
                }
                else {
                    await interaction.reply(msg);
                }
            }
            catch (replyErr) {
                // Interaction token likely expired (e.g. CCXT hung for >15 min).
                // Log and swallow — there is nothing else we can do at this point.
                logger_1.logger.warn(`Could not send error response for /${interaction.commandName}:`, replyErr);
            }
        }
        return;
    }
    // ── Button interactions ────────────────────────────────────────────────────
    if (interaction.isButton()) {
        const colonIdx = interaction.customId.indexOf(':');
        if (colonIdx === -1)
            return; // malformed customId — ignore
        const action = interaction.customId.slice(0, colonIdx);
        const payload = interaction.customId.slice(colonIdx + 1);
        if (action === 'dismiss') {
            (0, signalManager_1.dismissPendingSignal)(payload);
            await interaction.update({ content: '❌ Signal dismissed.', embeds: [], components: [] });
            return;
        }
        if (action === 'enter') {
            const signal = (0, signalManager_1.getPendingSignal)(payload);
            if (!signal) {
                await interaction.reply({ content: '⚠️ Signal expired or already confirmed.', ephemeral: true });
                return;
            }
            // Use the midpoint of the entry zone as the assumed entry price
            const entryPrice = (signal.entryZone[0] + signal.entryZone[1]) / 2;
            const position = (0, signalManager_1.confirmEntry)(payload, entryPrice, interaction.message.id, interaction.channelId);
            if (!position) {
                await interaction.reply({
                    content: `⚠️ Could not confirm — max positions (${config_1.config.trading.maxOpenPositions}) already reached.`,
                    ephemeral: true,
                });
                return;
            }
            // Update the original signal message to remove buttons, then post tracking embed
            await interaction.update({ components: [] });
            const trackMsg = (0, embeds_1.buildPositionEmbed)(position);
            await interaction.followUp(trackMsg);
            logger_1.logger.info(`Position confirmed via button: ${signal.asset} ${signal.direction} @ ${entryPrice}`);
            return;
        }
        if (action === 'closePosition') {
            const positionId = payload;
            const position = (0, signalManager_1.getActivePosition)(positionId);
            if (!position) {
                await interaction.reply({
                    content: '⚠️ This position is no longer active — it may have already been closed.',
                    ephemeral: true,
                });
                return;
            }
            const asset = position.signal.asset.split('/')[0];
            // Fetch current live market price to pre-fill the modal
            let priceValue;
            try {
                const currentPrice = await (0, marketData_1.fetchCurrentPrice)(position.signal.asset);
                if (currentPrice > 0) {
                    // Format price based on asset magnitude
                    const decimals = currentPrice < 0.01 ? 8 : currentPrice < 1 ? 6 : 2;
                    priceValue = currentPrice.toFixed(decimals);
                }
            }
            catch (err) {
                logger_1.logger.warn(`Could not fetch current price for ${position.signal.asset}:`, err);
                // Modal will show with empty input so user can type manually
            }
            const modal = new discord_js_1.ModalBuilder()
                .setCustomId(`closeModal:${positionId}`)
                .setTitle(`Close ${asset} ${position.signal.direction}`);
            const priceInput = new discord_js_1.TextInputBuilder()
                .setCustomId('exitPrice')
                .setLabel('Exit Price')
                .setStyle(discord_js_1.TextInputStyle.Short)
                .setPlaceholder('e.g. 65432.00')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(20);
            if (priceValue !== undefined) {
                priceInput.setValue(priceValue);
            }
            modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(priceInput));
            await interaction.showModal(modal);
            return;
        }
    }
    // ── Modal submissions ──────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
        const colonIdx = interaction.customId.indexOf(':');
        const modalAction = interaction.customId.slice(0, colonIdx);
        const positionId = interaction.customId.slice(colonIdx + 1);
        if (modalAction === 'closeModal') {
            await interaction.deferReply();
            const rawPrice = interaction.fields.getTextInputValue('exitPrice').trim();
            const exitPrice = parseFloat(rawPrice);
            if (isNaN(exitPrice) || exitPrice <= 0) {
                await interaction.editReply({
                    content: `❌ Invalid price: \`${rawPrice}\` — please enter a positive number (e.g. \`65432.10\`).`,
                });
                return;
            }
            // Re-check: position could have been auto-closed by SL/TP between button click and submit
            const position = (0, signalManager_1.getActivePosition)(positionId);
            if (!position) {
                await interaction.editReply({
                    content: '⚠️ Position no longer active — it may have been automatically closed by a stop loss or take profit.',
                });
                return;
            }
            const trade = (0, signalManager_1.closePositionManually)(positionId, exitPrice);
            if (!trade) {
                await interaction.editReply({
                    content: '❌ Failed to close position. Try `/close` as a fallback.',
                });
                return;
            }
            const msg = (0, embeds_1.buildClosedTradeEmbed)(trade);
            await interaction.editReply(msg);
            return;
        }
    }
}
//# sourceMappingURL=interactionCreate.js.map