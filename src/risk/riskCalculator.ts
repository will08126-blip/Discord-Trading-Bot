import type { StrategySignal, TradeType, ScoreTier } from '../types';
import { config } from '../config';

export interface RiskParameters {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  stopDistancePct: number;
  rewardRiskRatio: number;
  suggestedLeverage: number;
  suggestedSizeUsdt: number;  // notional position size in USDT
  dollarRisk: number;
  dollarReward: number;
  contractQty: number;        // approx contracts (notional / entry price)
  tradeType: TradeType;
}

/**
 * Leverage cap: scalp trades (tight SL on 5m/1m) justify high leverage.
 * Swing trades (wide SL on 15m/4h) use lower leverage.
 */
function leverageCap(tier: ScoreTier, tradeType: TradeType): number {
  const tiers = config.leverageTiers[tradeType === 'SCALP' ? 'scalp' : 'swing'];
  const byTier = tiers[tier] ?? 5;
  const hardCap =
    tradeType === 'SCALP'
      ? config.trading.maxLeverageScalp
      : config.trading.maxLeverageSwing;
  return Math.min(byTier, hardCap);
}

/**
 * Classify a signal as SCALP or SWING based on SL distance relative to price.
 *
 * Tight SL (< 0.5% from entry) → SCALP
 * Wide SL (≥ 0.5%)             → SWING
 *
 * This is the same classification set by each strategy, but we re-check here
 * for defensive validation.
 */
export function classifyTradeType(signal: StrategySignal): TradeType {
  const entry = (signal.entryZone[0] + signal.entryZone[1]) / 2;
  const stopPct = Math.abs(entry - signal.stopLoss) / entry;
  return stopPct < 0.005 ? 'SCALP' : 'SWING';
}

export function calculateRisk(signal: StrategySignal): RiskParameters {
  const entryPrice = (signal.entryZone[0] + signal.entryZone[1]) / 2;
  const stopDistance = Math.abs(entryPrice - signal.stopLoss);
  const stopDistancePct = entryPrice > 0 ? stopDistance / entryPrice : 0;

  const rewardDistance = Math.abs(signal.takeProfit - entryPrice);
  const rewardRiskRatio = stopDistance > 0 ? rewardDistance / stopDistance : 0;

  const tradeType = signal.tradeType ?? classifyTradeType(signal);

  const dollarRisk = config.trading.riskPerTrade;

  // Position size: if price moves stopDistancePct against us → lose dollarRisk
  const suggestedSizeUsdt =
    stopDistancePct > 0 ? dollarRisk / stopDistancePct : 0;

  // Required leverage
  const requiredLeverage =
    config.trading.accountCapital > 0
      ? suggestedSizeUsdt / config.trading.accountCapital
      : 1;

  const maxLev = leverageCap(signal.tier, tradeType);
  const suggestedLeverage = Math.max(1, Math.min(maxLev, Math.ceil(requiredLeverage)));

  const dollarReward = dollarRisk * rewardRiskRatio;
  const contractQty = entryPrice > 0 ? suggestedSizeUsdt / entryPrice : 0;

  return {
    entryPrice,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    stopDistancePct,
    rewardRiskRatio,
    suggestedLeverage,
    suggestedSizeUsdt: Math.round(suggestedSizeUsdt * 100) / 100,
    dollarRisk: Math.round(dollarRisk * 100) / 100,
    dollarReward: Math.round(dollarReward * 100) / 100,
    contractQty: Math.round(contractQty * 10000) / 10000,
    tradeType,
  };
}

export function formatPrice(price: number, asset: string): string {
  const decimals = asset.startsWith('BTC') ? 0 : 1;
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(2)}%`;
}
