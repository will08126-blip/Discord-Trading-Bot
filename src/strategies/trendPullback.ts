import { v4 as uuidv4 } from 'uuid';
import { BaseStrategy } from './base';
import {
  isBullishEngulfing,
  isBearishEngulfing,
  isBullishPin,
  isBearishPin,
  isVolumeSpike,
  sessionQualityScore,
} from '../indicators/indicators';
import { cachedEma, cachedRsi, cachedAtr, cachedAtrAverage } from '../indicators/cache';

import type { StrategySignal, MultiTimeframeData, Regime, ScoreTier, TradeType } from '../types';

/**
 * Trend Pullback Strategy
 *
 * Logic:
 *  - 4h: EMA alignment confirms trend direction (20 > 50 > 200 for long)
 *  - 15m: RSI has pulled back to 40-55 range (long) / 45-60 (short), price near EMA20
 *  - 5m:  Bullish engulfing or pin bar at EMA20 confirms reversal
 *
 * Suitable for: TREND_UP, TREND_DOWN
 */
export class TrendPullbackStrategy extends BaseStrategy {
  readonly name = 'Trend Pullback';
  readonly supportedRegimes: Regime[] = ['TREND_UP', 'TREND_DOWN'];

  analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null {
    if (!this.isRegimeSupported(regime)) return null;

    const isLong = regime === 'TREND_UP';
    const candles4h = data['4h'];
    const candles15m = data['15m'];
    const candles5m = data['5m'];

    if (candles4h.length < 50 || candles15m.length < 30 || candles5m.length < 20) return null;

    // ── 4H: EMA alignment ────────────────────────────────────────────────────
    const ema20_4h = cachedEma(candles4h, 20);
    const ema50_4h = cachedEma(candles4h, 50);
    const ema200_4h = cachedEma(candles4h, 200);
    const n4h = candles4h.length - 1;

    const htfUpAligned =
      ema20_4h[n4h] > ema50_4h[n4h] && ema50_4h[n4h] > ema200_4h[n4h];
    const htfDownAligned =
      ema20_4h[n4h] < ema50_4h[n4h] && ema50_4h[n4h] < ema200_4h[n4h];
    const htfAligned = isLong ? htfUpAligned : htfDownAligned;

    if (!htfAligned) return null;

    // ── 15M: RSI pullback + price near EMA20 ─────────────────────────────────
    const ema20_15m = cachedEma(candles15m, 20);
    const rsi_15m = cachedRsi(candles15m, 14);
    const n15 = candles15m.length - 1;

    const lastClose15 = candles15m[n15].close;
    const lastEma20_15 = ema20_15m[n15];
    const lastRsi15 = rsi_15m[n15];

    const priceNearEma = Math.abs(lastClose15 - lastEma20_15) / lastEma20_15 < 0.005; // within 0.5%

    // RSI ranges are mirrored around 50 so LONG and SHORT conditions are equally selective.
    // LONG:  38–58  (pulled back from overbought, not yet oversold)
    // SHORT: 42–62  (bounced from oversold, not yet overbought) — mirror of LONG around 50
    const rsiPulledBack = isLong
      ? lastRsi15 >= 38 && lastRsi15 <= 58
      : lastRsi15 >= 42 && lastRsi15 <= 62;

    if (!rsiPulledBack || !priceNearEma) return null;

    // ── 5M: Entry confirmation ─────────────────────────────────────────────
    const ema20_5m = cachedEma(candles5m, 20);
    const n5 = candles5m.length - 1;
    const lastCandle5m = candles5m[n5];
    const prevCandle5m = candles5m[n5 - 1];
    const lastEma20_5m = ema20_5m[n5];
    const lastAtr5m = cachedAtr(candles5m, 14)[n5];
    const avgAtr5m = cachedAtrAverage(candles5m, 14);

    const confirmBull =
      isBullishEngulfing(candles5m.slice(-2)) ||
      isBullishPin(lastCandle5m);
    const confirmBear =
      isBearishEngulfing(candles5m.slice(-2)) ||
      isBearishPin(lastCandle5m);
    const confirmed = isLong ? confirmBull : confirmBear;

    if (!confirmed) return null;

    // Price should be near 5m EMA20
    const priceNearEma5m = Math.abs(lastCandle5m.close - lastEma20_5m) / lastEma20_5m < 0.008;
    if (!priceNearEma5m) return null;

    // ── Build signal ──────────────────────────────────────────────────────────
    const entryLow = isLong
      ? Math.min(lastCandle5m.close, lastEma20_5m)
      : Math.min(lastCandle5m.close, lastEma20_5m) - lastAtr5m * 0.1;
    const entryHigh = isLong
      ? Math.max(lastCandle5m.close, lastEma20_5m) + lastAtr5m * 0.1
      : Math.max(lastCandle5m.close, lastEma20_5m);

    const entryMid = (entryLow + entryHigh) / 2;

    // SL: swing low/high of the last 5 candles + 0.5× ATR
    const recentCandles = candles5m.slice(-5);
    const swingLow = Math.min(...recentCandles.map((c) => c.low));
    const swingHigh = Math.max(...recentCandles.map((c) => c.high));

    // SL: wider buffer (1.0×ATR) to avoid getting swept by normal wicks
    const stopLoss = isLong
      ? swingLow - lastAtr5m * 1.0
      : swingHigh + lastAtr5m * 1.0;

    // TP: trade-type-aware R:R target.
    // Classify trade type first so the TP reflects the realistic holding horizon.
    //   SCALP  (SL < 0.3%):  4:1 R:R — very tight, quick exit
    //   HYBRID (SL 0.3-1.5%): 3:1 R:R — moderate; holds hours to a day
    //   SWING  (SL > 1.5%):  2.5:1 R:R — wider room, targets key structural level
    const stopDistance = Math.abs(entryMid - stopLoss);
    const stopPct = entryMid > 0 ? stopDistance / entryMid : 0;
    const tradeType: TradeType = stopPct < 0.003 ? 'SCALP' : stopPct < 0.015 ? 'HYBRID' : 'SWING';
    const rrMultiplier = tradeType === 'SCALP' ? 4.0 : tradeType === 'HYBRID' ? 3.0 : 2.5;
    const takeProfit = isLong ? entryMid + stopDistance * rrMultiplier : entryMid - stopDistance * rrMultiplier;

    // ── Scoring ───────────────────────────────────────────────────────────────
    const components = this.zeroComponents();

    // HTF alignment (0-20)
    const ema20Distance = Math.abs(ema20_4h[n4h] - ema50_4h[n4h]) / ema50_4h[n4h];
    components.htfAlignment = Math.min(20, Math.round(10 + ema20Distance * 1000));

    // Setup quality (0-20): clean pullback depth
    const rsiFromExtreme = isLong
      ? Math.max(0, lastRsi15 - 30) / 30  // 30→60 → 0→1
      : Math.max(0, 70 - lastRsi15) / 30;
    components.setupQuality = Math.min(20, Math.round(rsiFromExtreme * 20));

    // Momentum: confirmation candle size vs ATR
    const bodySize = Math.abs(lastCandle5m.close - lastCandle5m.open);
    components.momentum = Math.min(15, Math.round((bodySize / avgAtr5m) * 10));

    // Volatility quality (0-10): ATR not extreme
    const atrRatio = lastAtr5m / avgAtr5m;
    components.volatilityQuality = atrRatio < 2.0 ? Math.min(10, Math.round((2.0 - atrRatio) * 10)) : 0;

    // Regime fit: perfect match
    components.regimeFit = 10;

    // Liquidity (0-10): volume on confirmation candle
    components.liquidity = isVolumeSpike(candles5m.slice(-20), 1.2) ? 10 : 5;

    // Slippage risk (0-5)
    const spread = lastCandle5m.high - lastCandle5m.low;
    components.slippageRisk = spread < lastAtr5m * 1.5 ? 5 : 2;

    // Session quality (0-5)
    components.sessionQuality = sessionQualityScore();

    // Recent performance: will be set by voting engine via adaptation weights
    components.recentPerformance = 3; // default neutral

    const score = this.totalScore(components);
    const tier: ScoreTier =
      score >= 80 ? 'ELITE' : score >= 60 ? 'STRONG' : score >= 40 ? 'MEDIUM' : 'NO_TRADE';

    if (tier === 'NO_TRADE') return null;

    // Asia session gate: scalp trades have tight stops — avoid low-liquidity hours
    if (tradeType === 'SCALP' && sessionQualityScore() <= 2) return null;

    return {
      id: uuidv4(),
      strategy: this.name,
      asset: data.asset,
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
      notes: `RSI=${lastRsi15.toFixed(1)}, SL=${(stopPct*100).toFixed(2)}%, ${tradeType}`,
    };
  }
}
