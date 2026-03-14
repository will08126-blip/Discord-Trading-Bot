import type { OHLCV } from '../types';
export declare function ema(candles: OHLCV[], period: number): number[];
export declare function rsi(candles: OHLCV[], period?: number): number[];
export declare function atr(candles: OHLCV[], period?: number): number[];
/** Average of the ATR values (excluding NaN) */
export declare function atrAverage(atrValues: number[], lookback?: number): number;
export interface ADXResult {
    adx: number[];
    pdi: number[];
    mdi: number[];
}
export declare function adx(candles: OHLCV[], period?: number): ADXResult;
export interface BollingerResult {
    upper: number[];
    middle: number[];
    lower: number[];
    width: number[];
}
export declare function bollinger(candles: OHLCV[], period?: number, stdDev?: number): BollingerResult;
/** Minimum Bollinger width over the last `lookback` candles (squeeze detector) */
export declare function bollingerWidthMin(width: number[], lookback?: number): number;
export declare function vwap(candles: OHLCV[]): number[];
export interface SwingPoint {
    index: number;
    price: number;
    type: 'HIGH' | 'LOW';
}
/**
 * Detect swing highs and lows using a simple left/right comparison window.
 * Returns the last `maxPoints` found.
 */
export declare function swingPoints(candles: OHLCV[], leftBars?: number, rightBars?: number, maxPoints?: number): SwingPoint[];
export declare function volumeAverage(candles: OHLCV[], lookback?: number): number;
/** Returns true if the last candle's volume is above the average by ratio */
export declare function isVolumeSpike(candles: OHLCV[], ratio?: number, lookback?: number): boolean;
export declare function isBullishEngulfing(candles: OHLCV[]): boolean;
export declare function isBearishEngulfing(candles: OHLCV[]): boolean;
/** Pin bar: wick is at least 2× the body size, body near one end */
export declare function isBullishPin(candle: OHLCV): boolean;
export declare function isBearishPin(candle: OHLCV): boolean;
/**
 * Simple bullish divergence: price makes lower low but RSI makes higher low.
 * Checks last two swing lows against RSI at those points.
 */
export declare function hasBullishDivergence(candles: OHLCV[], rsiValues: number[]): boolean;
export declare function hasBearishDivergence(candles: OHLCV[], rsiValues: number[]): boolean;
/**
 * Returns a session quality score (0-5).
 * London open: 08:00-12:00 UTC
 * NY open: 13:00-17:00 UTC
 * Overlap: 13:00-16:00 UTC (highest quality)
 * Asia: 00:00-08:00 UTC (lower quality)
 * Weekend: reduced quality
 */
export declare function sessionQualityScore(): number;
//# sourceMappingURL=indicators.d.ts.map