"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const summaries_1 = require("../../llm/summaries");
const config_1 = require("../../config");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('report')
    .setDescription('Generate a performance report using AI')
    .addStringOption((opt) => opt
    .setName('type')
    .setDescription('Report type')
    .setRequired(true)
    .addChoices({ name: 'Daily', value: 'daily' }, { name: 'Weekly', value: 'weekly' }));
async function execute(interaction) {
    const type = interaction.options.getString('type', true);
    await interaction.deferReply();
    const summary = type === 'daily'
        ? await (0, summaries_1.generateDailySummary)()
        : await (0, summaries_1.generateWeeklySummary)();
    // Discord message limit is 2000 chars — chunk if needed
    if (summary.length <= 2000) {
        await interaction.editReply(summary);
    }
    else {
        const chunks = summary.match(/[\s\S]{1,1900}/g) ?? [summary];
        await interaction.editReply(chunks[0]);
        for (const chunk of chunks.slice(1)) {
            await interaction.followUp(chunk);
        }
    }
    // Also post to summary channel if different
    if (interaction.channelId !== config_1.config.discord.summaryChannelId) {
        const summaryChannel = await interaction.client.channels.fetch(config_1.config.discord.summaryChannelId);
        if (summaryChannel?.isTextBased()) {
            await summaryChannel.send(summary.slice(0, 2000));
        }
    }
}
//# sourceMappingURL=report.js.map