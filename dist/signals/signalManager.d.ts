import type { StrategySignal, ActivePosition, ClosedTrade, OHLCV } from '../types';
/** Load positions saved from a previous session. Call once at startup. */
export declare function loadPositions(): void;
export declare function addPendingSignal(signal: StrategySignal): void;
export declare function getPendingSignal(id: string): StrategySignal | undefined;
export declare function getAllPendingSignals(): StrategySignal[];
export declare function dismissPendingSignal(id: string): boolean;
/** User confirmed they entered the trade */
export declare function confirmEntry(signalId: string, entryPrice: number, messageId: string, channelId: string): ActivePosition | null;
export declare function getActivePosition(id: string): ActivePosition | undefined;
export declare function getAllActivePositions(): ActivePosition[];
/**
 * User manually reports they closed the trade at a given price.
 * This is the primary way trades get closed in this bot.
 */
export declare function closePositionManually(positionId: string, exitPrice: number): ClosedTrade | null;
/**
 * Called every scan cycle with fresh OHLCV data.
 * Updates trailing stop and adjusts TP upward if momentum continues.
 *
 * Trailing stop rules:
 *   SCALP LONG:  trail 0.8× ATR below recent high
 *   SWING LONG:  trail 1.5× ATR below recent high
 *   SCALP SHORT: trail 0.8× ATR above recent low
 *   SWING SHORT: trail 1.5× ATR above recent low
 *
 * TP extension rule:
 *   If price has moved > 1.5× original stop distance in our favour,
 *   extend TP by 0.5× stop distance.
 *
 * Returns a list of positions where SL/TP changed significantly (> 0.2%),
 * so the caller can send a Discord update.
 */
export interface SLTPUpdate {
    position: ActivePosition;
    oldTP: number;
    newTP: number;
    hitTP: boolean;
    currentPrice: number;
}
export declare function updateDynamicSLTP(position: ActivePosition, candles5m: OHLCV[], currentPrice: number, allowExtension?: boolean): SLTPUpdate | null;
/**
 * Automatically close a position when SL or TP is hit.
 * Called by the engine after updateDynamicSLTP.
 */
export declare function handleSLTPHit(update: SLTPUpdate): ClosedTrade | null;
/**
 * Evaluates whether live momentum supports extending TP further.
 * Checks three conditions and returns true if at least 2 pass:
 *
 *   1. Price is on the correct side of EMA(9)      — trend intact
 *   2. RSI(14) is not in extreme territory          — room left to run
 *      (< 80 for LONG, > 20 for SHORT)
 *   3. Both of the last 2 candles closed in the     — recent momentum
 *      trade direction
 */
export declare function evaluateMomentumForExtension(candles: OHLCV[], direction: string): boolean;
/**
 * Called when price comes within 0.3% of TP.
 * Runs the momentum check and, if it passes and extensions remain,
 * pushes TP out by 1× ATR so the trade can run further.
 *
 * Returns { oldTP, newTP } on success, null if extension was skipped
 * (limit reached, momentum weak, or ATR unavailable).
 *
 * Hard cap: 5 total extensions per position (shared with milestone auto-extensions).
 */
export declare function attemptMomentumTPExtension(position: ActivePosition, candles: OHLCV[], currentPrice: number): {
    oldTP: number;
    newTP: number;
} | null;
export declare function isDuplicateSignal(signal: StrategySignal): boolean;
export declare function markSignalSent(signal: StrategySignal): void;
//# sourceMappingURL=signalManager.d.ts.map