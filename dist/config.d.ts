export declare const config: {
    readonly discord: {
        readonly token: string;
        readonly clientId: string;
        readonly signalChannelId: string;
        readonly summaryChannelId: string;
    };
    readonly anthropic: {
        readonly apiKey: string;
        readonly model: "claude-haiku-4-5-20251001";
    };
    readonly trading: {
        readonly assets: readonly ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "PEPE/USDT"];
        readonly maxOpenPositions: number;
        readonly maxDailyLoss: number;
        readonly minScoreThreshold: number;
        readonly maxLeverageScalp: number;
        readonly maxLeverageHybrid: number;
        readonly maxLeverageSwing: number;
        readonly earlyProfitAlertPct: number;
        readonly targetReturnPct: number;
    };
    readonly engine: {
        readonly scanIntervalMinutes: number;
        readonly enabled: boolean;
        readonly exchangeId: string;
        readonly duplicateWindowMs: number;
        readonly staleThresholds: Record<string, number>;
    };
    readonly paths: {
        readonly data: any;
        readonly tradesFile: any;
        readonly stateFile: any;
        readonly logsDir: any;
    };
    readonly leverageTiers: Record<string, Record<string, number>>;
    readonly scoreTiers: {
        readonly ELITE: 80;
        readonly STRONG: 60;
        readonly MEDIUM: 40;
    };
};
export type Config = typeof config;
//# sourceMappingURL=config.d.ts.map