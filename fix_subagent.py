import sys

with open('src/optimizer/subagent.ts', 'r') as f:
    lines = f.readlines()

old_text = ''.join(lines[49:136])
print('Old text length:', len(old_text))

# Create new text
new_text = '''function buildSubagentTaskPrompt(data: PerformanceData): string {
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
${Object.entries(stats.byRegime).length > 0 ? `- By Regime:\\n${Object.entries(stats.byRegime).map(([regime, rstats]) => `  - ${regime}: ${rstats.trades} trades, ${(rstats.winRate * 100).toFixed(1)}% WR, $${rstats.pnl.toFixed(2)}`).join('\\n')}` : ''}
`).join('\\n')}

**Current Configuration:**
\\`\\`\\`json
${JSON.stringify(data.currentConfig, null, 2)}
\\`\\`\\`

**Recent Trades (Last 20):**
${data.rawTrades.slice(0, 20).map((t, i) => `${i+1}. ${new Date(t.closedAt).toISOString().slice(0,10)} | ${t.signal.strategy} | ${t.signal.direction} | ${t.signal.tradeType} | Score: ${t.signal.score} | P&L: $${t.pnlDollar.toFixed(2)} | Regime: ${t.signal.regime || 'UNKNOWN'}`).join('\\n')}

## Your Task

Analyze this data deeply. Look for:
1. **Patterns** - Which strategies work in which market regimes?
2. **Thresholds** - Where does win rate drop significantly? Identify optimal score cutoffs
3. **Underperformers** - Strategies with <40% win rate or negative expectancy
4. **Overperformers** - Strategies with >55% win rate that could be weighted higher
5. **Regime sensitivity** - Strategies that excel/fail in specific conditions

Return ONLY a JSON object in this exact format:

\\`\\`\\`json
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
\\`\\`\\`

Requirements:
- Only recommend changes with at least 10 trades of supporting data
- Be specific with exact values, not ranges
- Every change MUST have clear statistical reasoning
- Confidence 1-10 based on data quality
- If no changes warranted, return action: "NO_CHANGE"

Respond ONLY with the JSON. No other text.`;\n}'''

print('New text length:', len(new_text))

# Replace lines 49-135 (inclusive) with new_text (single line)
# First, set lines 49-135 to empty strings
for i in range(49, 136):
    lines[i] = ''
lines[49] = new_text

with open('src/optimizer/subagent.ts', 'w') as f:
    f.writelines(lines)
print('File updated')

# Verify by reading back
with open('src/optimizer/subagent.ts', 'r') as f:
    content = f.read()
    if 'function buildSubagentTaskPrompt' in content:
        print('Success')
    else:
        print('Failure')