"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const adaptation_1 = require("../../adaptation/adaptation");
const config_1 = require("../../config");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('toggle')
    .setDescription('Enable or disable signal scanning')
    .addStringOption((opt) => opt
    .setName('state')
    .setDescription('Turn scanning on or off')
    .setRequired(true)
    .addChoices({ name: 'On — enable scanning', value: 'on' }, { name: 'Off — disable scanning', value: 'off' }));
async function execute(interaction) {
    const state = interaction.options.getString('state', true);
    const enabled = state === 'on';
    (0, adaptation_1.toggleBot)(enabled);
    await interaction.reply({
        content: enabled
            ? `✅ Bot **enabled** — scanning for setups every ${config_1.config.engine.scanIntervalMinutes} minutes.`
            : '⛔ Bot **disabled** — no new signals will be posted until you re-enable.',
        ephemeral: false,
    });
}
//# sourceMappingURL=toggle.js.map