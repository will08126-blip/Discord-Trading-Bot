import { v4 as uuidv4 } from 'uuid';
import { BaseStrategy } from './base';
import {
  atr,
  atrAverage,
  rsi,
  swingPoints,
  hasBullishDivergence,
  hasBearishDivergence,
  isBullishEngulfing,
  isBearishEngulfing,
  sessionQualityScore,
  isVolumeSpike,
  ema,
} from '../indicators/indicators';
import type { StrategySignal, MultiTimeframeData, Regime, ScoreTier, TradeType } from '../types';

/**
 * Liquidity Sweep Reversal Strategy
 *
 * Logic:
 *  - Detect swing highs/lows on 15m (last 20 candles)
 *  - Sweep: wick extends beyond swing by > 0.2%, body closes back inside range
 *  - Confirmation: RSI divergence or engulfing reversal candle
 *
 * Suitable for: RANGE, TREND_UP (end), TREND_DOWN (end)
 */
export class LiquiditySweepStrategy extends BaseStrategy {
  readonly name = 'Liquidity Sweep';
  readonly supportedRegimes: Regime[] = ['RANGE', 'TREND_UP', 'TREND_DOWN'];

  analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null {
    if (!this.isRegimeSupported(regime)) return null;

    const candles15m = data['15m'];
    const candles5m = data['5m'];

    if (candles15m.length < 30 || candles5m.length < 20) return null;

    const atrVals15m = atr(candles15m, 14);
    const lastAtr15m = atrVals15m[candles15m.length - 1];
    const avgAtr15m = atrAverage(atrVals15m, 14);

    const atrVals5m = atr(candles5m, 14);
    const lastAtr5m = atrVals5m[candles5m.length - 1];
    const avgAtr5m = atrAverage(atrVals5m, 14);

    const rsiVals15m = rsi(candles15m, 14);
    const rsiVals5m = rsi(candles5m, 14);

    // ── Find swing highs/lows on 15m (last 20 candles) ─────────────────────
    const swings = swingPoints(candles15m.slice(-20), 3, 3, 10);

    // ── Look at the last 3 candles on 15m for a sweep ──────────────────────
    const n15 = candles15m.length - 1;

    // Check for bearish sweep (sweep HIGH → bullish reversal)
    const recentHighSwings = swings.filter((s) => s.type === 'HIGH');
    const recentLowSwings = swings.filter((s) => s.type === 'LOW');

    // Bullish reversal signal: sweep of lows then bounce up
    const bullSignal = this.checkSweepReversal(
      candles15m,
      candles5m,
      rsiVals15m,
      recentLowSwings.map((s) => s.price),
      lastAtr15m,
      lastAtr5m,
      avgAtr5m,
      true,
      regime
    );
    if (bullSignal) return { ...bullSignal, asset: data.asset };

    // Bearish reversal signal: sweep of highs then drop
    const bearSignal = this.checkSweepReversal(
      candles15m,
      candles5m,
      rsiVals15m,
      recentHighSwings.map((s) => s.price),
      lastAtr15m,
      lastAtr5m,
      avgAtr5m,
      false,
      regime
    );
    if (bearSignal) return { ...bearSignal, asset: data.asset };

    return null;
  }

  private checkSweepReversal(
    candles15m: any[],
    candles5m: any[],
    rsiVals15m: number[],
    swingPrices: number[],
    lastAtr15m: number,
    lastAtr5m: number,
    avgAtr5m: number,
    isBullReversal: boolean,
    regime: Regime
  ): StrategySignal | null {
    const n15 = candles15m.length - 1;

    for (const swingLevel of swingPrices) {
      // Check last 2 candles on 15m for sweep
      for (let i = n15; i >= n15 - 2; i--) {
        if (i < 0) break;
        const c = candles15m[i];
        const sweepThreshold = swingLevel * 0.002; // 0.2%

        // Bullish reversal: wick below swing low, body closes above
        const isSweepBull =
          isBullReversal &&
          c.low < swingLevel - sweepThreshold &&
          c.close > swingLevel;

        // Bearish reversal: wick above swing high, body closes below
        const isSweepBear =
          !isBullReversal &&
          c.high > swingLevel + sweepThreshold &&
          c.close < swingLevel;

        if (!isSweepBull && !isSweepBear) continue;

        // Confirmation on 5m
        const n5 = candles5m.length - 1;
        const lastCandle5m = candles5m[n5];
        const rsiVals5m = rsi(candles5m, 14);

        const confirmed =
          isBullReversal
            ? isBullishEngulfing(candles5m.slice(-3)) ||
              hasBullishDivergence(candles5m.slice(-20), rsiVals5m.slice(-20))
            : isBearishEngulfing(candles5m.slice(-3)) ||
              hasBearishDivergence(candles5m.slice(-20), rsiVals5m.slice(-20));

        if (!confirmed) continue;

        // Strong wick ratio
        const wickSize = isBullReversal
          ? swingLevel - c.low
          : c.high - swingLevel;
        const bodySize = Math.abs(c.close - c.open);
        const wickRatio = bodySize > 0 ? wickSize / bodySize : 0;

        // Build signal
        const entryMid = lastCandle5m.close;
        // SL: behind the sweep wick with wider buffer (0.7×ATR) — wicks can extend on sweeps
        const stopLoss = isBullReversal
          ? c.low - lastAtr5m * 0.7
          : c.high + lastAtr5m * 0.7;

        const stopDistance = Math.abs(entryMid - stopLoss);
        // TP: 2.5:1 R:R — liquidity sweeps are reversals; more conservative than trend trades
        const takeProfit = isBullReversal
          ? entryMid + stopDistance * 2.5
          : entryMid - stopDistance * 2.5;

        const entryZone: [number, number] = isBullReversal
          ? [entryMid - lastAtr5m * 0.1, entryMid + lastAtr5m * 0.2]
          : [entryMid - lastAtr5m * 0.2, entryMid + lastAtr5m * 0.1];

        // ── Scoring ──────────────────────────────────────────────────
        const components = this.zeroComponents();

        // HTF: check EMA
        const ema20 = ema(candles15m, 20);
        const ema50 = ema(candles15m, 50);
        const n = candles15m.length - 1;
        const htfAligned =
          (isBullReversal && ema20[n] > ema50[n]) ||
          (!isBullReversal && ema20[n] < ema50[n]);
        components.htfAlignment = htfAligned ? 16 : 10;

        // Setup quality: strong wick is key
        components.setupQuality = Math.min(20, Math.round(wickRatio * 8 + 8));

        // Momentum: confirmation candle
        const confBodySize = Math.abs(lastCandle5m.close - lastCandle5m.open);
        components.momentum = Math.min(15, Math.round((confBodySize / avgAtr5m) * 12));

        // Volatility
        const atrRatio = lastAtr5m / avgAtr5m;
        components.volatilityQuality = atrRatio < 2.0 ? 8 : 4;

        // Regime fit: range is ideal
        components.regimeFit = regime === 'RANGE' ? 10 : 6;

        // Volume at sweep
        const avgVol15m = candles15m.slice(-20).reduce((s: number, cv: any) => s + cv.volume, 0) / 20;
        components.liquidity = c.volume > avgVol15m * 1.3 ? 10 : 6;

        // Slippage
        components.slippageRisk = 4;

        // Session
        components.sessionQuality = sessionQualityScore();

        // Recent performance
        components.recentPerformance = 3;

        const score = this.totalScore(components);
        const tier: ScoreTier =
          score >= 80 ? 'ELITE' : score >= 60 ? 'STRONG' : score >= 40 ? 'MEDIUM' : 'NO_TRADE';

        if (tier === 'NO_TRADE') continue;

        const stopPct = Math.abs(entryMid - stopLoss) / entryMid;
        const tradeType: TradeType = stopPct < 0.003 ? 'SCALP' : stopPct < 0.015 ? 'HYBRID' : 'SWING';

        // Asia session gate: scalp trades have tight stops — avoid low-liquidity hours
        if (tradeType === 'SCALP' && sessionQualityScore() <= 2) continue;

        return {
          id: uuidv4(),
          strategy: this.name,
          asset: 'BTC/USDT', // placeholder — overwritten by caller
          direction: isBullReversal ? 'LONG' : 'SHORT',
          tradeType,
          entryZone,
          stopLoss,
          takeProfit,
          components,
          score,
          tier,
          regime,
          timestamp: Date.now(),
          notes: `Sweep@${swingLevel.toFixed(2)}, WickRatio=${wickRatio.toFixed(1)}`,
        };
      }
    }
    return null;
  }
}
