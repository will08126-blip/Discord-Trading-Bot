import { BaseStrategy } from './base';
import type { StrategySignal, MultiTimeframeData, Regime } from '../types';
/**
 * Volatility Expansion Strategy
 *
 * Logic:
 *  - Identify Bollinger Band squeeze on 4h or 15m (width at ≤ 20-period low)
 *  - Entry: 15m close outside Bollinger bands + ATR expanding above 14-period avg
 *  - Direction: determined by last 10 candles' price trend on 4h
 *
 * Suitable for: LOW_VOL_COMPRESSION
 */
export declare class VolatilityExpansionStrategy extends BaseStrategy {
    readonly name = "Volatility Expansion";
    readonly supportedRegimes: Regime[];
    analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null;
    private measureSqueezeDuration;
}
//# sourceMappingURL=volatilityExpansion.d.ts.map