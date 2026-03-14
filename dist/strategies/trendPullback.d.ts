import { BaseStrategy } from './base';
import type { StrategySignal, MultiTimeframeData, Regime } from '../types';
/**
 * Trend Pullback Strategy
 *
 * Logic:
 *  - 4h: EMA alignment confirms trend direction (20 > 50 > 200 for long)
 *  - 15m: RSI has pulled back to 40-55 range (long) / 45-60 (short), price near EMA20
 *  - 5m:  Bullish engulfing or pin bar at EMA20 confirms reversal
 *
 * Suitable for: TREND_UP, TREND_DOWN
 */
export declare class TrendPullbackStrategy extends BaseStrategy {
    readonly name = "Trend Pullback";
    readonly supportedRegimes: Regime[];
    analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null;
}
//# sourceMappingURL=trendPullback.d.ts.map