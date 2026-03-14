"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLastRegime = setLastRegime;
exports.getLastRegimes = getLastRegimes;
exports.detectRegime = detectRegime;
exports.isTradeableRegime = isTradeableRegime;
exports.regimeLabel = regimeLabel;
const indicators_1 = require("../indicators/indicators");
// ─── Regime cache (updated on every scan cycle) ───────────────────────────────
const lastRegimes = new Map();
function setLastRegime(asset, result) {
    lastRegimes.set(asset, result);
}
function getLastRegimes() {
    return lastRegimes;
}
const ADX_TREND_THRESHOLD = 25;
const ADX_RANGE_THRESHOLD = 20;
const ATR_EXPANSION_RATIO = 1.5;
const ATR_COMPRESSION_RATIO = 0.7;
const ATR_EXTREME_RATIO = 3.0;
const MIN_VOLUME_PERCENTILE = 0.3; // volume must be at least 30% of average
function detectRegime(asset, candles4h) {
    const n = candles4h.length;
    if (n < 50) {
        return {
            asset,
            regime: 'POOR',
            adx: 0,
            atrRatio: 0,
            emaAligned: false,
            timestamp: Date.now(),
        };
    }
    const ema20 = (0, indicators_1.ema)(candles4h, 20);
    const ema50 = (0, indicators_1.ema)(candles4h, 50);
    const ema200 = (0, indicators_1.ema)(candles4h, 200);
    const adxResult = (0, indicators_1.adx)(candles4h, 14);
    const atrValues = (0, indicators_1.atr)(candles4h, 14);
    const bbResult = (0, indicators_1.bollinger)(candles4h, 20, 2);
    const lastClose = candles4h[n - 1].close;
    const lastAdx = adxResult.adx[n - 1];
    const lastPdi = adxResult.pdi[n - 1];
    const lastMdi = adxResult.mdi[n - 1];
    const lastEma20 = ema20[n - 1];
    const lastEma50 = ema50[n - 1];
    const lastEma200 = ema200[n - 1];
    const lastAtr = atrValues[n - 1];
    // ATR ratio: current vs its own average
    const avgAtr = (0, indicators_1.atrAverage)(atrValues, 14);
    const atrRatio = avgAtr > 0 ? lastAtr / avgAtr : 1;
    // Check for extreme volatility → POOR
    if (atrRatio > ATR_EXTREME_RATIO) {
        return {
            asset,
            regime: 'POOR',
            adx: lastAdx,
            atrRatio,
            emaAligned: false,
            timestamp: Date.now(),
        };
    }
    // Check for NaN (not enough data)
    if (isNaN(lastAdx) || isNaN(lastEma200)) {
        return {
            asset,
            regime: 'POOR',
            adx: 0,
            atrRatio,
            emaAligned: false,
            timestamp: Date.now(),
        };
    }
    const emaUpAligned = lastEma20 > lastEma50 && lastEma50 > lastEma200;
    const emaDownAligned = lastEma20 < lastEma50 && lastEma50 < lastEma200;
    const emaAligned = emaUpAligned || emaDownAligned;
    // Low volume check
    const avgVol = candles4h
        .slice(-20)
        .map((c) => c.volume)
        .reduce((a, b) => a + b, 0) / 20;
    const lastVol = candles4h[n - 1].volume;
    const lowVolume = lastVol < avgVol * MIN_VOLUME_PERCENTILE;
    if (lowVolume) {
        return {
            asset,
            regime: 'POOR',
            adx: lastAdx,
            atrRatio,
            emaAligned,
            timestamp: Date.now(),
        };
    }
    // Volatility Expansion
    if (atrRatio > ATR_EXPANSION_RATIO) {
        return {
            asset,
            regime: 'VOL_EXPANSION',
            adx: lastAdx,
            atrRatio,
            emaAligned,
            timestamp: Date.now(),
        };
    }
    // Low Volatility Compression — Bollinger squeeze + ATR compression
    const currentBbWidth = bbResult.width[n - 1];
    const minBbWidth = (0, indicators_1.bollingerWidthMin)(bbResult.width, 20);
    const isSqueeze = !isNaN(currentBbWidth) && currentBbWidth <= minBbWidth * 1.05;
    if (atrRatio < ATR_COMPRESSION_RATIO && isSqueeze) {
        return {
            asset,
            regime: 'LOW_VOL_COMPRESSION',
            adx: lastAdx,
            atrRatio,
            emaAligned,
            timestamp: Date.now(),
        };
    }
    // Strong uptrend
    if (lastAdx > ADX_TREND_THRESHOLD &&
        emaUpAligned &&
        lastClose > lastEma50 &&
        lastPdi > lastMdi) {
        return {
            asset,
            regime: 'TREND_UP',
            adx: lastAdx,
            atrRatio,
            emaAligned: true,
            timestamp: Date.now(),
        };
    }
    // Strong downtrend
    if (lastAdx > ADX_TREND_THRESHOLD &&
        emaDownAligned &&
        lastClose < lastEma50 &&
        lastMdi > lastPdi) {
        return {
            asset,
            regime: 'TREND_DOWN',
            adx: lastAdx,
            atrRatio,
            emaAligned: true,
            timestamp: Date.now(),
        };
    }
    // Range
    if (lastAdx < ADX_RANGE_THRESHOLD) {
        return {
            asset,
            regime: 'RANGE',
            adx: lastAdx,
            atrRatio,
            emaAligned,
            timestamp: Date.now(),
        };
    }
    // Weak trend or mixed — still tradeable as RANGE for conservative approach
    return {
        asset,
        regime: 'RANGE',
        adx: lastAdx,
        atrRatio,
        emaAligned,
        timestamp: Date.now(),
    };
}
function isTradeableRegime(regime) {
    return regime !== 'POOR';
}
function regimeLabel(regime) {
    const labels = {
        TREND_UP: '📈 Trend Up',
        TREND_DOWN: '📉 Trend Down',
        RANGE: '↔️ Range',
        VOL_EXPANSION: '💥 Volatility Expansion',
        LOW_VOL_COMPRESSION: '🔇 Low-Vol Compression',
        POOR: '❌ Poor Conditions',
    };
    return labels[regime];
}
//# sourceMappingURL=regimeDetector.js.map