import type { RegimeResult, StrategySignal } from './types';
export interface SingleAssetScanResult {
    asset: string;
    regime: RegimeResult | null;
    signals: StrategySignal[];
    error?: string;
}
export declare function scanSingleAsset(symbol: string): Promise<SingleAssetScanResult>;
export declare function runScanCycle(): Promise<{
    signalCount: number;
    skipped: boolean;
    reason?: string;
}>;
export declare function startScheduler(): void;
//# sourceMappingURL=engine.d.ts.map