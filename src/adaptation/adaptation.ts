import fs from 'fs';
import type { BotState, ClosedTrade } from '../types';
import { config } from '../config';
import { strategyWinRate, computeStats, loadTrades, dailyPnl } from '../performance/tracker';
import { logger } from '../utils/logger';

const STRATEGY_NAMES = [
  'Trend Pullback',
  'Breakout Retest',
  'Liquidity Sweep',
  'Volatility Expansion',
];

const DEFAULT_STATE: BotState = {
  enabled: config.engine.enabled,
  dailyLoss: 0,
  dailyLossDate: '',
  consecutiveLosses: 0,
  riskMultiplier: 1.0,
  recoveryTradesLeft: 0,
  strategyWeights: Object.fromEntries(STRATEGY_NAMES.map((n) => [n, 1.0])),
};

// ─── State persistence ────────────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(config.paths.data)) {
    fs.mkdirSync(config.paths.data, { recursive: true });
  }
}

export function loadState(): BotState {
  ensureDataDir();
  if (!fs.existsSync(config.paths.stateFile)) return { ...DEFAULT_STATE };
  try {
    const raw = fs.readFileSync(config.paths.stateFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BotState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    logger.warn('Could not load state.json, using defaults');
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: BotState): void {
  ensureDataDir();
  fs.writeFileSync(config.paths.stateFile, JSON.stringify(state, null, 2));
}

// ─── Adaptation logic ─────────────────────────────────────────────────────────

/**
 * Called after every confirmed closed trade.
 * Updates riskMultiplier, strategyWeights, and cooldown state.
 */
export function onTradeClosed(trade: ClosedTrade): BotState {
  const state = loadState();
  const trades = loadTrades();
  const stats = computeStats(trades);

  // Update consecutive losses
  state.consecutiveLosses = stats.consecutiveLosses;

  // After 3+ consecutive losses → reduce risk for next 5 trades
  if (state.consecutiveLosses >= 3 && state.recoveryTradesLeft === 0) {
    state.riskMultiplier = Math.max(0.25, state.riskMultiplier * 0.75);
    state.recoveryTradesLeft = 5;
    logger.warn(
      `3 consecutive losses — risk reduced to ${(state.riskMultiplier * 100).toFixed(0)}% for next 5 trades`
    );
  }

  // Count down recovery trades
  if (state.recoveryTradesLeft > 0) {
    state.recoveryTradesLeft--;
    if (state.recoveryTradesLeft === 0 && state.consecutiveLosses === 0) {
      // Restore risk after recovery
      state.riskMultiplier = Math.min(1.0, state.riskMultiplier + 0.25);
      logger.info(`Recovery complete — risk multiplier restored to ${state.riskMultiplier}`);
    }
  }

  // Strategy weights: halve weight if < 40% win rate over last 10 trades
  for (const name of STRATEGY_NAMES) {
    const wr = strategyWinRate(name, 10);
    if (wr < 0.40) {
      state.strategyWeights[name] = Math.max(0.5, (state.strategyWeights[name] ?? 1.0) * 0.85);
      logger.info(`Strategy "${name}" underperforming (WR=${(wr * 100).toFixed(0)}%) — weight=${state.strategyWeights[name].toFixed(2)}`);
    } else if (wr >= 0.55) {
      // Restore towards 1.0 on good performance
      state.strategyWeights[name] = Math.min(1.0, (state.strategyWeights[name] ?? 1.0) + 0.05);
    }
  }

  // Check daily loss limit
  const pnlToday = dailyPnl();
  const today = new Date().toISOString().slice(0, 10);
  state.dailyLossDate = today;
  state.dailyLoss = pnlToday;

  if (pnlToday <= -config.trading.maxDailyLoss) {
    state.enabled = false;
    logger.warn(`Daily loss limit hit ($${pnlToday.toFixed(2)}) — scanning disabled for today`);
  }

  saveState(state);
  return state;
}

/**
 * Check hard controls at the start of each scan cycle.
 * Returns { allowed: boolean, reason: string }
 */
export function checkHardControls(): { allowed: boolean; reason: string } {
  const state = loadState();

  if (!state.enabled) {
    return { allowed: false, reason: 'Bot is disabled (use /toggle to re-enable)' };
  }

  // Daily loss check
  const today = new Date().toISOString().slice(0, 10);
  if (state.dailyLossDate === today && state.dailyLoss <= -config.trading.maxDailyLoss) {
    return {
      allowed: false,
      reason: `Daily loss limit of $${config.trading.maxDailyLoss} reached`,
    };
  }

  return { allowed: true, reason: '' };
}

export function toggleBot(enabled: boolean): BotState {
  const state = loadState();
  state.enabled = enabled;
  saveState(state);
  logger.info(`Bot ${enabled ? 'enabled' : 'disabled'} by user`);
  return state;
}

/** Get strategy weight, defaulting to 1.0 */
export function getStrategyWeight(strategyName: string): number {
  const state = loadState();
  return state.strategyWeights[strategyName] ?? 1.0;
}

/** Get current risk multiplier */
export function getRiskMultiplier(): number {
  return loadState().riskMultiplier;
}
