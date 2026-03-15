"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPositions = loadPositions;
exports.addPendingSignal = addPendingSignal;
exports.getPendingSignal = getPendingSignal;
exports.getAllPendingSignals = getAllPendingSignals;
exports.dismissPendingSignal = dismissPendingSignal;
exports.confirmEntry = confirmEntry;
exports.getActivePosition = getActivePosition;
exports.getAllActivePositions = getAllActivePositions;
exports.closePositionManually = closePositionManually;
exports.updateDynamicSLTP = updateDynamicSLTP;
exports.handleSLTPHit = handleSLTPHit;
exports.evaluateMomentumForExtension = evaluateMomentumForExtension;
exports.attemptMomentumTPExtension = attemptMomentumTPExtension;
exports.isDuplicateSignal = isDuplicateSignal;
exports.markSignalSent = markSignalSent;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const riskCalculator_1 = require("../risk/riskCalculator");
const tracker_1 = require("../performance/tracker");
const adaptation_1 = require("../adaptation/adaptation");
const indicators_1 = require("../indicators/indicators");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
// In-memory stores
const pendingSignals = new Map(); // posted, awaiting confirmation
const activePositions = new Map(); // confirmed, being tracked
const recentlySentAssets = new Map(); // for duplicate suppression
// ─── Position persistence ──────────────────────────────────────────────────────
const POSITIONS_FILE = path_1.default.join(config_1.config.paths.data, 'positions.json');
function savePositions() {
    try {
        fs_1.default.mkdirSync(path_1.default.dirname(POSITIONS_FILE), { recursive: true });
        const tmp = POSITIONS_FILE + '.tmp';
        fs_1.default.writeFileSync(tmp, JSON.stringify([...activePositions.values()], null, 2));
        fs_1.default.renameSync(tmp, POSITIONS_FILE);
    }
    catch (err) {
        logger_1.logger.error('Failed to save active positions to disk:', err);
    }
}
/** Load positions saved from a previous session. Call once at startup. */
function loadPositions() {
    if (!fs_1.default.existsSync(POSITIONS_FILE))
        return;
    try {
        const raw = fs_1.default.readFileSync(POSITIONS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        for (const p of data)
            activePositions.set(p.id, p);
        logger_1.logger.info(`Restored ${data.length} active position(s) from disk`);
    }
    catch (err) {
        logger_1.logger.warn('Failed to load saved positions — starting fresh:', err);
    }
}
// ─── Signal lifecycle ─────────────────────────────────────────────────────────
function addPendingSignal(signal) {
    pendingSignals.set(signal.id, signal);
    // Expire after 2 hours if not confirmed
    setTimeout(() => pendingSignals.delete(signal.id), 2 * 60 * 60 * 1000);
}
function getPendingSignal(id) {
    return pendingSignals.get(id);
}
function getAllPendingSignals() {
    return [...pendingSignals.values()];
}
function dismissPendingSignal(id) {
    return pendingSignals.delete(id);
}
/** User confirmed they entered the trade */
function confirmEntry(signalId, entryPrice, messageId, channelId) {
    const signal = pendingSignals.get(signalId);
    if (!signal)
        return null;
    if (activePositions.size >= config_1.config.trading.maxOpenPositions) {
        logger_1.logger.warn(`Max open positions (${config_1.config.trading.maxOpenPositions}) reached — cannot add more`);
        return null;
    }
    const risk = (0, riskCalculator_1.calculateRisk)(signal);
    // ── Leverage-adjusted TP ─────────────────────────────────────────────────
    // If TARGET_RETURN_PCT is configured, override the technical TP so the
    // position closes when the user's capital has grown by that fraction.
    // Formula: required price move = targetReturnPct / leverage
    // e.g.  100% return with 25x lev → price must move 4% (100 / 25 = 4%)
    const targetReturn = config_1.config.trading.targetReturnPct;
    const isLong = signal.direction === 'LONG';
    let adjustedTP = signal.takeProfit;
    if (targetReturn > 0 && risk.suggestedLeverage > 0) {
        const priceMovePct = targetReturn / risk.suggestedLeverage;
        adjustedTP = isLong
            ? entryPrice * (1 + priceMovePct)
            : entryPrice * (1 - priceMovePct);
        logger_1.logger.info(`TP overridden to leverage target: ${targetReturn * 100}% return @ ${risk.suggestedLeverage}x ` +
            `→ price move ${(priceMovePct * 100).toFixed(2)}% → TP ${adjustedTP.toFixed(4)}`);
    }
    const position = {
        id: signalId,
        signal,
        entryPrice,
        suggestedLeverage: risk.suggestedLeverage,
        riskPct: risk.riskPct,
        confirmedAt: Date.now(),
        messageId,
        channelId,
        currentStopLoss: signal.stopLoss,
        currentTakeProfit: adjustedTP,
        highestPrice: entryPrice,
        lowestPrice: entryPrice,
        lastSLTPUpdateAt: Date.now(),
        tpExtensionCount: 0,
        exitAlertSent: false,
    };
    activePositions.set(signalId, position);
    pendingSignals.delete(signalId);
    savePositions();
    logger_1.logger.info(`Position confirmed: ${signal.asset} ${signal.direction} @ ${entryPrice}`);
    return position;
}
function getActivePosition(id) {
    return activePositions.get(id);
}
function getAllActivePositions() {
    return [...activePositions.values()];
}
/**
 * User manually reports they closed the trade at a given price.
 * This is the primary way trades get closed in this bot.
 */
function closePositionManually(positionId, exitPrice) {
    return closePosition(positionId, exitPrice, 'MANUAL');
}
function closePosition(positionId, exitPrice, reason) {
    const position = activePositions.get(positionId);
    if (!position)
        return null;
    const isLong = position.signal.direction === 'LONG';
    const pnlPct = isLong
        ? (exitPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - exitPrice) / position.entryPrice;
    // P&L expressed as R-multiples (how many R gained/lost) since we have no fixed capital
    // pnlDollar is stored as R-multiple × 100 for display (e.g. 1.5R = 150)
    const stopDist = Math.abs(position.entryPrice - position.signal.stopLoss) / position.entryPrice;
    const rMultiple = stopDist > 0 ? pnlPct / stopDist : 0;
    const pnlDollar = rMultiple; // stored as R-multiple; display layer formats it as "1.5R"
    const trade = {
        ...position,
        exitPrice,
        closedAt: Date.now(),
        pnlPct,
        pnlDollar,
        exitReason: reason,
    };
    activePositions.delete(positionId);
    savePositions();
    (0, tracker_1.addTrade)(trade);
    (0, adaptation_1.onTradeClosed)(trade);
    logger_1.logger.info(`Trade closed: ${position.signal.asset} ${position.signal.direction} ` +
        `${reason} @ ${exitPrice} — P&L ${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(2)}% ($${pnlDollar.toFixed(2)})`);
    return trade;
}
function updateDynamicSLTP(position, candles5m, currentPrice) {
    const isLong = position.signal.direction === 'LONG';
    const atrVals = (0, indicators_1.atr)(candles5m, 14);
    const currentAtr = atrVals[atrVals.length - 1];
    if (!currentAtr || isNaN(currentAtr))
        return null;
    const oldTP = position.currentTakeProfit;
    // Track price extremes (used for TP extension)
    if (isLong && currentPrice > position.highestPrice)
        position.highestPrice = currentPrice;
    if (!isLong && currentPrice < position.lowestPrice)
        position.lowestPrice = currentPrice;
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
        if (isLong && extended > newTP)
            newTP = extended;
        if (!isLong && extended < newTP)
            newTP = extended;
    }
    // Commit changes
    position.currentTakeProfit = newTP;
    position.lastSLTPUpdateAt = Date.now();
    // ── Check for TP breach ───────────────────────────────────────────────
    const hitTP = isLong ? currentPrice >= newTP : currentPrice <= newTP;
    // Only report if TP extended meaningfully (> 0.2%) or if hit
    const tpChangePct = Math.abs(newTP - oldTP) / oldTP;
    const significantChange = tpChangePct > 0.002;
    if (!significantChange && !hitTP)
        return null;
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
function handleSLTPHit(update) {
    if (update.hitTP) {
        return closePosition(update.position.id, update.currentPrice, 'TP');
    }
    return null;
}
// ─── Momentum-based TP extension ──────────────────────────────────────────────
/**
 * Evaluates whether live momentum supports extending TP further.
 * Checks three conditions and returns true if at least 2 pass:
 *
 *   1. Price is on the correct side of EMA(9)      — trend intact
 *   2. RSI(14) is not in extreme territory          — room left to run
 *      (< 80 for LONG, > 20 for SHORT)
 *   3. Both of the last 2 candles closed in the     — recent momentum
 *      trade direction
 */
function evaluateMomentumForExtension(candles, direction) {
    if (candles.length < 15)
        return false;
    const isLong = direction === 'LONG';
    // 1. EMA(9): is price still on the right side?
    const emaVals = (0, indicators_1.ema)(candles, 9);
    const currentEma = emaVals[emaVals.length - 1];
    const currentClose = candles[candles.length - 1].close;
    const emaPass = !isNaN(currentEma) && (isLong ? currentClose > currentEma : currentClose < currentEma);
    // 2. RSI(14): not overbought/oversold at the extreme
    const rsiVals = (0, indicators_1.rsi)(candles, 14);
    const currentRsi = rsiVals[rsiVals.length - 1];
    const rsiPass = !isNaN(currentRsi) && (isLong ? currentRsi < 80 : currentRsi > 20);
    // 3. Last 2 candles closed in the trade direction
    const last2 = candles.slice(-2);
    const bullish = last2.filter((c) => c.close > c.open).length;
    const bearish = last2.filter((c) => c.close < c.open).length;
    const candlePass = isLong ? bullish >= 2 : bearish >= 2;
    return [emaPass, rsiPass, candlePass].filter(Boolean).length >= 2;
}
/**
 * Called when price comes within 0.3% of TP.
 * Runs the momentum check and, if it passes and extensions remain,
 * pushes TP out by 1× ATR so the trade can run further.
 *
 * Returns { oldTP, newTP } on success, null if extension was skipped
 * (limit reached, momentum weak, or ATR unavailable).
 *
 * Hard cap: 2 momentum extensions per position.
 */
function attemptMomentumTPExtension(position, candles, currentPrice) {
    if (position.tpExtensionCount >= 2)
        return null;
    const atrVals = (0, indicators_1.atr)(candles, 14);
    const currentAtr = atrVals[atrVals.length - 1];
    if (!currentAtr || isNaN(currentAtr))
        return null;
    if (!evaluateMomentumForExtension(candles, position.signal.direction))
        return null;
    const isLong = position.signal.direction === 'LONG';
    const oldTP = position.currentTakeProfit;
    const newTP = isLong ? oldTP + currentAtr : oldTP - currentAtr;
    position.currentTakeProfit = newTP;
    position.tpExtensionCount += 1;
    position.lastSLTPUpdateAt = Date.now();
    logger_1.logger.info(`TP extended by momentum (${position.tpExtensionCount}/2): ` +
        `${position.signal.asset} ${position.signal.direction} ` +
        `TP ${oldTP.toFixed(4)} → ${newTP.toFixed(4)} (ATR=${currentAtr.toFixed(4)})`);
    return { oldTP, newTP };
}
// ─── Duplicate suppression ────────────────────────────────────────────────────
function isDuplicateSignal(signal) {
    const key = `${signal.asset}:${signal.direction}:${signal.strategy}`;
    const lastSent = recentlySentAssets.get(key);
    const now = Date.now();
    // Prune expired entry on access to prevent unbounded map growth
    if (lastSent !== undefined && now - lastSent >= config_1.config.engine.duplicateWindowMs) {
        recentlySentAssets.delete(key);
        return false;
    }
    return lastSent !== undefined;
}
function markSignalSent(signal) {
    const key = `${signal.asset}:${signal.direction}:${signal.strategy}`;
    recentlySentAssets.set(key, Date.now());
}
//# sourceMappingURL=signalManager.js.map