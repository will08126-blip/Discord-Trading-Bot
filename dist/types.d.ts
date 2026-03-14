export type Asset = 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT' | 'XRP/USDT' | 'PEPE/USDT';
export type Timeframe = '4h' | '15m' | '5m' | '1m';
export type Direction = 'LONG' | 'SHORT';
export type Regime = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'VOL_EXPANSION' | 'LOW_VOL_COMPRESSION' | 'POOR';
export type ScoreTier = 'NO_TRADE' | 'MEDIUM' | 'STRONG' | 'ELITE';
export type ExitReason = 'TP' | 'SL' | 'MANUAL' | 'CONDITION_CHANGE';
/**
 * SCALP  → SL < 0.3%, 5m/1m entry, hold < 1h,   high leverage (up to 50x)
 * HYBRID → SL 0.3-1.5%, 5m/15m, hold 1-4h,       medium leverage (up to 30x)
 * SWING  → SL > 1.5%, 15m/4h,  hold 4-24h,        lower leverage (up to 20x)
 */
export type TradeType = 'SCALP' | 'HYBRID' | 'SWING';
export interface OHLCV {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export interface MultiTimeframeData {
    asset: Asset;
    '4h': OHLCV[];
    '15m': OHLCV[];
    '5m': OHLCV[];
    '1m': OHLCV[];
}
export interface ScoreComponents {
    htfAlignment: number;
    setupQuality: number;
    momentum: number;
    volatilityQuality: number;
    regimeFit: number;
    liquidity: number;
    slippageRisk: number;
    sessionQuality: number;
    recentPerformance: number;
}
export interface StrategySignal {
    id: string;
    strategy: string;
    asset: Asset;
    direction: Direction;
    tradeType: TradeType;
    entryZone: [number, number];
    stopLoss: number;
    takeProfit: number;
    components: ScoreComponents;
    score: number;
    tier: ScoreTier;
    regime: Regime;
    timestamp: number;
    notes?: string;
}
export interface ActivePosition {
    id: string;
    signal: StrategySignal;
    entryPrice: number;
    suggestedLeverage: number;
    riskPct: number;
    confirmedAt: number;
    messageId: string;
    channelId: string;
    currentStopLoss: number;
    currentTakeProfit: number;
    highestPrice: number;
    lowestPrice: number;
    lastSLTPUpdateAt: number;
    tpExtensionCount: number;
    exitAlertSent: boolean;
}
export interface ClosedTrade extends ActivePosition {
    exitPrice: number;
    closedAt: number;
    pnlPct: number;
    pnlDollar: number;
    exitReason: ExitReason;
}
export interface PerformanceStats {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgScore: number;
    profitFactor: number;
    totalPnlDollar: number;
    byStrategy: Record<string, StrategyStats>;
    byTradeType: Record<string, {
        trades: number;
        wins: number;
        winRate: number;
    }>;
}
export interface StrategyStats {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgScore: number;
}
export interface BotState {
    enabled: boolean;
    dailyLoss: number;
    dailyLossDate: string;
    strategyWeights: Record<string, number>;
}
export interface RegimeResult {
    asset: Asset;
    regime: Regime;
    adx: number;
    atrRatio: number;
    emaAligned: boolean;
    timestamp: number;
}
//# sourceMappingURL=types.d.ts.map