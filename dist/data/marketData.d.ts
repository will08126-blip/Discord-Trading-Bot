import type { OHLCV, Asset, Timeframe, MultiTimeframeData } from '../types';
export declare function fetchOHLCV(asset: Asset, timeframe: Timeframe, limit?: number): Promise<OHLCV[]>;
export declare function fetchMultiTimeframe(asset: Asset): Promise<MultiTimeframeData>;
/** Fetch current mid-price without going through OHLCV */
export declare function fetchCurrentPrice(asset: Asset): Promise<number>;
/** Fetch all assets in parallel */
export declare function fetchAllAssets(): Promise<MultiTimeframeData[]>;
//# sourceMappingURL=marketData.d.ts.map