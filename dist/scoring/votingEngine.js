"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_POSSIBLE_SCORE = void 0;
exports.scoreTier = scoreTier;
exports.applyAdaptationWeight = applyAdaptationWeight;
exports.filterAndRankSignals = filterAndRankSignals;
exports.deduplicateSignals = deduplicateSignals;
exports.tierEmoji = tierEmoji;
exports.tierColor = tierColor;
exports.MAX_POSSIBLE_SCORE = 100;
function scoreTier(score) {
    if (score >= 80)
        return 'ELITE';
    if (score >= 60)
        return 'STRONG';
    if (score >= 40)
        return 'MEDIUM';
    return 'NO_TRADE';
}
/**
 * Apply an adaptation weight to a signal's score.
 * Weight is between 0.5 (strategy performing poorly) and 1.0 (default).
 *
 * The weight is applied to the `recentPerformance` component and the final score
 * is re-computed. This avoids rebuilding all components.
 */
function applyAdaptationWeight(signal, weight) {
    const clampedWeight = Math.max(0.5, Math.min(1.0, weight));
    // Scale setup-quality and momentum components by the weight (the "alpha" of the strategy)
    const adjustedComponents = {
        ...signal.components,
        setupQuality: Math.round(signal.components.setupQuality * clampedWeight),
        momentum: Math.round(signal.components.momentum * clampedWeight),
        recentPerformance: Math.round(signal.components.recentPerformance * clampedWeight),
    };
    const newScore = Object.values(adjustedComponents).reduce((sum, v) => sum + v, 0);
    const clampedScore = Math.min(exports.MAX_POSSIBLE_SCORE, Math.max(0, newScore));
    const tier = scoreTier(clampedScore);
    return {
        ...signal,
        components: adjustedComponents,
        score: clampedScore,
        tier,
    };
}
/**
 * Filter signals that meet the minimum score threshold.
 * Returns signals sorted by score descending.
 */
function filterAndRankSignals(signals, minScore) {
    return signals
        .filter((s) => s.score >= minScore && s.tier !== 'NO_TRADE')
        .sort((a, b) => b.score - a.score);
}
/**
 * De-duplicate signals: keep at most one signal per asset+direction+strategy combo.
 * Different strategies can post for the same asset+direction in the same cycle.
 */
function deduplicateSignals(signals) {
    const best = new Map();
    for (const s of signals) {
        const key = `${s.asset}:${s.direction}:${s.strategy}`;
        const existing = best.get(key);
        if (!existing || s.score > existing.score) {
            best.set(key, s);
        }
    }
    return [...best.values()];
}
function tierEmoji(tier) {
    const emojis = {
        ELITE: '🏆',
        STRONG: '💪',
        MEDIUM: '⚡',
        NO_TRADE: '❌',
    };
    return emojis[tier];
}
function tierColor(tier) {
    // Discord embed colors
    const colors = {
        ELITE: 0xffd700, // gold
        STRONG: 0x00ff87, // green
        MEDIUM: 0xffa500, // orange
        NO_TRADE: 0xff0000, // red
    };
    return colors[tier];
}
//# sourceMappingURL=votingEngine.js.map