"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const engine_1 = require("../../engine");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('scan')
    .setDescription('Manually trigger an immediate market scan for new trade setups');
async function execute(interaction) {
    await interaction.deferReply();
    const result = await (0, engine_1.runScanCycle)();
    const embed = new discord_js_1.EmbedBuilder().setTimestamp();
    if (result.skipped) {
        embed
            .setColor(0xff9900)
            .setTitle('⏸ Scan Skipped')
            .setDescription(`Scan was not run: **${result.reason ?? 'unknown reason'}**`);
    }
    else if (result.signalCount > 0) {
        embed
            .setColor(0x00ff87)
            .setTitle('🔍 Scan Complete')
            .setDescription(`Found **${result.signalCount}** qualifying signal${result.signalCount !== 1 ? 's' : ''} — check the signals channel.`);
    }
    else {
        embed
            .setColor(0x5865f2)
            .setTitle('🔍 Scan Complete')
            .setDescription('No qualifying signals this cycle.\n\n' +
            'Possible reasons:\n' +
            '• All assets in POOR/unfavourable regime\n' +
            '• Strategies not finding setups in current market structure\n' +
            '• Scores suppressed by adaptation weights (check `/status`)\n' +
            '• Same signals already sent recently (10-min duplicate window)\n\n' +
            'Run `/status` to see strategy weights and regimes, or `/check BTC` to inspect a specific asset.');
    }
    await interaction.editReply({ embeds: [embed] });
}
//# sourceMappingURL=scan.js.map