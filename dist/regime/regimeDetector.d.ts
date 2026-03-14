import type { OHLCV, Asset, Regime, RegimeResult } from '../types';
export declare function setLastRegime(asset: Asset, result: RegimeResult): void;
export declare function getLastRegimes(): Map<Asset, RegimeResult>;
export declare function detectRegime(asset: Asset, candles4h: OHLCV[]): RegimeResult;
export declare function isTradeableRegime(regime: Regime): boolean;
export declare function regimeLabel(regime: Regime): string;
//# sourceMappingURL=regimeDetector.d.ts.map