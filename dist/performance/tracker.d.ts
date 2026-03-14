import type { ClosedTrade, PerformanceStats } from '../types';
export declare function loadTrades(): ClosedTrade[];
export declare function saveTrades(trades: ClosedTrade[]): void;
export declare function addTrade(trade: ClosedTrade): void;
export declare function computeStats(trades: ClosedTrade[]): PerformanceStats;
/** Returns the win rate for a specific strategy over the last N trades */
export declare function strategyWinRate(strategyName: string, lastN?: number): number;
/** P&L for current calendar day (UTC) */
export declare function dailyPnl(): number;
/**
 * Build a human-readable daily summary string for LLM consumption
 */
export declare function buildDailySummaryContext(): string;
export declare function buildWeeklySummaryContext(): string;
//# sourceMappingURL=tracker.d.ts.map