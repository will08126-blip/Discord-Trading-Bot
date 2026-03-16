"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECOMMENDED_WEIGHTS = void 0;
exports.loadState = loadState;
exports.saveState = saveState;
exports.onTradeClosed = onTradeClosed;
exports.checkHardControls = checkHardControls;
exports.toggleBot = toggleBot;
exports.getStrategyWeight = getStrategyWeight;
exports.getMinScoreThreshold = getMinScoreThreshold;
exports.setMinScoreThreshold = setMinScoreThreshold;
exports.resetStrategyWeights = resetStrategyWeights;
exports.setStrategyWeight = setStrategyWeight;
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
const tracker_1 = require("../performance/tracker");
const logger_1 = require("../utils/logger");
const STRATEGY_NAMES = [
    'Trend Pullback',
    'Breakout Retest',
    'Liquidity Sweep',
    'Volatility Expansion',
];
/**
 * How far the adaptation system can reduce each strategy's weight.
 * Reflects user preferences: Liquidity Sweep/Breakout/Trend are high priority;
 * Volatility Expansion is a bonus signal (user didn't select it as a priority).
 */
const STRATEGY_WEIGHT_FLOOR = {
    'Trend Pullback': 0.75,
    'Breakout Retest': 0.75,
    'Liquidity Sweep': 0.80,
    'Volatility Expansion': 0.50,
};
/**
 * Recommended starting weights — used on reset and as the DEFAULT_STATE.
 * Trend Pullback / Breakout Retest / Liquidity Sweep are equal at 1.0 (all user-preferred).
 * Volatility Expansion starts at 0.85 — valid signal but lower user priority.
 */
exports.RECOMMENDED_WEIGHTS = {
    'Trend Pullback': 1.0,
    'Breakout Retest': 1.0,
    'Liquidity Sweep': 1.0,
    'Volatility Expansion': 0.85,
};
const DEFAULT_STATE = {
    enabled: config_1.config.engine.enabled,
    dailyLoss: 0,
    dailyLossDate: '',
    strategyWeights: { ...exports.RECOMMENDED_WEIGHTS },
};
// ─── State persistence ────────────────────────────────────────────────────────
function ensureDataDir() {
    if (!fs_1.default.existsSync(config_1.config.paths.data)) {
        fs_1.default.mkdirSync(config_1.config.paths.data, { recursive: true });
    }
}
function loadState() {
    ensureDataDir();
    if (!fs_1.default.existsSync(config_1.config.paths.stateFile))
        return { ...DEFAULT_STATE };
    try {
        const raw = fs_1.default.readFileSync(config_1.config.paths.stateFile, 'utf-8');
        const parsed = JSON.parse(raw);
        // Ensure all strategy weights exist
        const weights = { ...DEFAULT_STATE.strategyWeights, ...(parsed.strategyWeights ?? {}) };
        return { ...DEFAULT_STATE, ...parsed, strategyWeights: weights };
    }
    catch {
        logger_1.logger.warn('Could not load state.json, using defaults');
        return { ...DEFAULT_STATE };
    }
}
function saveState(state) {
    ensureDataDir();
    const tmp = config_1.config.paths.stateFile + '.tmp';
    fs_1.default.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs_1.default.renameSync(tmp, config_1.config.paths.stateFile);
}
// ─── Adaptation logic ─────────────────────────────────────────────────────────
/**
 * Called after every confirmed closed trade.
 * Adjusts strategy weights based on win rate, and checks daily loss limit.
 * No cooldowns or risk reductions — the user decides position sizing.
 */
function onTradeClosed(_trade) {
    const state = loadState();
    // Update strategy weights based on recent win rates
    for (const name of STRATEGY_NAMES) {
        const wr = (0, tracker_1.strategyWinRate)(name, 10);
        if (wr < 0.40) {
            // Underperforming — reduce weight gradually, but never below the user-preference floor
            const floor = STRATEGY_WEIGHT_FLOOR[name] ?? 0.50;
            state.strategyWeights[name] = Math.max(floor, (state.strategyWeights[name] ?? 1.0) * 0.90);
            logger_1.logger.info(`Strategy "${name}" WR=${(wr * 100).toFixed(0)}% — weight → ${state.strategyWeights[name].toFixed(2)}`);
        }
        else if (wr >= 0.55) {
            // Good performance — restore towards 1.0
            state.strategyWeights[name] = Math.min(1.0, (state.strategyWeights[name] ?? 1.0) + 0.05);
        }
    }
    // Check daily loss limit
    const pnlToday = (0, tracker_1.dailyPnl)();
    const today = new Date().toISOString().slice(0, 10);
    state.dailyLossDate = today;
    state.dailyLoss = pnlToday;
    if (pnlToday <= -config_1.config.trading.maxDailyLoss) {
        state.enabled = false;
        logger_1.logger.warn(`Daily loss limit hit ($${Math.abs(pnlToday).toFixed(2)}) — scanning disabled for today`);
    }
    saveState(state);
    return state;
}
/**
 * Check hard controls at the start of each scan cycle.
 */
function checkHardControls() {
    const state = loadState();
    if (!state.enabled) {
        return { allowed: false, reason: 'Bot is disabled — use `/toggle on` to re-enable' };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (state.dailyLossDate === today && state.dailyLoss <= -config_1.config.trading.maxDailyLoss) {
        return {
            allowed: false,
            reason: `Daily loss limit of $${config_1.config.trading.maxDailyLoss} reached — resumes tomorrow`,
        };
    }
    return { allowed: true, reason: '' };
}
function toggleBot(enabled) {
    const state = loadState();
    state.enabled = enabled;
    // Reset daily loss gate if manually re-enabling
    if (enabled) {
        state.dailyLossDate = '';
        state.dailyLoss = 0;
    }
    saveState(state);
    logger_1.logger.info(`Bot ${enabled ? 'enabled' : 'disabled'} by user`);
    return state;
}
/** Get strategy weight, defaulting to 1.0 */
function getStrategyWeight(strategyName) {
    const state = loadState();
    return state.strategyWeights[strategyName] ?? 1.0;
}
/** Get the active minimum score threshold (runtime override or config default). */
function getMinScoreThreshold() {
    const state = loadState();
    return state.minScoreThreshold ?? config_1.config.trading.minScoreThreshold;
}
/** Persist a new minimum score threshold that survives restarts. */
function setMinScoreThreshold(threshold) {
    const state = loadState();
    state.minScoreThreshold = threshold;
    saveState(state);
    logger_1.logger.info(`Signal filter threshold set to ${threshold}`);
    return state;
}
/**
 * Reset all strategy weights to the recommended starting point.
 * Use this when historical weight data is stale or tainted (e.g. after changing TP logic).
 */
function resetStrategyWeights() {
    const state = loadState();
    state.strategyWeights = { ...exports.RECOMMENDED_WEIGHTS };
    saveState(state);
    logger_1.logger.info('Strategy weights reset to recommended defaults');
    return state;
}
/**
 * Manually override a single strategy's weight (0.50–1.0).
 * The adaptation system will continue adjusting from this new baseline.
 */
function setStrategyWeight(strategyName, weight) {
    if (!STRATEGY_NAMES.includes(strategyName)) {
        throw new Error(`Unknown strategy: ${strategyName}`);
    }
    const clamped = Math.max(0.50, Math.min(1.0, weight));
    const state = loadState();
    state.strategyWeights[strategyName] = clamped;
    saveState(state);
    logger_1.logger.info(`Strategy "${strategyName}" weight manually set to ${clamped.toFixed(2)}`);
    return state;
}
//# sourceMappingURL=adaptation.js.map