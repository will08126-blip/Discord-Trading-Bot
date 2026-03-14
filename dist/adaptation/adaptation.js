"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadState = loadState;
exports.saveState = saveState;
exports.onTradeClosed = onTradeClosed;
exports.checkHardControls = checkHardControls;
exports.toggleBot = toggleBot;
exports.getStrategyWeight = getStrategyWeight;
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
const DEFAULT_STATE = {
    enabled: config_1.config.engine.enabled,
    dailyLoss: 0,
    dailyLossDate: '',
    strategyWeights: Object.fromEntries(STRATEGY_NAMES.map((n) => [n, 1.0])),
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
    fs_1.default.writeFileSync(config_1.config.paths.stateFile, JSON.stringify(state, null, 2));
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
            // Underperforming — reduce weight gradually
            state.strategyWeights[name] = Math.max(0.5, (state.strategyWeights[name] ?? 1.0) * 0.90);
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
//# sourceMappingURL=adaptation.js.map