import { BaseStrategy } from './base';
import type { StrategySignal, MultiTimeframeData, Regime } from '../types';
/**
 * Liquidity Sweep Reversal Strategy
 *
 * Logic:
 *  - Detect swing highs/lows on 15m (last 20 candles)
 *  - Sweep: wick extends beyond swing by > 0.2%, body closes back inside range
 *  - Confirmation: RSI divergence or engulfing reversal candle
 *
 * Suitable for: RANGE, TREND_UP (end), TREND_DOWN (end)
 */
export declare class LiquiditySweepStrategy extends BaseStrategy {
    readonly name = "Liquidity Sweep";
    readonly supportedRegimes: Regime[];
    analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null;
    private checkSweepReversal;
}
//# sourceMappingURL=liquiditySweep.d.ts.map