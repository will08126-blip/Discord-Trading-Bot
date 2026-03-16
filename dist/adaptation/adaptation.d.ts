import type { BotState, ClosedTrade } from '../types';
/**
 * Recommended starting weights — used on reset and as the DEFAULT_STATE.
 * Trend Pullback / Breakout Retest / Liquidity Sweep are equal at 1.0 (all user-preferred).
 * Volatility Expansion starts at 0.85 — valid signal but lower user priority.
 */
export declare const RECOMMENDED_WEIGHTS: Record<string, number>;
export declare function loadState(): BotState;
export declare function saveState(state: BotState): void;
/**
 * Called after every confirmed closed trade.
 * Adjusts strategy weights based on win rate, and checks daily loss limit.
 * No cooldowns or risk reductions — the user decides position sizing.
 */
export declare function onTradeClosed(_trade: ClosedTrade): BotState;
/**
 * Check hard controls at the start of each scan cycle.
 */
export declare function checkHardControls(): {
    allowed: boolean;
    reason: string;
};
export declare function toggleBot(enabled: boolean): BotState;
/** Get strategy weight, defaulting to 1.0 */
export declare function getStrategyWeight(strategyName: string): number;
/** Get the active minimum score threshold (runtime override or config default). */
export declare function getMinScoreThreshold(): number;
/** Persist a new minimum score threshold that survives restarts. */
export declare function setMinScoreThreshold(threshold: number): BotState;
/**
 * Reset all strategy weights to the recommended starting point.
 * Use this when historical weight data is stale or tainted (e.g. after changing TP logic).
 */
export declare function resetStrategyWeights(): BotState;
/**
 * Manually override a single strategy's weight (0.50–1.0).
 * The adaptation system will continue adjusting from this new baseline.
 */
export declare function setStrategyWeight(strategyName: string, weight: number): BotState;
//# sourceMappingURL=adaptation.d.ts.map