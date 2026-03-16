import { v4 as uuidv4 } from 'uuid';
import { BaseStrategy } from './base';
import {
  ema,
  atr,
  atrAverage,
  bollinger,
  bollingerWidthMin,
  rsi,
  sessionQualityScore,
  isVolumeSpike,
} from '../indicators/indicators';
import type { StrategySignal, MultiTimeframeData, Regime, ScoreTier, TradeType } from '../types';


/**
 * Volatility Expansion Strategy
 *
 * Logic:
 *  - Identify Bollinger Band squeeze on 4h or 15m (width at ≤ 20-period low)
 *  - Entry: 15m close outside Bollinger bands + ATR expanding above 14-period avg
 *  - Direction: determined by last 10 candles' price trend on 4h
 *
 * Suitable for: LOW_VOL_COMPRESSION
 */
export class VolatilityExpansionStrategy extends BaseStrategy {
  readonly name = 'Volatility Expansion';
  readonly supportedRegimes: Regime[] = ['LOW_VOL_COMPRESSION'];

  analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null {
    if (!this.isRegimeSupported(regime)) return null;

    const candles4h = data['4h'];
    const candles15m = data['15m'];
    const candles5m = data['5m'];

    if (candles4h.length < 30 || candles15m.length < 30 || candles5m.length < 20) return null;

    const bb15m = bollinger(candles15m, 20, 2);
    const bb4h = bollinger(candles4h, 20, 2);
    const n15 = candles15m.length - 1;
    const n4h = candles4h.length - 1;

    // ── Confirm squeeze exists on 15m or 4h ────────────────────────────────
    const currentWidth15m = bb15m.width[n15];
    const minWidth15m = bollingerWidthMin(bb15m.width, 20);
    // Guard: Infinity means insufficient BB history — don't treat as squeeze
    const isSqueeze15m = !isNaN(currentWidth15m) && isFinite(minWidth15m) && currentWidth15m <= minWidth15m * 1.1;

    const currentWidth4h = bb4h.width[n4h];
    const minWidth4h = bollingerWidthMin(bb4h.width, 20);
    const isSqueeze4h = !isNaN(currentWidth4h) && isFinite(minWidth4h) && currentWidth4h <= minWidth4h * 1.1;

    if (!isSqueeze15m && !isSqueeze4h) return null;

    // ── Detect expansion: close outside Bollinger on 15m ──────────────────
    const lastCandle15m = candles15m[n15];
    const upperBand15m = bb15m.upper[n15];
    const lowerBand15m = bb15m.lower[n15];

    const breakUp = lastCandle15m.close > upperBand15m;
    const breakDown = lastCandle15m.close < lowerBand15m;

    if (!breakUp && !breakDown) return null;

    // ── ATR must be expanding ─────────────────────────────────────────────
    const atrVals15m = atr(candles15m, 14);
    const lastAtr15m = atrVals15m[n15];
    const avgAtr15m = atrAverage(atrVals15m, 14);
    if (lastAtr15m <= avgAtr15m * 0.9) return null; // not expanding yet

    const atrVals5m = atr(candles5m, 14);
    const lastAtr5m = atrVals5m[candles5m.length - 1];
    const avgAtr5m = atrAverage(atrVals5m, 14);

    // ── Direction: 4h trend from last 10 candles ────────────────────────
    const last10_4h = candles4h.slice(-10);
    const trendPrice = last10_4h[last10_4h.length - 1].close - last10_4h[0].close;
    const isLong = breakUp || (trendPrice > 0 && !breakDown);

    // Reconcile: if break direction and trend disagree, no trade
    if (breakUp && trendPrice < 0) return null;
    if (breakDown && trendPrice > 0) return null;

    // ── Volume confirmation ────────────────────────────────────────────────
    const hasVolumeSpike = isVolumeSpike(candles15m.slice(-20), 1.4);
    if (!hasVolumeSpike) return null;

    // ── Build signal ──────────────────────────────────────────────────────
    const n5 = candles5m.length - 1;
    const lastCandle5m = candles5m[n5];
    const entryMid = lastCandle5m.close;

    // SL: back inside the Bollinger band with 0.5×ATR buffer
    const stopLoss = isLong
      ? lowerBand15m - lastAtr15m * 0.5
      : upperBand15m + lastAtr15m * 0.5;

    const stopDistance = Math.abs(entryMid - stopLoss);
    // TP: trade-type-aware R:R target (classify first so multiplier matches holding horizon).
    const stopPct = entryMid > 0 ? stopDistance / entryMid : 0;
    const tradeType: TradeType = stopPct < 0.003 ? 'SCALP' : stopPct < 0.015 ? 'HYBRID' : 'SWING';
    const rrMultiplier = tradeType === 'SCALP' ? 4.0 : tradeType === 'HYBRID' ? 3.0 : 2.5;
    const takeProfit = isLong ? entryMid + stopDistance * rrMultiplier : entryMid - stopDistance * rrMultiplier;

    const entryZone: [number, number] = [
      entryMid - lastAtr5m * 0.15,
      entryMid + lastAtr5m * 0.15,
    ];

    // ── Scoring ───────────────────────────────────────────────────────────
    const components = this.zeroComponents();

    // HTF alignment via 4h EMA
    const ema20_4h = ema(candles4h, 20);
    const ema50_4h = ema(candles4h, 50);
    const htfAligned =
      (isLong && ema20_4h[n4h] > ema50_4h[n4h]) ||
      (!isLong && ema20_4h[n4h] < ema50_4h[n4h]);
    components.htfAlignment = htfAligned ? 18 : 10;

    // Setup quality: how long was the squeeze?
    const squezeDuration = this.measureSqueezeDuration(bb15m.width, 20);
    components.setupQuality = Math.min(20, Math.round(squezeDuration * 2 + 6));

    // Momentum
    const expansionRatio = lastAtr15m / avgAtr15m;
    components.momentum = Math.min(15, Math.round(expansionRatio * 7));

    // Volatility quality: expanding is good for this strategy
    components.volatilityQuality = expansionRatio >= 1.1 ? 9 : 5;

    // Regime fit: perfect
    components.regimeFit = 10;

    // Volume
    components.liquidity = hasVolumeSpike ? 10 : 5;

    // Slippage
    components.slippageRisk = 4;

    // Session
    components.sessionQuality = sessionQualityScore();

    // Recent performance
    components.recentPerformance = 3;

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
      entryZone,
      stopLoss,
      takeProfit,
      components,
      score,
      tier,
      regime,
      timestamp: Date.now(),
      notes: `Squeeze${isSqueeze4h ? '+4h' : ''}, ATRx=${(lastAtr15m / avgAtr15m).toFixed(2)}`,
    };
  }

  private measureSqueezeDuration(widths: number[], maxLookback: number): number {
    const recent = widths.filter((v) => !isNaN(v)).slice(-maxLookback);
    if (recent.length === 0) return 0;
    const minWidth = Math.min(...recent);
    let count = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i] <= minWidth * 1.2) count++;
      else break;
    }
    return count;
  }
}
