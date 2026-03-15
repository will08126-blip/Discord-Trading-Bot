import { BaseStrategy } from './base';
import type { StrategySignal, MultiTimeframeData, Regime } from '../types';
/**
 * Breakout Retest Strategy (improved)
 *
 * Logic:
 *  1. Identify key horizontal levels from 15m swing highs/lows (last 50 candles)
 *  2. Detect break: a 15m candle CROSSES a level — close is on the breakout side
 *     AND the previous close was on the origin side. This eliminates false positives
 *     where price was already far from the level.
 *  3. Detect retest: price returns within 0.2% of level on 5m (tighter than before)
 *  4. Confirm: 5m close back in breakout direction + volume > 0.8× avg at retest
 *  5. RSI confirmation: momentum must be intact at retest
 *
 * Supported regimes: TREND_UP, TREND_DOWN, VOL_EXPANSION, RANGE
 * (RANGE breakouts are high-probability — price breaks out of compression)
 */
export declare class BreakoutRetestStrategy extends BaseStrategy {
    readonly name = "Breakout Retest";
    readonly supportedRegimes: Regime[];
    analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null;
    private findRetestSignal;
    /**
     * Finds a candle that CROSSED the given level (went from one side to the other).
     * Looks backward from candles[n - minLookback] to candles[n - maxLookback].
     *
     * A true breakout candle:
     *   - Long break: close > level + threshold AND previous candle close ≤ level
     *   - Short break: close < level - threshold AND previous candle close ≥ level
     *
     * This fixes the prior bug where any candle far from the level was returned.
     */
    private findBreakCandle;
    /**
     * Counts how many times price has been near this level (within tolerancePct).
     * Lower count = fresher level = higher signal quality.
     */
    private countRetests;
}
//# sourceMappingURL=breakoutRetest.d.ts.map