import type { OHLCV, Asset, Timeframe } from '../types';
export declare function getCached(asset: Asset, timeframe: Timeframe): OHLCV[] | null;
export declare function setCache(asset: Asset, timeframe: Timeframe, data: OHLCV[]): void;
export declare function clearCache(): void;
export declare function isCacheFresh(asset: Asset, timeframe: Timeframe): boolean;
//# sourceMappingURL=cache.d.ts.map