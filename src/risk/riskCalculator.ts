import type { StrategySignal, ScoreTier } from '../types';
import { config } from '../config';

export interface RiskParameters {
  entryPrice: number;        // mid of entry zone
  stopLoss: number;
  takeProfit: number;
  stopDistancePct: number;   // % from entry to SL
  rewardRiskRatio: number;
  suggestedLeverage: number;
  suggestedSizeUsdt: number; // notional position size in USDT
  dollarRisk: number;        // estimated $ at risk
  dollarReward: number;      // estimated $ reward
  contractQty: number;       // approx contracts (size / entry)
}

/**
 * Compute risk parameters for a given signal.
 *
 * dollarRisk = config.riskPerTrade × riskMultiplier
 * sizeUsdt   = dollarRisk / stopDistancePct
 * leverage   = sizeUsdt / accountCapital  (capped at tier max)
 */
export function calculateRisk(
  signal: StrategySignal,
  riskMultiplier = 1.0
): RiskParameters {
  const entryPrice = (signal.entryZone[0] + signal.entryZone[1]) / 2;
  const stopDistance = Math.abs(entryPrice - signal.stopLoss);
  const stopDistancePct = stopDistance / entryPrice;

  const rewardDistance = Math.abs(signal.takeProfit - entryPrice);
  const rewardRiskRatio = stopDistance > 0 ? rewardDistance / stopDistance : 0;

  // Dollar risk adjusted by multiplier (adaptation may reduce this)
  const dollarRisk = config.trading.riskPerTrade * Math.max(0.25, Math.min(1.0, riskMultiplier));

  // Notional position size: if price moves stopDistancePct against us, we lose dollarRisk
  const suggestedSizeUsdt = stopDistancePct > 0 ? dollarRisk / stopDistancePct : 0;

  // Required leverage = notional / available capital
  const requiredLeverage = suggestedSizeUsdt / config.trading.accountCapital;

  // Cap leverage by tier
  const maxByTier = config.leverageTiers[signal.tier] ?? 5;
  const suggestedLeverage = Math.min(
    config.trading.maxLeverage,
    maxByTier,
    Math.ceil(requiredLeverage)
  );

  const dollarReward = dollarRisk * rewardRiskRatio;
  const contractQty = entryPrice > 0 ? suggestedSizeUsdt / entryPrice : 0;

  return {
    entryPrice,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    stopDistancePct,
    rewardRiskRatio,
    suggestedLeverage: Math.max(1, suggestedLeverage),
    suggestedSizeUsdt: Math.round(suggestedSizeUsdt * 100) / 100,
    dollarRisk: Math.round(dollarRisk * 100) / 100,
    dollarReward: Math.round(dollarReward * 100) / 100,
    contractQty: Math.round(contractQty * 10000) / 10000,
  };
}

/** Format a price with appropriate decimal places for display */
export function formatPrice(price: number, asset: string): string {
  const decimals = asset.startsWith('BTC') ? 0 : 1;
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Format a percentage */
export function formatPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(2)}%`;
}
