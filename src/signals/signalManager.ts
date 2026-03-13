import type { StrategySignal, ActivePosition, ClosedTrade, ExitReason, OHLCV } from '../types';
import { calculateRisk } from '../risk/riskCalculator';
import { addTrade } from '../performance/tracker';
import { onTradeClosed } from '../adaptation/adaptation';
import { atr } from '../indicators/indicators';
import { config } from '../config';
import { logger } from '../utils/logger';

// In-memory stores
const pendingSignals = new Map<string, StrategySignal>();    // posted, awaiting confirmation
const activePositions = new Map<string, ActivePosition>();   // confirmed, being tracked
const recentlySentAssets = new Map<string, number>();        // for duplicate suppression

// ─── Signal lifecycle ─────────────────────────────────────────────────────────

export function addPendingSignal(signal: StrategySignal): void {
  pendingSignals.set(signal.id, signal);
  // Expire after 2 hours if not confirmed
  setTimeout(() => pendingSignals.delete(signal.id), 2 * 60 * 60 * 1000);
}

export function getPendingSignal(id: string): StrategySignal | undefined {
  return pendingSignals.get(id);
}

export function getAllPendingSignals(): StrategySignal[] {
  return [...pendingSignals.values()];
}

export function dismissPendingSignal(id: string): boolean {
  return pendingSignals.delete(id);
}

/** User confirmed they entered the trade */
export function confirmEntry(
  signalId: string,
  entryPrice: number,
  messageId: string,
  channelId: string
): ActivePosition | null {
  const signal = pendingSignals.get(signalId);
  if (!signal) return null;

  if (activePositions.size >= config.trading.maxOpenPositions) {
    logger.warn(`Max open positions (${config.trading.maxOpenPositions}) reached — cannot add more`);
    return null;
  }

  const risk = calculateRisk(signal);

  const position: ActivePosition = {
    id: signalId,
    signal,
    entryPrice,
    suggestedLeverage: risk.suggestedLeverage,
    riskPct: risk.riskPct,
    confirmedAt: Date.now(),
    messageId,
    channelId,
    currentStopLoss: signal.stopLoss,
    currentTakeProfit: signal.takeProfit,
    highestPrice: entryPrice,
    lowestPrice: entryPrice,
    lastSLTPUpdateAt: Date.now(),
    exitAlertSent: false,
  };

  activePositions.set(signalId, position);
  pendingSignals.delete(signalId);
  logger.info(`Position confirmed: ${signal.asset} ${signal.direction} @ ${entryPrice}`);
  return position;
}

export function getActivePosition(id: string): ActivePosition | undefined {
  return activePositions.get(id);
}

export function getAllActivePositions(): ActivePosition[] {
  return [...activePositions.values()];
}

/**
 * User manually reports they closed the trade at a given price.
 * This is the primary way trades get closed in this bot.
 */
export function closePositionManually(
  positionId: string,
  exitPrice: number
): ClosedTrade | null {
  return closePosition(positionId, exitPrice, 'MANUAL');
}

function closePosition(
  positionId: string,
  exitPrice: number,
  reason: ExitReason
): ClosedTrade | null {
  const position = activePositions.get(positionId);
  if (!position) return null;

  const isLong = position.signal.direction === 'LONG';
  const pnlPct = isLong
    ? (exitPrice - position.entryPrice) / position.entryPrice
    : (position.entryPrice - exitPrice) / position.entryPrice;

  // P&L expressed as R-multiples (how many R gained/lost) since we have no fixed capital
  // pnlDollar is stored as R-multiple × 100 for display (e.g. 1.5R = 150)
  const stopDist = Math.abs(position.entryPrice - position.signal.stopLoss) / position.entryPrice;
  const rMultiple = stopDist > 0 ? pnlPct / stopDist : 0;
  const pnlDollar = rMultiple; // stored as R-multiple; display layer formats it as "1.5R"

  const trade: ClosedTrade = {
    ...position,
    exitPrice,
    closedAt: Date.now(),
    pnlPct,
    pnlDollar,
    exitReason: reason,
  };

  activePositions.delete(positionId);
  addTrade(trade);
  onTradeClosed(trade);

  logger.info(
    `Trade closed: ${position.signal.asset} ${position.signal.direction} ` +
    `${reason} @ ${exitPrice} — P&L ${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(2)}% ($${pnlDollar.toFixed(2)})`
  );

  return trade;
}

// ─── Dynamic SL/TP Trailing ───────────────────────────────────────────────────

/**
 * Called every scan cycle with fresh OHLCV data.
 * Updates trailing stop and adjusts TP upward if momentum continues.
 *
 * Trailing stop rules:
 *   SCALP LONG:  trail 0.8× ATR below recent high
 *   SWING LONG:  trail 1.5× ATR below recent high
 *   SCALP SHORT: trail 0.8× ATR above recent low
 *   SWING SHORT: trail 1.5× ATR above recent low
 *
 * TP extension rule:
 *   If price has moved > 1.5× original stop distance in our favour,
 *   extend TP by 0.5× stop distance.
 *
 * Returns a list of positions where SL/TP changed significantly (> 0.2%),
 * so the caller can send a Discord update.
 */
export interface SLTPUpdate {
  position: ActivePosition;
  oldTP: number;
  newTP: number;
  hitTP: boolean;   // current price crossed TP
  currentPrice: number;
}

export function updateDynamicSLTP(
  position: ActivePosition,
  candles5m: OHLCV[],
  currentPrice: number
): SLTPUpdate | null {
  const isLong = position.signal.direction === 'LONG';

  const atrVals = atr(candles5m, 14);
  const currentAtr = atrVals[atrVals.length - 1];
  if (!currentAtr || isNaN(currentAtr)) return null;

  const oldTP = position.currentTakeProfit;

  // Track price extremes (used for TP extension)
  if (isLong && currentPrice > position.highestPrice) position.highestPrice = currentPrice;
  if (!isLong && currentPrice < position.lowestPrice) position.lowestPrice = currentPrice;

  // ── TP extension ──────────────────────────────────────────────────────
  // If price has moved > 1.5× the original reference distance in our favour, extend TP
  const originalStopDist = Math.abs(position.entryPrice - position.signal.stopLoss);
  const priceMoved = isLong
    ? currentPrice - position.entryPrice
    : position.entryPrice - currentPrice;

  let newTP = oldTP;
  if (originalStopDist > 0 && priceMoved > originalStopDist * 1.5) {
    const extension = originalStopDist * 0.5;
    const extended = isLong ? oldTP + extension : oldTP - extension;
    if (isLong && extended > newTP) newTP = extended;
    if (!isLong && extended < newTP) newTP = extended;
  }

  // Commit changes
  position.currentTakeProfit = newTP;
  position.lastSLTPUpdateAt = Date.now();

  // ── Check for TP breach ───────────────────────────────────────────────
  const hitTP = isLong ? currentPrice >= newTP : currentPrice <= newTP;

  // Only report if TP extended meaningfully (> 0.2%) or if hit
  const tpChangePct = Math.abs(newTP - oldTP) / oldTP;
  const significantChange = tpChangePct > 0.002;

  if (!significantChange && !hitTP) return null;

  return {
    position,
    oldTP,
    newTP,
    hitTP,
    currentPrice,
  };
}

/**
 * Automatically close a position when SL or TP is hit.
 * Called by the engine after updateDynamicSLTP.
 */
export function handleSLTPHit(update: SLTPUpdate): ClosedTrade | null {
  if (update.hitTP) {
    return closePosition(update.position.id, update.currentPrice, 'TP');
  }
  return null;
}

// ─── Duplicate suppression ────────────────────────────────────────────────────

export function isDuplicateSignal(signal: StrategySignal): boolean {
  const key = `${signal.asset}:${signal.direction}:${signal.strategy}`;
  const lastSent = recentlySentAssets.get(key);
  if (lastSent && Date.now() - lastSent < config.engine.duplicateWindowMs) {
    return true;
  }
  return false;
}

export function markSignalSent(signal: StrategySignal): void {
  const key = `${signal.asset}:${signal.direction}:${signal.strategy}`;
  recentlySentAssets.set(key, Date.now());
}
