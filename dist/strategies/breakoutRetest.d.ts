import { BaseStrategy } from './base';
import type { StrategySignal, MultiTimeframeData, Regime } from '../types';
/**
 * Breakout Retest Strategy
 *
 * Logic:
 *  - Identify key horizontal levels from 15m swing points (last 50 candles)
 *  - Detect break: 15m close beyond level by > 0.1%
 *  - Detect retest: price returns within 0.3% of level on 5m
 *  - Confirmation: 5m close back in breakout direction + volume
 *
 * Suitable for: TREND_UP, TREND_DOWN, VOL_EXPANSION
 */
export declare class BreakoutRetestStrategy extends BaseStrategy {
    readonly name = "Breakout Retest";
    readonly supportedRegimes: Regime[];
    analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null;
    private findRetestSignal;
    private findBreakCandle;
    private countRetests;
}
//# sourceMappingURL=breakoutRetest.d.ts.map