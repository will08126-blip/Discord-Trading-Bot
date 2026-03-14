import type { BotState, ClosedTrade } from '../types';
export declare function loadState(): BotState;
export declare function saveState(state: BotState): void;
/**
 * Called after every confirmed closed trade.
 * Adjusts strategy weights based on win rate, and checks daily loss limit.
 * No cooldowns or risk reductions — the user decides position sizing.
 */
export declare function onTradeClosed(_trade: ClosedTrade): BotState;
/**
 * Check hard controls at the start of each scan cycle.
 */
export declare function checkHardControls(): {
    allowed: boolean;
    reason: string;
};
export declare function toggleBot(enabled: boolean): BotState;
/** Get strategy weight, defaulting to 1.0 */
export declare function getStrategyWeight(strategyName: string): number;
//# sourceMappingURL=adaptation.d.ts.map