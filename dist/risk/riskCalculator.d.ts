import type { StrategySignal, TradeType } from '../types';
export interface RiskParameters {
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    stopDistancePct: number;
    rewardRiskRatio: number;
    suggestedLeverage: number;
    riskPct: number;
    tradeType: TradeType;
    deploymentScore: number;
}
/**
 * Deployment confidence score (0-100).
 * Measures how favourable the *environment* is to deploy capital right now,
 * based on HTF alignment, momentum, volatility, regime, liquidity and session.
 * Intentionally excludes setupQuality/slippageRisk/recentPerformance — those
 * measure pattern quality (already captured in signal.score).
 */
export declare function calculateDeploymentScore(signal: StrategySignal): number;
export declare function classifyTradeType(signal: StrategySignal): TradeType;
export declare function calculateRisk(signal: StrategySignal): RiskParameters;
export declare function formatPrice(price: number, asset: string): string;
export declare function formatPct(pct: number): string;
//# sourceMappingURL=riskCalculator.d.ts.map