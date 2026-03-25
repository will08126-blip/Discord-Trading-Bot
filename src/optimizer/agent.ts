import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { analyzeTradePerformance, getPerformanceSummary } from './analyzer';
import { createOptimizationPR } from './github';
import { buildAnalysisPrompt, buildParameterPrompt, formatProposedChanges } from './prompts';
import type { OptimizationAnalysis, PerformanceData, ProposedChanges } from './types';

/**
 * AI Parameter Optimizer Agent
 * 
 * Analyzes trading performance and automatically proposes parameter changes
 * via GitHub Pull Requests. Combines statistical analysis with LLM reasoning
to identify optimization opportunities.
 */

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    if (!config.anthropic?.apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured — optimizer requires AI analysis');
    }
    anthropicClient = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return anthropicClient;
}

/**
 * Main entry point: analyze performance and propose optimizations
 */
export async function runOptimizationAgent(options: {
  dryRun?: boolean;
  daysBack?: number;
  minTrades?: number;
} = {}): Promise<{
  success: boolean;
  analysis?: OptimizationAnalysis;
  prUrl?: string;
  error?: string;
}> {
  const { dryRun = false, daysBack = 7, minTrades = 20 } = options;

  try {
    logger.info(`[Optimizer] Starting analysis (last ${daysBack} days, min ${minTrades} trades)`);

    // Step 1: Gather performance data
    const performance = await getPerformanceData(daysBack, minTrades);
    if (!performance.hasEnoughData) {
      return {
        success: false,
        error: `Insufficient trade data. Found ${performance.tradeCount} trades, need at least ${minTrades}.`,
      };
    }

    logger.info(`[Optimizer] Analyzing ${performance.tradeCount} trades across ${Object.keys(performance.strategyStats).length} strategies`);

    // Step 2: AI analysis of performance patterns
    const analysis = await analyzeWithAI(performance);
    logger.info(`[Optimizer] AI analysis complete. Confidence: ${analysis.confidence}, Action: ${analysis.recommendedAction}`);

    // Step 3: If no changes needed, return early
    if (analysis.recommendedAction === 'NO_CHANGE' || analysis.parameterChanges.length === 0) {
      return {
        success: true,
        analysis,
        error: 'No optimizations recommended at this time.',
      };
    }

    // Step 4: Generate the code changes
    const changes = await generateCodeChanges(analysis);

    if (dryRun) {
      logger.info('[Optimizer] Dry run mode — logging changes without creating PR');
      logProposedChanges(changes);
      return {
        success: true,
        analysis,
      };
    }

    // Step 5: Create GitHub PR with changes
    const prUrl = await createOptimizationPR({
      analysis,
      changes,
      performance,
    });

    logger.info(`[Optimizer] Pull Request created: ${prUrl}`);

    return {
      success: true,
      analysis,
      prUrl,
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Optimizer] Error:', msg);
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Gather comprehensive performance data for analysis
 */
async function getPerformanceData(daysBack: number, minTrades: number): Promise<PerformanceData> {
  const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

  // Load trade data
  const trades = loadTrades();
  const recentTrades = trades.filter(t => t.closedAt >= cutoffTime);

  // Basic stats
  const tradeCount = recentTrades.length;
  const winningTrades = recentTrades.filter(t => t.pnlDollar > 0);
  const losingTrades = recentTrades.filter(t => t.pnlDollar <= 0);

  const totalPnL = recentTrades.reduce((sum, t) => sum + t.pnlDollar, 0);
  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnlDollar, 0);
  const grossLoss = losingTrades.reduce((sum, t) => sum + t.pnlDollar, 0);

  // Strategy breakdown
  const strategyStats: Record<string, {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnL: number;
    totalPnL: number;
    avgRR: number;
    byRegime: Record<string, { trades: number; winRate: number; pnl: number }>;
  }> = {};

  for (const trade of recentTrades) {
    const strategy = trade.signal.strategy;
    if (!strategyStats[strategy]) {
      strategyStats[strategy] = {
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgPnL: 0,
        totalPnL: 0,
        avgRR: 0,
        byRegime: {},
      };
    }

    const stats = strategyStats[strategy];
    stats.trades++;
    stats.totalPnL += trade.pnlDollar;

    if (trade.pnlDollar > 0) {
      stats.wins++;
    } else {
      stats.losses++;
    }

    // Track by market regime
    const regime = trade.signal.regime || 'UNKNOWN';
    if (!stats.byRegime[regime]) {
      stats.byRegime[regime] = { trades: 0, winRate: 0, pnl: 0 };
    }
    stats.byRegime[regime].trades++;
    stats.byRegime[regime].pnl += trade.pnlDollar;
  }

  // Calculate derived metrics
  for (const strategy of Object.keys(strategyStats)) {
    const stats = strategyStats[strategy];
    stats.winRate = stats.trades > 0 ? stats.wins / stats.trades : 0;
    stats.avgPnL = stats.trades > 0 ? stats.totalPnL / stats.trades : 0;

    // Calculate average R:R from trades
    const rrValues = recentTrades
      .filter(t => t.signal.strategy === strategy && t.pnlPct !== undefined)
      .map(t => Math.abs(t.pnlPct / ((t.exitPrice - t.entryPrice) / t.entryPrice)));
    stats.avgRR = rrValues.length > 0
      ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length
      : 0;

    // Calculate regime win rates
    for (const regime of Object.keys(stats.byRegime)) {
      const regimeData = stats.byRegime[regime];
      const regimeTrades = recentTrades.filter(
        t => t.signal.strategy === strategy && t.signal.regime === regime
      );
      const regimeWins = regimeTrades.filter(t => t.pnlDollar > 0).length;
      regimeData.winRate = regimeTrades.length > 0 ? regimeWins / regimeTrades.length : 0;
    }
  }

  // Load current config values
  const currentConfig = loadCurrentConfig();

  return {
    hasEnoughData: tradeCount >= minTrades,
    tradeCount,
    daysBack,
    dateRange: {
      start: new Date(cutoffTime).toISOString(),
      end: new Date().toISOString(),
    },
    overallStats: {
      winRate: tradeCount > 0 ? winningTrades.length / tradeCount : 0,
      profitFactor: grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : 0,
      totalPnL,
      avgTrade: tradeCount > 0 ? totalPnL / tradeCount : 0,
    },
    strategyStats,
    currentConfig,
    rawTrades: recentTrades.slice(0, 50), // Last 50 for detailed analysis
  };
}

/**
 * Load trade data from storage
 */
function loadTrades(): any[] {
  const dataPath = path.join(config.paths.data, 'trades.json');
  if (!fs.existsSync(dataPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(dataPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Load current configuration values
 */
function loadCurrentConfig(): Record<string, any> {
  // Load from various config sources
  const configData: Record<string, any> = {
    trading: { ...config.trading },
    scoring: {},
    adaptation: {},
  };

  // Load scalp params if exists
  const scalpPath = path.join(config.paths.data, 'scalp_params.json');
  if (fs.existsSync(scalpPath)) {
    try {
      configData.scalpParams = JSON.parse(fs.readFileSync(scalpPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  // Load adaptation state
  const statePath = config.paths.stateFile;
  if (fs.existsSync(statePath)) {
    try {
      configData.adaptation = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  return configData;
}

/**
 * Use AI to analyze performance and recommend changes
 */
async function analyzeWithAI(data: PerformanceData): Promise<OptimizationAnalysis> {
  const client = getAnthropicClient();

  const prompt = buildAnalysisPrompt(data);

  const response = await client.messages.create({
    model: config.anthropic.model || 'claude-3-opus-20240229',
    max_tokens: 2048,
    system: `You are an expert trading systems analyst. Your job is to analyze bot performance data and identify specific, actionable parameter optimizations.

Rules:
1. Only recommend changes with statistical backing (at least 10 trades for a pattern)
2. Focus on parameters that can be changed in code (thresholds, weights, multipliers)
3. Explain the reasoning behind each change
4. Consider market regime context when making recommendations
5. Never suggest changes that would increase risk without clear evidence
6. Format your response as valid JSON`,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('AI returned non-text response');
  }

  // Parse the JSON response
  try {
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response');
    }
    return JSON.parse(jsonMatch[0]) as OptimizationAnalysis;
  } catch (error) {
    logger.error('Failed to parse AI analysis:', error);
    logger.debug('Raw response:', content.text);
    throw new Error('Failed to parse AI analysis response');
  }
}

/**
 * Generate actual code changes based on AI recommendations
 */
async function generateCodeChanges(analysis: OptimizationAnalysis): Promise<ProposedChanges> {
  const changes: ProposedChanges = {
    files: {},
    summary: analysis.summary,
  };

  for (const paramChange of analysis.parameterChanges) {
    switch (paramChange.file) {
      case 'scalp_params.json':
        changes.files['data/scalp_params.json'] = generateScalpParamsChange(paramChange);
        break;
      case 'state.json':
        changes.files['data/state.json'] = generateStateChange(paramChange);
        break;
      case 'config.ts':
        changes.files['src/config.ts'] = generateConfigChange(paramChange);
        break;
      case 'adaptation.ts':
        changes.files['src/adaptation/adaptation.ts'] = generateAdaptationChange(paramChange);
        break;
      default:
        logger.warn(`[Optimizer] Unknown target file: ${paramChange.file}`);
    }
  }

  return changes;
}

function generateScalpParamsChange(change: any): any {
  // Implementation depends on the specific change type
  return {
    type: 'json',
    description: change.reasoning,
    patch: change.newValue,
  };
}

function generateStateChange(change: any): any {
  return {
    type: 'json',
    description: change.reasoning,
    patch: change.newValue,
  };
}

function generateConfigChange(change: any): any {
  return {
    type: 'typescript',
    description: change.reasoning,
    search: change.currentValue,
    replace: change.newValue,
  };
}

function generateAdaptationChange(change: any): any {
  return {
    type: 'typescript',
    description: change.reasoning,
    search: change.currentValue,
    replace: change.newValue,
  };
}

/**
 * Log proposed changes in dry-run mode
 */
function logProposedChanges(changes: ProposedChanges): void {
  logger.info('[Optimizer] Proposed Changes:');
  logger.info('================================');
  
  for (const [file, change] of Object.entries(changes.files)) {
    logger.info(`\nFile: ${file}`);
    logger.info(`Description: ${(change as any).description}`);
    logger.info(`Type: ${(change as any).type}`);
    if ((change as any).patch) {
      logger.info(`Patch: ${JSON.stringify((change as any).patch, null, 2)}`);
    }
    if ((change as any).search) {
      logger.info(`Search: ${(change as any).search}`);
      logger.info(`Replace: ${(change as any).replace}`);
    }
  }
  
  logger.info('\n================================');
}
