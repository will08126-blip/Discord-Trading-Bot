import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { runOptimizationAgent } from '../../optimizer/agent';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('optimize')
  .setDescription('Run AI parameter optimizer to analyze performance and propose changes')
  .addStringOption((opt) =>
    opt
      .setName('mode')
      .setDescription('Run mode')
      .setRequired(false)
      .addChoices(
        { name: 'Dry Run (analyze only)', value: 'dry' },
        { name: 'Create PR', value: 'live' }
      )
  )
  .addIntegerOption((opt) =>
    opt
      .setName('days')
      .setDescription('Number of days to analyze (default: 7)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(30)
  )
  .addIntegerOption((opt) =>
    opt
      .setName('min_trades')
      .setDescription('Minimum trades required for analysis (default: 20)')
      .setRequired(false)
      .setMinValue(10)
      .setMaxValue(100)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const mode = (interaction.options.getString('mode') as 'dry' | 'live') || 'dry';
  const daysBack = interaction.options.getInteger('days') || 7;
  const minTrades = interaction.options.getInteger('min_trades') || 20;

  await interaction.deferReply();

  const dryRun = mode === 'dry';

  try {
    const embed = new EmbedBuilder()
      .setTitle('🤖 AI Parameter Optimizer')
      .setDescription(`Running analysis (${dryRun ? 'dry run' : 'live PR creation'})...`)
      .setColor(0x0099ff)
      .addFields(
        { name: 'Analysis Period', value: `${daysBack} days`, inline: true },
        { name: 'Min Trades', value: `${minTrades}`, inline: true },
        { name: 'Mode', value: dryRun ? '🔍 Analysis Only' : '⚡ Create PR', inline: true }
      );

    await interaction.editReply({ embeds: [embed] });

    const result = await runOptimizationAgent({
      dryRun,
      daysBack,
      minTrades,
    });

    if (result.success) {
      const successEmbed = new EmbedBuilder();

      if (result.analysis) {
        const { analysis } = result;

        if (analysis.recommendedAction === 'NO_CHANGE') {
          successEmbed
            .setTitle('✅ No Changes Recommended')
            .setDescription(analysis.summary?.description || 'The AI analyzed your performance and found everything is within optimal ranges.')
            .setColor(0x00ff00);
        } else {
          successEmbed
            .setTitle(`🔧 ${analysis.summary?.title || 'Optimization Proposed'}`)
            .setDescription(analysis.summary?.description || '')
            .setColor(dryRun ? 0xffaa00 : 0x00ff00)
            .addFields(
              { name: 'Confidence', value: `${analysis.confidence}/10`, inline: true },
              { name: 'Expected Impact', value: analysis.expectedImpact || 'Unknown', inline: true },
              {
                name: 'Changes Proposed',
                value: analysis.parameterChanges?.length
                  ? analysis.parameterChanges.map((c: any, i: number) => `${i + 1}. \`${c.parameter}\`: ${JSON.stringify(c.currentValue)} → ${JSON.stringify(c.newValue)}`).join('\n')
                  : 'No parameter changes',
              }
            );

          if (result.prUrl) {
            successEmbed.addFields({
              name: '📝 Pull Request',
              value: `[View PR on GitHub](${result.prUrl})`,
            });
          }

          successEmbed.addFields({
            name: '⚠️ Risk Assessment',
            value: analysis.riskAssessment || 'No risk assessment provided',
          });
        }
      }

      await interaction.editReply({ embeds: [successEmbed] });
    } else {
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Optimization Failed')
        .setDescription(result.error || 'Unknown error occurred')
        .setColor(0xff0000);

      await interaction.editReply({ embeds: [errorEmbed] });
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('\/optimize error:', msg);

    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Error')
      .setDescription(`Failed to run optimizer: ${msg}`)
      .setColor(0xff0000);

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}
