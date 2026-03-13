import type { StrategySignal, TradeType, ScoreTier } from '../types';
import { config } from '../config';

export interface RiskParameters {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  stopDistancePct: number;      // % distance from entry to SL
  rewardRiskRatio: number;
  suggestedLeverage: number;
  riskPct: number;              // % of your capital to risk (confidence-based)
  tradeType: TradeType;
  // Reference table: estimated dollar risk at common capital sizes
  referenceTable: { capital: number; riskDollars: number; positionSize: number }[];
}

/**
 * Confidence-based risk percentages — no fixed capital required.
 * User scales these to whatever they're working with that week.
 *
 * Scalp trades get slightly higher allocation because the leverage
 * is higher and stops are tighter, so the % risk stays manageable.
 */
const RISK_PCT: Record<string, Record<ScoreTier, number>> = {
  scalp:  { ELITE: 2.0, STRONG: 1.5, MEDIUM: 1.0, NO_TRADE: 0 },
  hybrid: { ELITE: 2.0, STRONG: 1.5, MEDIUM: 1.0, NO_TRADE: 0 },
  swing:  { ELITE: 2.0, STRONG: 1.5, MEDIUM: 1.0, NO_TRADE: 0 },
};

const REFERENCE_CAPITALS = [500, 1000, 2500, 5000, 10000];

function leverageCap(tier: ScoreTier, tradeType: TradeType): number {
  const typeKey = tradeType === 'SCALP' ? 'scalp' : tradeType === 'HYBRID' ? 'hybrid' : 'swing';
  const tiers = config.leverageTiers[typeKey];
  const byTier = tiers[tier] ?? 5;
  const hardCap = tradeType === 'SCALP'
    ? config.trading.maxLeverageScalp
    : tradeType === 'HYBRID'
    ? config.trading.maxLeverageHybrid
    : config.trading.maxLeverageSwing;
  return Math.min(byTier, hardCap);
}

export function classifyTradeType(signal: StrategySignal): TradeType {
  const entry = (signal.entryZone[0] + signal.entryZone[1]) / 2;
  const stopPct = Math.abs(entry - signal.stopLoss) / entry;
  if (stopPct < 0.003) return 'SCALP';
  if (stopPct < 0.015) return 'HYBRID';
  return 'SWING';
}

export function calculateRisk(signal: StrategySignal): RiskParameters {
  const entryPrice = (signal.entryZone[0] + signal.entryZone[1]) / 2;
  const stopDistance = Math.abs(entryPrice - signal.stopLoss);
  const stopDistancePct = entryPrice > 0 ? stopDistance / entryPrice : 0;

  const rewardDistance = Math.abs(signal.takeProfit - entryPrice);
  const rewardRiskRatio = stopDistance > 0 ? rewardDistance / stopDistance : 0;

  const tradeType = signal.tradeType ?? classifyTradeType(signal);
  const typeKey = tradeType === 'SCALP' ? 'scalp' : tradeType === 'HYBRID' ? 'hybrid' : 'swing';

  // Confidence-based risk %
  const riskPct = RISK_PCT[typeKey][signal.tier] ?? 1.0;

  // Leverage: based on how much notional you need vs capital to achieve riskPct
  // At riskPct% risk with stopDistancePct% stop:
  //   positionSize = capital * riskPct% / stopDistancePct%
  //   leverage     = positionSize / capital = riskPct / stopDistancePct
  const impliedLeverage = stopDistancePct > 0 ? riskPct / 100 / stopDistancePct : 1;
  const maxLev = leverageCap(signal.tier, tradeType);
  const suggestedLeverage = Math.max(1, Math.min(maxLev, Math.ceil(impliedLeverage)));

  // Reference table: show estimated risk dollars and position size at common capitals
  const referenceTable = REFERENCE_CAPITALS.map((capital) => {
    const riskDollars = Math.round(capital * (riskPct / 100));
    const positionSize = stopDistancePct > 0
      ? Math.round(riskDollars / stopDistancePct)
      : 0;
    return { capital, riskDollars, positionSize };
  });

  return {
    entryPrice,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    stopDistancePct,
    rewardRiskRatio,
    suggestedLeverage,
    riskPct,
    tradeType,
    referenceTable,
  };
}

export function formatPrice(price: number, asset: string): string {
  let decimals: number;
  if (asset.startsWith('BTC')) {
    decimals = 0;
  } else if (price < 0.0001) {
    decimals = 8;  // micro-caps like PEPE (~0.000012)
  } else if (price < 1) {
    decimals = 5;  // sub-dollar assets
  } else {
    decimals = 2;  // standard (ETH, SOL, XRP)
  }
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(2)}%`;
}
