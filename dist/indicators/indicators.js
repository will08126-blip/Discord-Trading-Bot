"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ema = ema;
exports.rsi = rsi;
exports.atr = atr;
exports.atrAverage = atrAverage;
exports.adx = adx;
exports.bollinger = bollinger;
exports.bollingerWidthMin = bollingerWidthMin;
exports.vwap = vwap;
exports.swingPoints = swingPoints;
exports.volumeAverage = volumeAverage;
exports.isVolumeSpike = isVolumeSpike;
exports.isBullishEngulfing = isBullishEngulfing;
exports.isBearishEngulfing = isBearishEngulfing;
exports.isBullishPin = isBullishPin;
exports.isBearishPin = isBearishPin;
exports.hasBullishDivergence = hasBullishDivergence;
exports.hasBearishDivergence = hasBearishDivergence;
exports.sessionQualityScore = sessionQualityScore;
const technicalindicators_1 = require("technicalindicators");
// ─── Helpers ────────────────────────────────────────────────────────────────
function closes(candles) {
    return candles.map((c) => c.close);
}
function highs(candles) {
    return candles.map((c) => c.high);
}
function lows(candles) {
    return candles.map((c) => c.low);
}
function volumes(candles) {
    return candles.map((c) => c.volume);
}
/** Pad result array with NaN at the front so it aligns with input array length */
function pad(arr, targetLen, fill) {
    const diff = targetLen - arr.length;
    return [...Array(diff).fill(fill), ...arr];
}
// ─── EMA ─────────────────────────────────────────────────────────────────────
function ema(candles, period) {
    const result = technicalindicators_1.EMA.calculate({ period, values: closes(candles) });
    return pad(result, candles.length, NaN);
}
// ─── RSI ─────────────────────────────────────────────────────────────────────
function rsi(candles, period = 14) {
    const result = technicalindicators_1.RSI.calculate({ period, values: closes(candles) });
    return pad(result, candles.length, NaN);
}
// ─── ATR ─────────────────────────────────────────────────────────────────────
function atr(candles, period = 14) {
    const result = technicalindicators_1.ATR.calculate({
        period,
        high: highs(candles),
        low: lows(candles),
        close: closes(candles),
    });
    return pad(result, candles.length, NaN);
}
/** Average of the ATR values (excluding NaN) */
function atrAverage(atrValues, lookback = 14) {
    const valid = atrValues.filter((v) => !isNaN(v)).slice(-lookback);
    if (valid.length === 0)
        return 0;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
}
function adx(candles, period = 14) {
    const result = technicalindicators_1.ADX.calculate({
        period,
        high: highs(candles),
        low: lows(candles),
        close: closes(candles),
    });
    const adxVals = pad(result.map((r) => r.adx), candles.length, NaN);
    const pdiVals = pad(result.map((r) => r.pdi), candles.length, NaN);
    const mdiVals = pad(result.map((r) => r.mdi), candles.length, NaN);
    return { adx: adxVals, pdi: pdiVals, mdi: mdiVals };
}
function bollinger(candles, period = 20, stdDev = 2) {
    const result = technicalindicators_1.BollingerBands.calculate({
        period,
        values: closes(candles),
        stdDev,
    });
    const upper = pad(result.map((r) => r.upper), candles.length, NaN);
    const middle = pad(result.map((r) => r.middle), candles.length, NaN);
    const lower = pad(result.map((r) => r.lower), candles.length, NaN);
    const width = upper.map((u, i) => isNaN(u) ? NaN : (u - lower[i]) / middle[i]);
    return { upper, middle, lower, width };
}
/**
 * Minimum Bollinger width over the last `lookback` candles (squeeze detector).
 * Returns Infinity when there is insufficient valid data (< 75% of lookback),
 * which callers should treat as "no squeeze data available".
 */
function bollingerWidthMin(width, lookback = 20) {
    const valid = width.filter((v) => !isNaN(v)).slice(-lookback);
    if (valid.length < Math.floor(lookback * 0.75))
        return Infinity;
    return Math.min(...valid);
}
// ─── VWAP (session-based, resets each day) ───────────────────────────────────
function vwap(candles) {
    const result = [];
    let cumulativeTPV = 0;
    let cumulativeVol = 0;
    let lastDay = -1;
    for (const c of candles) {
        const day = new Date(c.time).getUTCDate();
        if (day !== lastDay) {
            cumulativeTPV = 0;
            cumulativeVol = 0;
            lastDay = day;
        }
        const tp = (c.high + c.low + c.close) / 3;
        cumulativeTPV += tp * c.volume;
        cumulativeVol += c.volume;
        result.push(cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : c.close);
    }
    return result;
}
/**
 * Detect swing highs and lows using a simple left/right comparison window.
 * Returns the last `maxPoints` found.
 */
function swingPoints(candles, leftBars = 3, rightBars = 3, maxPoints = 10) {
    const points = [];
    for (let i = leftBars; i < candles.length - rightBars; i++) {
        const c = candles[i];
        let isHigh = true;
        let isLow = true;
        for (let j = i - leftBars; j <= i + rightBars; j++) {
            if (j === i)
                continue;
            if (candles[j].high >= c.high)
                isHigh = false;
            if (candles[j].low <= c.low)
                isLow = false;
        }
        if (isHigh)
            points.push({ index: i, price: c.high, type: 'HIGH' });
        if (isLow)
            points.push({ index: i, price: c.low, type: 'LOW' });
    }
    return points.slice(-maxPoints);
}
// ─── Volume helpers ──────────────────────────────────────────────────────────
function volumeAverage(candles, lookback = 20) {
    const vols = volumes(candles).slice(-lookback);
    if (vols.length === 0)
        return 0;
    return vols.reduce((a, b) => a + b, 0) / vols.length;
}
/** Returns true if the last candle's volume is above the average by ratio */
function isVolumeSpike(candles, ratio = 1.5, lookback = 20) {
    const avg = volumeAverage(candles, lookback);
    const last = candles[candles.length - 1].volume;
    return last >= avg * ratio;
}
// ─── Candle pattern helpers ───────────────────────────────────────────────────
function isBullishEngulfing(candles) {
    if (candles.length < 2)
        return false;
    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];
    return (prev.close < prev.open &&
        curr.close > curr.open &&
        curr.open < prev.close &&
        curr.close > prev.open);
}
function isBearishEngulfing(candles) {
    if (candles.length < 2)
        return false;
    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];
    return (prev.close > prev.open &&
        curr.close < curr.open &&
        curr.open > prev.close &&
        curr.close < prev.open);
}
/** Pin bar: wick is at least 2× the body size, body near one end */
function isBullishPin(candle) {
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    return lowerWick >= body * 2 && lowerWick > upperWick * 2;
}
function isBearishPin(candle) {
    const body = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    return upperWick >= body * 2 && upperWick > lowerWick * 2;
}
// ─── RSI divergence ──────────────────────────────────────────────────────────
/**
 * Bullish divergence: most-recent swing low is lower in price but higher in RSI
 * than the previous swing low (candles 10–20 back).
 *
 * Two-pass approach avoids the backward-iteration bug where the algorithm
 * could never set prevLow when the most-recent candles hold the new low.
 */
function hasBullishDivergence(candles, rsiValues) {
    const n = candles.length;
    if (n < 20)
        return false;
    // Pass 1: find the lowest point in the most-recent 10 candles
    let recentIdx = -1;
    let recentPrice = Infinity;
    for (let i = n - 1; i >= n - 10; i--) {
        if (candles[i].low < recentPrice) {
            recentIdx = i;
            recentPrice = candles[i].low;
        }
    }
    if (recentIdx === -1)
        return false;
    // Pass 2: find the lowest point in the 10 candles before that window
    let prevIdx = -1;
    let prevPrice = Infinity;
    const pass2End = Math.max(0, n - 20);
    for (let i = n - 11; i >= pass2End; i--) {
        if (candles[i].low < prevPrice) {
            prevIdx = i;
            prevPrice = candles[i].low;
        }
    }
    if (prevIdx === -1)
        return false;
    // Bullish divergence: price lower low + RSI higher low
    return recentPrice < prevPrice && rsiValues[recentIdx] > rsiValues[prevIdx];
}
/**
 * Bearish divergence: most-recent swing high is higher in price but lower in RSI
 * than the previous swing high (candles 10–20 back).
 */
function hasBearishDivergence(candles, rsiValues) {
    const n = candles.length;
    if (n < 20)
        return false;
    // Pass 1: find the highest point in the most-recent 10 candles
    let recentIdx = -1;
    let recentPrice = -Infinity;
    for (let i = n - 1; i >= n - 10; i--) {
        if (candles[i].high > recentPrice) {
            recentIdx = i;
            recentPrice = candles[i].high;
        }
    }
    if (recentIdx === -1)
        return false;
    // Pass 2: find the highest point in the 10 candles before that window
    let prevIdx = -1;
    let prevPrice = -Infinity;
    const pass2End = Math.max(0, n - 20);
    for (let i = n - 11; i >= pass2End; i--) {
        if (candles[i].high > prevPrice) {
            prevIdx = i;
            prevPrice = candles[i].high;
        }
    }
    if (prevIdx === -1)
        return false;
    // Bearish divergence: price higher high + RSI lower high
    return recentPrice > prevPrice && rsiValues[recentIdx] < rsiValues[prevIdx];
}
// ─── Session quality ──────────────────────────────────────────────────────────
/**
 * Returns a session quality score (0-5).
 * London open: 08:00-12:00 UTC
 * NY open: 13:00-17:00 UTC
 * Overlap: 13:00-16:00 UTC (highest quality)
 * Asia: 00:00-08:00 UTC (lower quality)
 * Weekend: reduced quality
 */
function sessionQualityScore() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
    if (dayOfWeek === 0 || dayOfWeek === 6)
        return 1;
    const hour = now.getUTCHours();
    if (hour >= 13 && hour < 16)
        return 5; // NY/London overlap (highest quality)
    if (hour >= 8 && hour < 12)
        return 5; // London open
    if (hour >= 16 && hour < 17)
        return 4; // NY only (post-overlap)
    if (hour >= 12 && hour < 13)
        return 3; // lunch (12–13 UTC)
    if (hour >= 0 && hour < 8)
        return 2; // Asia
    return 3; // everything else (late NY 17–24 UTC)
}
//# sourceMappingURL=indicators.js.map