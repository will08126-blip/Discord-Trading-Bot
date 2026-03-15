import { v4 as uuidv4 } from 'uuid';
import { BaseStrategy } from './base';
import {
  atr,
  atrAverage,
  isVolumeSpike,
  swingPoints,
  sessionQualityScore,
  ema,
  rsi,
} from '../indicators/indicators';
import type { StrategySignal, MultiTimeframeData, Regime, ScoreTier, TradeType, OHLCV } from '../types';

/**
 * Breakout Retest Strategy (improved)
 *
 * Logic:
 *  1. Identify key horizontal levels from 15m swing highs/lows (last 50 candles)
 *  2. Detect break: a 15m candle CROSSES a level — close is on the breakout side
 *     AND the previous close was on the origin side. This eliminates false positives
 *     where price was already far from the level.
 *  3. Detect retest: price returns within 0.2% of level on 5m (tighter than before)
 *  4. Confirm: 5m close back in breakout direction + volume > 0.8× avg at retest
 *  5. RSI confirmation: momentum must be intact at retest
 *
 * Supported regimes: TREND_UP, TREND_DOWN, VOL_EXPANSION, RANGE
 * (RANGE breakouts are high-probability — price breaks out of compression)
 */
export class BreakoutRetestStrategy extends BaseStrategy {
  readonly name = 'Breakout Retest';
  readonly supportedRegimes: Regime[] = ['TREND_UP', 'TREND_DOWN', 'VOL_EXPANSION', 'RANGE'];

  analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null {
    if (!this.isRegimeSupported(regime)) return null;

    const candles15m = data['15m'];
    const candles5m = data['5m'];

    if (candles15m.length < 50 || candles5m.length < 20) return null;

    const atrVals15m = atr(candles15m, 14);
    const avgAtr15m = atrAverage(atrVals15m, 14);
    const lastAtr15m = atrVals15m[candles15m.length - 1];

    const atrVals5m = atr(candles5m, 14);
    const lastAtr5m = atrVals5m[candles5m.length - 1];
    const avgAtr5m = atrAverage(atrVals5m, 14);

    // ── Identify key levels from 15m swing points ─────────────────────────
    const swings = swingPoints(candles15m.slice(-50), 3, 3, 20);
    if (swings.length < 2) return null;

    // ── Find retest signal ────────────────────────────────────────────────
    const signal = this.findRetestSignal(
      candles15m,
      candles5m,
      swings.map((s) => s.price),
      lastAtr15m,
      lastAtr5m,
      avgAtr5m,
      regime
    );

    return signal;
  }

  private findRetestSignal(
    candles15m: OHLCV[],
    candles5m: OHLCV[],
    levels: number[],
    lastAtr15m: number,
    lastAtr5m: number,
    avgAtr5m: number,
    regime: Regime
  ): StrategySignal | null {
    const lastClose5m = candles5m[candles5m.length - 1].close;

    // Pre-compute RSI and volume average on 5m for retest confirmation
    const rsiVals5m = rsi(candles5m, 14);
    const currentRsi5m = rsiVals5m[rsiVals5m.length - 1] ?? 50;
    const avgVol5m = candles5m.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;

    for (const level of levels) {
      // ── Step 1: Find a true directional break on 15m ──────────────────────
      const breakCandle = this.findBreakCandle(candles15m, level, 3, 15);
      if (!breakCandle) continue;

      const isLongBreak = breakCandle.close > level;
      const isShortBreak = breakCandle.close < level;

      // ── Step 2: Price is currently retesting the level on 5m ──────────────
      // Tightened to 0.2% (was 0.3%) to reduce false retests
      const tolerance = level * 0.002;
      const isRetesting = Math.abs(lastClose5m - level) <= tolerance;
      if (!isRetesting) continue;

      // ── Step 3: Retest direction confirmation on 5m ───────────────────────
      const lastCandle5m = candles5m[candles5m.length - 1];
      const prevCandle5m = candles5m[candles5m.length - 2];

      const retestConfirmLong =
        isLongBreak &&
        lastCandle5m.close > lastCandle5m.open && // bullish candle at retest
        lastCandle5m.close > level;               // closed above the level

      const retestConfirmShort =
        isShortBreak &&
        lastCandle5m.close < lastCandle5m.open && // bearish candle at retest
        lastCandle5m.close < level;               // closed below the level

      if (!retestConfirmLong && !retestConfirmShort) continue;

      const isLong = retestConfirmLong;

      // ── Step 4: Volume confirmation at retest ─────────────────────────────
      // The retest candle should have meaningful volume (>0.8× avg) — avoids low-conviction
      // dips/rallies to the level that will fail
      const retestVolume = lastCandle5m.volume;
      if (avgVol5m > 0 && retestVolume < avgVol5m * 0.8) continue;

      // ── Step 5: RSI momentum confirmation ────────────────────────────────
      // For a long retest: RSI should be > 40 (momentum still intact, not oversold)
      // For a short retest: RSI should be < 60 (momentum still intact, not overbought)
      const rsiValid = isLong ? currentRsi5m > 40 : currentRsi5m < 60;
      if (!rsiValid) continue;

      // How many times has this level been retested? (first retest is better)
      const retestCount = this.countRetests(candles15m, level, 0.002);

      // SL: beyond the retest candle's wick + wider ATR buffer to absorb wick sweeps
      const stopLoss = isLong
        ? Math.min(lastCandle5m.low, prevCandle5m.low) - lastAtr5m * 0.8
        : Math.max(lastCandle5m.high, prevCandle5m.high) + lastAtr5m * 0.8;

      const entryMid = lastCandle5m.close;
      const stopDistance = Math.abs(entryMid - stopLoss);

      if (stopDistance === 0) continue; // degenerate case

      // TP: 3.0:1 R:R — confirmed breakout retests can trend strongly
      const takeProfit = isLong
        ? entryMid + stopDistance * 3.0
        : entryMid - stopDistance * 3.0;

      const entryLow = isLong ? level - lastAtr5m * 0.1 : entryMid - lastAtr5m * 0.2;
      const entryHigh = isLong ? entryMid + lastAtr5m * 0.1 : level + lastAtr5m * 0.1;

      // ── Scoring ────────────────────────────────────────────────────────
      const components = this.zeroComponents();

      // HTF alignment: EMA direction on 15m
      const ema20 = ema(candles15m, 20);
      const ema50 = ema(candles15m, 50);
      const n = candles15m.length - 1;
      const htfAligned =
        (isLong && ema20[n] > ema50[n]) || (!isLong && ema20[n] < ema50[n]);
      components.htfAlignment = htfAligned ? 18 : 8;

      // Setup quality: first retest scores highest (most reliable)
      // 0 prior retests = fresh level, 1 = proven level, 2+ = overused
      components.setupQuality = retestCount === 0 ? 18 : retestCount === 1 ? 14 : 8;

      // Momentum: body size of the confirmation candle relative to average
      const bodySize = Math.abs(lastCandle5m.close - lastCandle5m.open);
      components.momentum = Math.min(15, Math.round((bodySize / avgAtr5m) * 12));

      // Volatility: prefer when ATR is near average (not wildly extended)
      const atrRatio = lastAtr5m / avgAtr5m;
      components.volatilityQuality = atrRatio < 1.8 ? 8 : 4;

      // Regime fit: trend regimes are best; RANGE breakouts also get good score
      components.regimeFit =
        regime === 'TREND_UP' || regime === 'TREND_DOWN' ? 10 :
        regime === 'VOL_EXPANSION' ? 9 :
        regime === 'RANGE' ? 8 : 4;

      // Volume at the original break candle — high-volume breaks are more reliable
      const breakIdx = candles15m.indexOf(breakCandle);
      if (breakIdx > 0) {
        const volAtBreak = candles15m[breakIdx].volume;
        const avgVol15m = candles15m.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
        components.liquidity = volAtBreak > avgVol15m * 2.0 ? 10 :
                               volAtBreak > avgVol15m * 1.5 ? 7 :
                               volAtBreak > avgVol15m * 1.0 ? 4 : 2;
      } else {
        components.liquidity = 4;
      }

      // Slippage: compare ATR dimensions
      components.slippageRisk = lastAtr15m < avgAtr5m * 3 ? 5 : 3;

      // Session quality
      components.sessionQuality = sessionQualityScore();

      // Recent performance (neutral default — adaptation system adjusts this)
      components.recentPerformance = 3;

      const score = this.totalScore(components);
      const tier: ScoreTier =
        score >= 80 ? 'ELITE' : score >= 60 ? 'STRONG' : score >= 40 ? 'MEDIUM' : 'NO_TRADE';

      if (tier === 'NO_TRADE') continue;

      const stopPct = Math.abs(entryMid - stopLoss) / entryMid;
      const tradeType: TradeType = stopPct < 0.003 ? 'SCALP' : stopPct < 0.015 ? 'HYBRID' : 'SWING';

      // Asia session gate: avoid tight stops in low-liquidity hours
      if (tradeType === 'SCALP' && sessionQualityScore() <= 2) continue;

      return {
        id: uuidv4(),
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

  /**
   * Finds a candle that CROSSED the given level (went from one side to the other).
   * Looks backward from candles[n - minLookback] to candles[n - maxLookback].
   *
   * A true breakout candle:
   *   - Long break: close > level + threshold AND previous candle close ≤ level
   *   - Short break: close < level - threshold AND previous candle close ≥ level
   *
   * This fixes the prior bug where any candle far from the level was returned.
   */
  private findBreakCandle(
    candles: OHLCV[],
    level: number,
    minLookback: number,
    maxLookback: number
  ): OHLCV | null {
    const n = candles.length - 1;
    const breakThreshold = level * 0.001; // 0.1% — meaningful move through the level

    for (let i = n - minLookback; i >= n - maxLookback; i--) {
      if (i < 1) break; // need i-1 to check previous candle
      const current = candles[i];
      const previous = candles[i - 1];

      // Long break: current closes above level, previous was at or below level
      const isLongBreak = current.close > level + breakThreshold && previous.close <= level;
      // Short break: current closes below level, previous was at or above level
      const isShortBreak = current.close < level - breakThreshold && previous.close >= level;

      if (isLongBreak || isShortBreak) return current;
    }
    return null;
  }

  /**
   * Counts how many times price has been near this level (within tolerancePct).
   * Lower count = fresher level = higher signal quality.
   */
  private countRetests(candles: OHLCV[], level: number, tolerancePct: number): number {
    const tolerance = level * tolerancePct;
    let count = 0;
    for (const c of candles.slice(-30)) {
      if (Math.abs(c.close - level) <= tolerance) count++;
    }
    // Subtract 1 because the current retest candle itself is included in the count
    return Math.max(0, count - 1);
  }
}
