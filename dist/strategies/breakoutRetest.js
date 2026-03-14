"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BreakoutRetestStrategy = void 0;
const uuid_1 = require("uuid");
const base_1 = require("./base");
const indicators_1 = require("../indicators/indicators");
/**
 * Breakout Retest Strategy
 *
 * Logic:
 *  - Identify key horizontal levels from 15m swing points (last 50 candles)
 *  - Detect break: 15m close beyond level by > 0.1%
 *  - Detect retest: price returns within 0.3% of level on 5m
 *  - Confirmation: 5m close back in breakout direction + volume
 *
 * Suitable for: TREND_UP, TREND_DOWN, VOL_EXPANSION
 */
class BreakoutRetestStrategy extends base_1.BaseStrategy {
    name = 'Breakout Retest';
    supportedRegimes = ['TREND_UP', 'TREND_DOWN', 'VOL_EXPANSION'];
    analyze(data, regime) {
        if (!this.isRegimeSupported(regime))
            return null;
        const candles15m = data['15m'];
        const candles5m = data['5m'];
        if (candles15m.length < 50 || candles5m.length < 20)
            return null;
        const atrVals15m = (0, indicators_1.atr)(candles15m, 14);
        const avgAtr15m = (0, indicators_1.atrAverage)(atrVals15m, 14);
        const lastAtr15m = atrVals15m[candles15m.length - 1];
        const atrVals5m = (0, indicators_1.atr)(candles5m, 14);
        const lastAtr5m = atrVals5m[candles5m.length - 1];
        const avgAtr5m = (0, indicators_1.atrAverage)(atrVals5m, 14);
        // ── Identify key levels from 15m swing points ─────────────────────────
        const swings = (0, indicators_1.swingPoints)(candles15m.slice(-50), 3, 3, 20);
        if (swings.length < 2)
            return null;
        // ── Detect recent breakout ────────────────────────────────────────────
        const n15 = candles15m.length - 1;
        const lastClose15m = candles15m[n15].close;
        const prevClose15m = candles15m[n15 - 1].close;
        // Look for a level that was broken 1-8 candles ago
        const signal = this.findRetestSignal(candles15m, candles5m, swings.map((s) => s.price), lastAtr15m, lastAtr5m, avgAtr5m, regime);
        return signal;
    }
    findRetestSignal(candles15m, candles5m, levels, lastAtr15m, lastAtr5m, avgAtr5m, regime) {
        const n15 = candles15m.length - 1;
        const lastClose5m = candles5m[candles5m.length - 1].close;
        for (const level of levels) {
            // Check if a break happened in the last 3-15 candles on 15m
            const breakCandle = this.findBreakCandle(candles15m, level, 3, 15);
            if (!breakCandle)
                continue;
            const isLongBreak = breakCandle.close > level;
            const isShortBreak = breakCandle.close < level;
            // Check if price is currently retesting the level on 5m
            const tolerance = level * 0.003; // 0.3%
            const isRetesting = Math.abs(lastClose5m - level) <= tolerance;
            if (!isRetesting)
                continue;
            // Confirm retest direction: for long breakout, price should bounce up from level
            const lastCandle5m = candles5m[candles5m.length - 1];
            const prevCandle5m = candles5m[candles5m.length - 2];
            const retestConfirmLong = isLongBreak &&
                lastCandle5m.close > lastCandle5m.open && // bullish candle
                lastCandle5m.close > level;
            const retestConfirmShort = isShortBreak &&
                lastCandle5m.close < lastCandle5m.open && // bearish candle
                lastCandle5m.close < level;
            if (!retestConfirmLong && !retestConfirmShort)
                continue;
            const isLong = retestConfirmLong;
            // How many times has this level been retested? (first retest is better)
            const retestCount = this.countRetests(candles15m, level, 0.003);
            // SL: beyond the retest candle's wick + ATR buffer
            const stopLoss = isLong
                ? Math.min(lastCandle5m.low, prevCandle5m.low) - lastAtr5m * 0.3
                : Math.max(lastCandle5m.high, prevCandle5m.high) + lastAtr5m * 0.3;
            const entryMid = lastCandle5m.close;
            const stopDistance = Math.abs(entryMid - stopLoss);
            const takeProfit = isLong
                ? entryMid + stopDistance * 2.5
                : entryMid - stopDistance * 2.5;
            const entryLow = isLong ? level - lastAtr5m * 0.1 : entryMid - lastAtr5m * 0.2;
            const entryHigh = isLong ? entryMid + lastAtr5m * 0.1 : level + lastAtr5m * 0.1;
            // ── Scoring ───────────────────────────────────────────────────────
            const components = this.zeroComponents();
            // HTF alignment: check via EMA direction
            const ema20 = (0, indicators_1.ema)(candles15m, 20);
            const ema50 = (0, indicators_1.ema)(candles15m, 50);
            const n = candles15m.length - 1;
            const htfAligned = (isLong && ema20[n] > ema50[n]) || (!isLong && ema20[n] < ema50[n]);
            components.htfAlignment = htfAligned ? 18 : 8;
            // Setup quality: first retest scores better
            components.setupQuality = retestCount <= 1 ? 18 : retestCount <= 2 ? 12 : 6;
            // Momentum
            const bodySize = Math.abs(lastCandle5m.close - lastCandle5m.open);
            components.momentum = Math.min(15, Math.round((bodySize / avgAtr5m) * 12));
            // Volatility quality
            const atrRatio = lastAtr5m / avgAtr5m;
            components.volatilityQuality = atrRatio < 1.8 ? 8 : 4;
            // Regime fit
            components.regimeFit = regime === 'TREND_UP' || regime === 'TREND_DOWN' ? 10 : 7;
            // Volume on break candle
            const breakIdx = candles15m.indexOf(breakCandle);
            const volAtBreak = candles15m[breakIdx].volume;
            const avgVol = candles15m.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
            components.liquidity = volAtBreak > avgVol * 1.5 ? 10 : 5;
            // Slippage
            components.slippageRisk = lastAtr15m < avgAtr5m * 3 ? 5 : 3;
            // Session
            components.sessionQuality = (0, indicators_1.sessionQualityScore)();
            // Recent performance (default neutral)
            components.recentPerformance = 3;
            const score = this.totalScore(components);
            const tier = score >= 80 ? 'ELITE' : score >= 60 ? 'STRONG' : score >= 40 ? 'MEDIUM' : 'NO_TRADE';
            if (tier === 'NO_TRADE')
                continue;
            const stopPct = Math.abs(entryMid - stopLoss) / entryMid;
            const tradeType = stopPct < 0.003 ? 'SCALP' : stopPct < 0.015 ? 'HYBRID' : 'SWING';
            return {
                id: (0, uuid_1.v4)(),
                strategy: this.name,
                asset: 'BTC/USDT', // placeholder — overwritten by engine with actual asset
                direction: isLong ? 'LONG' : 'SHORT',
                tradeType,
                entryZone: [entryLow, entryHigh],
                stopLoss,
                takeProfit,
                components,
                score,
                tier,
                regime,
                timestamp: Date.now(),
                notes: `Level=${level.toFixed(2)}, Retests=${retestCount}, ${tradeType}`,
            };
        }
        return null;
    }
    findBreakCandle(candles, level, minLookback, maxLookback) {
        const n = candles.length - 1;
        const breakThreshold = level * 0.001; // 0.1%
        for (let i = n - minLookback; i >= n - maxLookback; i--) {
            if (i < 0)
                break;
            const c = candles[i];
            if (Math.abs(c.close - level) > breakThreshold)
                return c;
        }
        return null;
    }
    countRetests(candles, level, tolerancePct) {
        const tolerance = level * tolerancePct;
        let count = 0;
        for (const c of candles.slice(-30)) {
            if (Math.abs(c.close - level) <= tolerance)
                count++;
        }
        return count;
    }
}
exports.BreakoutRetestStrategy = BreakoutRetestStrategy;
//# sourceMappingURL=breakoutRetest.js.map