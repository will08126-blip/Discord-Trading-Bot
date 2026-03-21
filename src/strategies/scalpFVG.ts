/**
 * ScalpFVG Strategy — Fair Value Gap + MACD Crossover Scalp
 *
 * Entry logic (3-layer confluence):
 *   1. FAIR VALUE GAP  — an unfilled imbalance zone on 1m (primary) or 5m (backup)
 *      is present near current price, confirming a supply/demand imbalance.
 *
 *   2. MACD CROSSOVER  — 5m MACD(5,13,3) line has just crossed above (LONG) or
 *      below (SHORT) the signal line, confirming momentum direction.
 *
 *   3. MTF TREND FILTER — 5m EMA8 > EMA21 (LONG) or < EMA21 (SHORT),
 *      ensuring we trade with the short-term trend, not against it.
 *
 * Stop placement: below/above the FVG zone low/high ± 0.5×ATR(1m).
 * Target: 3.5R (SCALP) or 2.5R (HYBRID) depending on stop distance.
 * Leverage: 50–80x (regime + score gated).
 *
 * Operates in ALL regimes — scalp FVGs form in any market condition.
 * Score gate: 35 (lower than other strategies — quantity over quality,
 * let the paper engine gather data to refine this threshold over time).
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseStrategy } from './base';
import { cachedAtr, cachedRsi, cachedMacd, cachedFVGs, cachedEmaQuickTrend } from '../indicators/cache';
import { isVolumeSpike, sessionQualityScore, volumeAverage } from '../indicators/indicators';
import { isPriceInFVG } from '../indicators/indicators';
import type { StrategySignal, MultiTimeframeData, Regime, ScoreTier, TradeType } from '../types';

export class ScalpFVGStrategy extends BaseStrategy {
  readonly name = 'Scalp FVG';
  // Operates in all regimes — FVGs appear in trending AND ranging markets
  readonly supportedRegimes: Regime[] = [
    'TREND_UP', 'TREND_DOWN', 'RANGE', 'VOL_EXPANSION', 'LOW_VOL_COMPRESSION',
  ];

  analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null {
    if (!this.isRegimeSupported(regime)) return null;

    const candles1m  = data['1m'];
    const candles5m  = data['5m'];
    const candles15m = data['15m'];

    if (!candles1m || candles1m.length < 30) return null;
    if (!candles5m  || candles5m.length  < 30) return null;
    if (!candles15m || candles15m.length < 20) return null;

    const n1 = candles1m.length - 1;
    const n5 = candles5m.length  - 1;
    const currentPrice = candles1m[n1].close;

    // ── Layer 1: Fair Value Gap detection ─────────────────────────────────────
    // Primary: 1m FVGs (most recent price imbalances)
    const fvgs1m = cachedFVGs(candles1m, 8);
    // Backup: 5m FVGs (larger, more significant zones)
    const fvgs5m = cachedFVGs(candles5m, 5);

    // Find nearest unfilled FVG within 1.5% of current price
    const PROXIMITY_PCT = 0.015;
    const nearbyBullish1m = fvgs1m.filter(
      (z) => z.type === 'BULLISH' &&
      Math.abs(z.midpoint - currentPrice) / currentPrice <= PROXIMITY_PCT
    );
    const nearbyBearish1m = fvgs1m.filter(
      (z) => z.type === 'BEARISH' &&
      Math.abs(z.midpoint - currentPrice) / currentPrice <= PROXIMITY_PCT
    );
    const nearbyBullish5m = fvgs5m.filter(
      (z) => z.type === 'BULLISH' &&
      Math.abs(z.midpoint - currentPrice) / currentPrice <= PROXIMITY_PCT
    );
    const nearbyBearish5m = fvgs5m.filter(
      (z) => z.type === 'BEARISH' &&
      Math.abs(z.midpoint - currentPrice) / currentPrice <= PROXIMITY_PCT
    );

    // Pick the nearest FVG zone for each direction
    const bestBullFVG = [...nearbyBullish1m, ...nearbyBullish5m]
      .sort((a, b) => Math.abs(a.midpoint - currentPrice) - Math.abs(b.midpoint - currentPrice))[0];
    const bestBearFVG = [...nearbyBearish1m, ...nearbyBearish5m]
      .sort((a, b) => Math.abs(a.midpoint - currentPrice) - Math.abs(b.midpoint - currentPrice))[0];

    if (!bestBullFVG && !bestBearFVG) return null; // no nearby FVG — skip

    // ── Layer 2: MACD crossover on 5m (fast params for scalp) ────────────────
    const macd5m = cachedMacd(candles5m, 5, 13, 3);
    const macdLine   = macd5m.macdLine;
    const signalLine = macd5m.signalLine;

    const macdNow   = macdLine[n5];
    const macdPrev  = macdLine[n5 - 1];
    const sigNow    = signalLine[n5];
    const sigPrev   = signalLine[n5 - 1];

    if (isNaN(macdNow) || isNaN(macdPrev) || isNaN(sigNow) || isNaN(sigPrev)) return null;

    // Crossover: MACD crossed signal line in the last 1–2 bars
    const bullishCross = macdPrev <= sigPrev && macdNow > sigNow;  // just crossed up
    const bearishCross = macdPrev >= sigPrev && macdNow < sigNow;  // just crossed down
    // Recent cross (within 3 bars) — avoids missing the exact bar
    const recentBullCross = (() => {
      for (let i = 1; i <= 3; i++) {
        const mi = macdLine[n5 - i];
        const si = signalLine[n5 - i];
        const mp = macdLine[n5 - i - 1];
        const sp = signalLine[n5 - i - 1];
        if (!isNaN(mi) && !isNaN(si) && !isNaN(mp) && !isNaN(sp) && mp <= sp && mi > si) return true;
      }
      return false;
    })();
    const recentBearCross = (() => {
      for (let i = 1; i <= 3; i++) {
        const mi = macdLine[n5 - i];
        const si = signalLine[n5 - i];
        const mp = macdLine[n5 - i - 1];
        const sp = signalLine[n5 - i - 1];
        if (!isNaN(mi) && !isNaN(si) && !isNaN(mp) && !isNaN(sp) && mp >= sp && mi < si) return true;
      }
      return false;
    })();

    const macdBull = bullishCross  || recentBullCross;
    const macdBear = bearishCross  || recentBearCross;

    // ── Layer 3: MTF trend filter (5m + 15m EMA8/21) ──────────────────────────
    const trend5m  = cachedEmaQuickTrend(candles5m,  8, 21);
    const trend15m = cachedEmaQuickTrend(candles15m, 8, 21);

    // At least one timeframe must agree; both agreeing = higher score
    const bullTrend = trend5m === 'UP'   || trend15m === 'UP';
    const bearTrend = trend5m === 'DOWN' || trend15m === 'DOWN';
    const bothBull  = trend5m === 'UP'   && trend15m === 'UP';
    const bothBear  = trend5m === 'DOWN' && trend15m === 'DOWN';

    // ── Direction resolution ──────────────────────────────────────────────────
    let isLong: boolean;
    let fvgZone: typeof bestBullFVG;

    if (bestBullFVG && macdBull && bullTrend && !bestBearFVG) {
      isLong  = true;
      fvgZone = bestBullFVG;
    } else if (bestBearFVG && macdBear && bearTrend && !bestBullFVG) {
      isLong  = false;
      fvgZone = bestBearFVG;
    } else if (bestBullFVG && macdBull && bullTrend) {
      isLong  = true;
      fvgZone = bestBullFVG;
    } else if (bestBearFVG && macdBear && bearTrend) {
      isLong  = false;
      fvgZone = bestBearFVG;
    } else {
      return null; // no valid direction
    }

    if (!fvgZone) return null;

    // ── Price must be IN or touching the FVG zone (entry on retest) ───────────
    const inZone = isPriceInFVG(currentPrice, fvgZone, 0.003);
    // Also allow entry if price is approaching the zone within 0.3%
    const approaching = Math.abs(currentPrice - fvgZone.midpoint) / currentPrice < 0.005;
    if (!inZone && !approaching) return null;

    // ── Stop Loss: beyond the FVG zone + ATR buffer ───────────────────────────
    const atr1m = cachedAtr(candles1m, 14)[n1];
    if (isNaN(atr1m) || atr1m <= 0) return null;

    const stopLoss = isLong
      ? fvgZone.gapLow  - atr1m * 0.5   // below the FVG zone
      : fvgZone.gapHigh + atr1m * 0.5;  // above the FVG zone

    const entryMid = currentPrice;
    const stopDist = Math.abs(entryMid - stopLoss);
    if (stopDist <= 0) return null;

    const stopPct: number = stopDist / entryMid;
    const tradeType: TradeType = stopPct < 0.003 ? 'SCALP' : 'HYBRID';
    const rrMultiplier = tradeType === 'SCALP' ? 4.0 : 3.0;

    const takeProfit = isLong
      ? entryMid + stopDist * rrMultiplier
      : entryMid - stopDist * rrMultiplier;

    const entryLow  = entryMid * 0.9995;
    const entryHigh = entryMid * 1.0005;

    // ── Scoring ───────────────────────────────────────────────────────────────
    const components = this.zeroComponents();

    // HTF alignment (0-20): both timeframes agree = max
    components.htfAlignment = bothBull || bothBear ? 20 : 12;

    // Setup quality (0-20): FVG strength + price inside zone
    const fvgStrengthScore = Math.min(12, Math.round(fvgZone.strength * 10000));
    components.setupQuality = fvgStrengthScore + (inZone ? 8 : 4);

    // Momentum (0-15): MACD histogram and crossover freshness
    const hist = macd5m.histogram[n5];
    const histPrev = macd5m.histogram[n5 - 1];
    const histGrowing = isLong
      ? !isNaN(hist) && !isNaN(histPrev) && hist > histPrev
      : !isNaN(hist) && !isNaN(histPrev) && hist < histPrev;
    components.momentum = (bullishCross || bearishCross) ? 15 : histGrowing ? 10 : 6;

    // Volatility quality (0-10): ATR in a healthy range (not too spiky)
    const atr5m = cachedAtr(candles5m, 14)[n5];
    const avgAtr5m = atr5m / (candles5m[n5].close * 0.005); // ratio to 0.5% move
    components.volatilityQuality = Math.min(10, Math.round(10 - Math.abs(avgAtr5m - 1) * 3));

    // Regime fit (0-10): trending regimes better for directional scalps
    const trendingRegime = regime === 'TREND_UP' || regime === 'TREND_DOWN' || regime === 'VOL_EXPANSION';
    components.regimeFit = trendingRegime ? 10 : 6;

    // Liquidity (0-10): volume check
    const volSpike = isVolumeSpike(candles5m.slice(-20), 1.3);
    const volAvg = volumeAverage(candles5m, 20);
    const lastVol = candles5m[n5].volume;
    const volRatio = volAvg > 0 ? lastVol / volAvg : 1;
    components.liquidity = volSpike ? 10 : Math.min(10, Math.round(volRatio * 6));

    // Slippage (0-5): tight spread on 1m
    const spread1m = candles1m[n1].high - candles1m[n1].low;
    components.slippageRisk = spread1m < atr1m * 1.5 ? 5 : 3;

    // Session quality (0-5)
    components.sessionQuality = sessionQualityScore();

    // Recent performance: neutral (adaptation engine will update)
    components.recentPerformance = 3;

    // RSI check — avoid severely overextended entries
    const rsi5m = cachedRsi(candles5m, 14)[n5];
    if (!isNaN(rsi5m)) {
      if (isLong  && rsi5m > 80) return null; // overbought — skip bull FVG entry
      if (!isLong && rsi5m < 20) return null; // oversold   — skip bear FVG entry
    }

    const score = this.totalScore(components);
    const tier: ScoreTier =
      score >= 80 ? 'ELITE' :
      score >= 60 ? 'STRONG' :
      score >= 35 ? 'MEDIUM' :  // lower gate — FVGs are high-probability at any score
      'NO_TRADE';

    if (tier === 'NO_TRADE') return null;

    // Build notes string for the embed
    const macdStr   = bullishCross || bearishCross ? 'fresh cross' : 'recent cross';
    const fvgSource = nearbyBullish1m.length > 0 || nearbyBearish1m.length > 0 ? '1m' : '5m';
    const trend15mStr = trend15m !== 'NEUTRAL' ? ` 15m:${trend15m}` : '';
    const rsiStr    = !isNaN(rsi5m) ? ` RSI5m=${rsi5m.toFixed(0)}` : '';
    const notes = `FVG(${fvgSource}) ${fvgZone.type} zone=$${fvgZone.gapLow.toFixed(4)}–$${fvgZone.gapHigh.toFixed(4)} | MACD ${macdStr} 5m:${trend5m}${trend15mStr}${rsiStr} [${tradeType}]`;

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
      notes,
    };
  }
}
