import type { PerformanceData } from './types';

/**
 * Build the AI prompt for performance analysis
 */
export function buildAnalysisPrompt(data: PerformanceData): string {
  const sections: string[] = [];
  
  sections.push(`Analyze the following trading bot performance data and recommend specific parameter optimizations.`);
  sections.push('');
  
  // Overall Performance
  sections.push(`## Overall Performance (Last ${data.daysBack} Days)`);
  sections.push(`- Total Trades: ${data.tradeCount}`);
  sections.push(`- Win Rate: ${(data.overallStats.winRate * 100).toFixed(1)}%`);
  sections.push(`- Profit Factor: ${data.overallStats.profitFactor.toFixed(2)}`);
  sections.push(`- Total P&L: $${data.overallStats.totalPnL.toFixed(2)}`);
  sections.push(`- Average Trade: $${data.overallStats.avgTrade.toFixed(2)}`);
  sections.push('');
  
  // Strategy Performance
  sections.push('## Strategy Performance Breakdown');
  for (const [strategy, stats] of Object.entries(data.strategyStats)) {
    sections.push(`\n### ${strategy}`);
    sections.push(`- Trades: ${stats.trades}`);
    sections.push(`- Win Rate: ${(stats.winRate * 100).toFixed(1)}%`);
    sections.push(`- Total P&L: $${stats.totalPnL.toFixed(2)}`);
    sections.push(`- Average P&L: $${stats.avgPnL.toFixed(2)}`);
    
    if (Object.keys(stats.byRegime).length > 0) {
      sections.push('- Performance by Regime:');
      for (const [regime, regimeStats] of Object.entries(stats.byRegime)) {
        sections.push(`  - ${regime}: ${regimeStats.trades} trades, ${(regimeStats.winRate * 100).toFixed(1)}% WR, $${regimeStats.pnl.toFixed(2)}`);
      }
    }
  }
  sections.push('');
  
  // Current Configuration
  sections.push('## Current Configuration Values');
  sections.push(`\`\`\`json\n${JSON.stringify(data.currentConfig, null, 2)}\n\`\`\``);
  sections.push('');
  
  // Recent Trade Details (last 20)
  sections.push('## Recent Trades (Last 20)');
  const recentTrades = data.rawTrades.slice(0, 20);
  for (const trade of recentTrades) {
    sections.push(`- ${new Date(trade.closedAt).toISOString().slice(0, 10)} | ${trade.signal.strategy} | ${trade.signal.direction} | ${trade.signal.tradeType} | Score: ${trade.signal.score} | P&L: $${trade.pnlDollar.toFixed(2)} | Regime: ${trade.signal.regime || 'UNKNOWN'}`);
  }
  sections.push('');
  
  // Output Format Instructions
  sections.push('## Required Output Format');
  sections.push('Respond with ONLY a JSON object in this exact format:');
  sections.push('');
  sections.push(`\`\`\`json
{
  "confidence": 8,
  "recommendedAction": "OPTIMIZE_PARAMETERS",
  "summary": {
    "title": "Reduce scalp frequency in low ADX conditions",
    "description": "Analysis shows scalp strategies underperforming when ADX < 20. Recommending threshold adjustments and reduced position sizing during chop.",
    "shortDescription": "ADX-based scalp optimization"
  },
  "parameterChanges": [
    {
      "file": "scalp_params.json",
      "parameter": "minScoreScalp",
      "currentValue": 65,
      "newValue": 72,
      "reasoning": "Scalp win rate drops to 38% when score < 72 vs 61% when >= 72. Raising threshold improves expectancy."
    },
    {
      "file": "src/adaptation/adaptation.ts",
      "parameter": "STRATEGY_WEIGHT_FLOOR[Scalp FVG]",
      "currentValue": 0.50,
      "newValue": 0.65,
      "reasoning": "Scalp FVG benefiting from strategy weight floors. Testing higher floor to maintain participation during drawdowns."
    }
  ],
  "expectedImpact": "Improve win rate by 5-8% and reduce chop-related losses",
  "riskAssessment": "Changes are conservative and based on 47+ trades of data. Risk of over-optimization is low. Worst case: slightly fewer signals.",
  "alternateActions": [
    {
      "action": "PAUSE_SCALP",
      "reason": "If chop continues next week, consider pausing scalp entirely"
    }
  ]
}
\`\`\``);
  sections.push('');
  sections.push('## Analysis Guidelines');
  sections.push('1. Look for patterns: Which strategies work in which regimes?');
  sections.push('2. Identify thresholds: Where does win rate drop significantly?');
  sections.push('3. Consider sample size: Need at least 10 trades for a pattern to be valid');
  sections.push('4. Be specific: Recommend exact parameter values, not ranges');
  sections.push('5. Provide reasoning: Every change must have statistical backing');
  sections.push('6. Risk-aware: Consider what happens if the change is wrong');
  sections.push('7. Confidence: Rate 1-10 based on data quality and pattern strength');
  sections.push('');
  sections.push('If no changes are warranted, return recommendedAction: "NO_CHANGE" with explanation.');
  
  return sections.join('\n');
}

/**
 * Build prompt for parameter optimization (if additional AI refinement needed)
 */
export function buildParameterPrompt(currentValue: any, context: string): string {
  return `Based on the following context and performance data, suggest an optimized value:

Context: ${context}

Current Value: ${JSON.stringify(currentValue)}

Suggest a new value and explain your reasoning. Focus on finding the value that maximizes expectancy (win rate × avg win - loss rate × avg loss).`;
}

/**
 * Format proposed changes for logging
 */
export function formatProposedChanges(changes: any[]): string {
  return changes.map((c, i) => 
    `${i + 1}. ${c.parameter}: ${JSON.stringify(c.currentValue)} → ${JSON.stringify(c.newValue)} (${c.reasoning.slice(0, 80)}...)`
  ).join('\n');
}
