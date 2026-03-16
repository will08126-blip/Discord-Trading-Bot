import type { StrategySignal, ActivePosition, ClosedTrade } from '../types';
import type { SingleAssetScanResult } from '../engine';
export declare function buildSignalEmbed(signal: StrategySignal): {
    embeds: any[];
    components: any[];
};
export declare function buildPositionEmbed(position: ActivePosition, currentPrice?: number): {
    embeds: any[];
    components: any[];
};
export declare function buildExitAlertEmbed(position: ActivePosition, type: 'TP_APPROACH' | 'TP_HIT' | 'SL_APPROACH', currentPrice: number, newTP?: number): {
    embeds: any[];
    components: any[];
};
export declare function buildTPUpdateEmbed(position: ActivePosition, oldTP: number, newTP: number, currentPrice: number): {
    embeds: any[];
};
export declare function buildCheckSummaryEmbed(result: SingleAssetScanResult): any;
export declare function buildWatchlistEmbed(results: SingleAssetScanResult[], isLive?: boolean): {
    embeds: any[];
};
export declare function buildEarlyProfitAlertEmbed(position: ActivePosition, currentPrice: number, returnOnCapital: number, // fraction, e.g. 0.50 = 50%
milestone: number): {
    embeds: any[];
    components: any[];
};
export declare function buildPositionHealthEmbed(position: ActivePosition, currentPrice: number, rsi14: number, // current RSI(14) value on 5m candles
ema9: number, // current EMA(9) value on 5m candles
trigger?: 'TIME' | 'PRICE'): {
    embeds: any[];
    components: any[];
};
export declare function buildClosedTradeEmbed(trade: ClosedTrade): {
    embeds: any[];
};
//# sourceMappingURL=embeds.d.ts.map