import type { StrategySignal, ScoreTier } from '../types';
export declare const MAX_POSSIBLE_SCORE = 100;
export declare function scoreTier(score: number): ScoreTier;
/**
 * Apply an adaptation weight to a signal's score.
 * Weight is between 0.5 (strategy performing poorly) and 1.0 (default).
 *
 * The weight is applied to the `recentPerformance` component and the final score
 * is re-computed. This avoids rebuilding all components.
 */
export declare function applyAdaptationWeight(signal: StrategySignal, weight: number): StrategySignal;
/**
 * Filter signals that meet the minimum score threshold.
 * Returns signals sorted by score descending.
 */
export declare function filterAndRankSignals(signals: StrategySignal[], minScore: number): StrategySignal[];
/**
 * De-duplicate signals: keep at most one signal per asset+direction+strategy combo.
 * Different strategies can post for the same asset+direction in the same cycle.
 */
export declare function deduplicateSignals(signals: StrategySignal[]): StrategySignal[];
export declare function tierEmoji(tier: ScoreTier): string;
export declare function tierColor(tier: ScoreTier): number;
//# sourceMappingURL=votingEngine.d.ts.map