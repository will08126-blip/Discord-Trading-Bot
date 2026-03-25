import { execSync } from 'child_process';
import { sessions_spawn } from '../../../openclaw/sessions';
import { logger } from '../utils/logger';
import { config } from '../config';
import type { PerformanceData, OptimizationAnalysis } from './types';

/**
 * Spawns a subagent to analyze trading performance and recommend optimizations.
 * This replaces the direct Claude API call with an OpenClaw subagent session.
 */
export async function analyzeWithSubagent(data: PerformanceData): Promise<OptimizationAnalysis> {
  logger.info('[Subagent] Spawning optimization analysis agent...');

  const taskPrompt = buildSubagentTaskPrompt(data);

  try {
    // Spawn a subagent session for the analysis
    const result = await sessions_spawn({
      runtime: 'subagent',
      mode: 'run',
      task: taskPrompt,
      timeoutSeconds: 120,
      sandbox: 'inherit',
    });

    // Parse the result - expect JSON output from subagent
    const response = result.output || result.result || '';
    
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in subagent response');
    }

    const analysis: OptimizationAnalysis = JSON.parse(jsonMatch[0]);
    
    logger.info(`[Subagent] Analysis complete. Confidence: ${analysis.confidence}`);
    return analysis;

  } catch (error) {
    logger.error('[Subagent] Analysis failed:', error);
    // Fallback to simple rule-based analysis if subagent fails
    return generateFallbackAnalysis(data);
  }
}

/**
 * Build the task prompt for the subagent analyzer
 */
function buildSubagentTaskPrompt(data: PerformanceData): string {
  return `You are an expert trading systems analyst AI. Analyze the following trading bot performance data and recommend specific parameter optimizations.

## Performance Data (Last ${data.daysBack} Days)

**Overall Stats:**
- Total Trades: ${data.tradeCount}
- Win Rate: ${(data.overallStats.winRate * 100).toFixed(1)}%
- Profit Factor: ${data.overallStats.profitFactor.toFixed(2)}
- Total P&L: $${data.overallStats.totalPnL.toFixed(2)}
- Average Trade: $${data.overallStats.avgTrade.toFixed(2)}

**Strategy Performance:**
${Object.entries(data.strategyStats).map(([strategy, stats]) => `
### ${strategy}
- Trades: ${stats.trades}
- Win Rate: ${(stats.winRate * 100).toFixed(1)}%
- Total P&L: $${stats.totalPnL.toFixed(2)}
- Average P&L: $${stats.avgPnL.toFixed(2)}
${Object.entries(stats.byRegime).length > 0 ? `- By Regime:\n${Object.entries(stats.byRegime).map(([regime, rstats]) => `  - ${regime}: ${rstats.trades} trades, ${(rstats.winRate * 100).toFixed(1)}% WR, $${rstats.pnl.toFixed(2)}`).join('\n')}` : ''}
`).join('\n')}

**Current Configuration:**
\`\`\`json
${JSON.stringify(data.currentConfig, null, 2)}
\`\`\`

**Recent Trades (Last 20):**
${data.rawTrades.slice(0, 20).map((t, i) => `${i+1}. ${new Date(t.closedAt).toISOString().slice(0,10)} | ${t.signal.strategy} | ${t.signal.direction} | ${t.signal.tradeType} | Score: ${t.signal.score} | P&L: $${t.pnlDollar.toFixed(2)} | Regime: ${t.signal.regime || 'UNKNOWN'}`).join('\n')}

## Your Task

Analyze this data deeply. Look for:
1. **Patterns** - Which strategies work in which market regimes?
2. **Thresholds** - Where does win rate drop significantly? Identify optimal score cutoffs
3. **Underperformers** - Strategies with <40% win rate or negative expectancy
4. **Overperformers** - Strategies with >55% win rate that could be weighted higher
5. **Regime sensitivity** - Strategies that excel/fail in specific conditions

Return ONLY a JSON object in this exact format:

\`\`\`json
{
  "confidence": 8,
  "recommendedAction": "OPTIMIZE_PARAMETERS",
  "summary": {
    "title": "Raise scalp threshold in chop, increase Swing weight",
    "description": "Analysis shows scalp strategies win only 34% when ADX < 20 but 62% when ADX > 25. Recommending higher score threshold for scalp and increased weight for Swing which performs consistently across regimes.",
    "shortDescription": "ADX-aware scalp optimization"
  },
  "parameterChanges": [
    {
      "file": "scalp_params.json",
      "parameter": "minScoreScalp",
      "currentValue": 65,
      "newValue": 75,
      "reasoning": "Scalp win rate is 34% below score 75 but 62% above. Threshold increase saves ~$120/month in chop losses."
    },
    {
      "file": "data/state.json",
      "parameter": "strategyWeights.Swing",
      "currentValue": 1.0,
      "newValue": 1.15,
      "reasoning": "Swing maintains 58% WR across all regimes. Modest weight increase captures more high-quality setups."
    }
  ],
  "expectedImpact": "Improve overall win rate from ${(data.overallStats.winRate * 100).toFixed(1)}% to ~52%, reduce chop-related losses by 30%",
  "riskAssessment": "Changes based on 40+ trades across 7 days. Conservative adjustments with clear statistical backing. Worst case: slightly fewer signals but higher quality.",
  "alternateActions": [
    {
      "action": "PAUSE_SCALP_IN_CHOP",
      "reason": "If volatility remains compressed, consider completely disabling scalp strategies when ADX < 15"
    }
  ]
}
\`\`\`

Requirements:
- Only recommend changes with at least 10 trades of supporting data
- Be specific with exact values, not ranges
- Every change MUST have clear statistical reasoning
- Confidence 1-10 based on data quality
- If no changes warranted, return action: "NO_CHANGE"

Respond ONLY with the JSON. No other text.`,
    });
}

/**
 * Fallback rule-based analysis if subagent fails
 */
function generateFallbackAnalysis(data: PerformanceData): OptimizationAnalysis {
  logger.warn('[Subagent] Using fallback rule-based analysis');
  
  const changes: any[] = [];
  let confidence = 5;
  
  // Simple rule: If a strategy has < 40% WR with 10+ trades, reduce its floor
  for (const [strategy, stats] of Object.entries(data.strategyStats)) {
    if (stats.trades >= 10 && stats.winRate < 0.40) {
      changes.push({
        file: 'src/adaptation/adaptation.ts',
        parameter: `STRATEGY_WEIGHT_FLOOR.${strategy}`,
        currentValue: getCurrentFloor(strategy),
        newValue: Math.max(0.40, getCurrentFloor(strategy) - 0.10),
        reasoning: `${strategy} has ${(stats.winRate * 100).toFixed(0)}% WR over ${stats.trades} trades. Reducing exposure.`,
      });
      confidence += 1;
    }
    
    // If strategy has > 60% WR, increase weight
    if (stats.trades >= 10 && stats.winRate > 0.60) {
      changes.push({
        file: 'data/state.json',
        parameter: `strategyWeights.${strategy}`,
        currentValue: 1.0,
        newValue: 1.10,
        reasoning: `${strategy} performing excellently at ${(stats.winRate * 100).toFixed(0)}% WR. Capturing more signals.`,
      });
      confidence += 1;
    }
  }
  
  return {
    confidence: Math.min(confidence, 7),
    recommendedAction: changes.length > 0 ? 'OPTIMIZE_PARAMETERS' : 'NO_CHANGE',
    summary: {
      title: changes.length > 0 ? 'Rule-based parameter adjustments' : 'No significant changes detected',
      description: changes.length > 0 
        ? `Detected ${changes.length} strategies needing adjustment based on win rate thresholds.`
        : 'Performance within acceptable ranges. No changes recommended.',
      shortDescription: changes.length > 0 ? 'Automated adjustments' : 'No action needed',
    },
    parameterChanges: changes,
    expectedImpact: changes.length > 0 
      ? 'Improve win rate by reducing exposure to underperforming strategies'
      : 'Maintain current performance',
    riskAssessment: 'Rule-based fallback analysis. Conservative adjustments.',
  };
}

function getCurrentFloor(strategy: string): number {
  const floors: Record<string, number> = {
    'Trend Pullback': 0.75,
    'Breakout Retest': 0.75,
    'Liquidity Sweep': 0.80,
    'Volatility Expansion': 0.50,
    'Swing': 0.70,
  };
  return floors[strategy] || 0.60;
}
