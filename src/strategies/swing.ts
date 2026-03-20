/**
 * Professional Swing Trade Strategy
 *
 * Top-down logic:
 *  1. BIAS    — Weekly + Daily + 4h HH/HL or LH/LL structure
 *  2. ZONE    — Price at an area of value (≥2 criteria)
 *  3. TRIGGER — Displacement candle, RSI divergence, or liquidity sweep
 *  4. STOP    — Below/above the structural swing point
 *  5. TARGET  — Next structural level at ≥2.5:1 R:R
 *
 * Leverage: tier-based (ELITE 10x, STRONG 8x, MEDIUM 5x) — no dynamic risk-cap formula.
 * Hold: 1–5 days
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseStrategy } from './base';
import { analyseMarketStructure, findStructuralStopPoint, findStructuralTargets } from '../analysis/marketStructure';
import { findAreasOfValue, isPriceInZone } from '../analysis/areaOfValue';
import { cachedRsi, cachedAtr, cachedAtrAverage } from '../indicators/cache';
import { hasBullishDivergence, hasBearishDivergence, sessionQualityScore } from '../indicators/indicators';
import { config } from '../config';
import type { StrategySignal, MultiTimeframeData, Regime, ScoreTier, AreaOfValue, SwingTrigger, SwingMeta, OHLCV } from '../types';

const MIN_ZONE_CONFLUENCE        = 2;
const MIN_RR_PRIMARY             = 2.5;
const DISPLACEMENT_BODY_ATR_MULT = 0.6;
const DISPLACEMENT_VOLUME_MULT   = 1.3;
const SWEEP_WICK_THRESHOLD_PCT   = 0.002;
const STOP_ATR_BUFFER            = 0.25;
const MIN_STOP_PCT = 0.003;
const MAX_STOP_PCT = 0.04;

export class SwingStrategy extends BaseStrategy {
  readonly name = 'Swing';
  readonly supportedRegimes: Regime[] = ['TREND_UP', 'TREND_DOWN', 'RANGE'];

  analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null {
    if (!this.isRegimeSupported(regime)) return null;

    const candles1w  = data['1w'];
    const candles1d  = data['1d'];
    const candles4h  = data['4h'];
    const candles15m = data['15m'];

    if (candles1w.length < 10 || candles1d.length < 30 || candles4h.length < 50) return null;

    // Step 1: bias
    const bias = analyseMarketStructure(candles1w, candles1d, candles4h);
    if (bias.confidence === 'LOW' || bias.direction === null) return null;
    if (regime === 'TREND_UP'   && bias.direction !== 'LONG')  return null;
    if (regime === 'TREND_DOWN' && bias.direction !== 'SHORT') return null;

    const isLong = bias.direction === 'LONG';
    const currentPrice = candles4h[candles4h.length - 1].close;

    // Step 2: zones
    const zones = findAreasOfValue(candles1w, candles1d, candles4h, currentPrice, isLong);
    const qualifiedZones = zones.filter((z) => z.confluenceScore >= MIN_ZONE_CONFLUENCE);
    if (qualifiedZones.length === 0) return null;

    // Step 3–5: for each zone
    for (const zone of qualifiedZones) {
      if (!isPriceInZone(currentPrice, zone)) continue;

      const trigger = this.detectEntryTrigger(candles4h, candles15m, isLong, zone);
      if (!trigger) continue;

      const atr4hVals = cachedAtr(candles4h, 14);
      const atr4h = atr4hVals[atr4hVals.length - 1];
      const stopPoint = findStructuralStopPoint(candles4h, '4h', currentPrice, isLong)
                     ?? findStructuralStopPoint(candles1d, '1d', currentPrice, isLong);
      if (!stopPoint) continue;

      const stopLoss = isLong
        ? stopPoint.price - atr4h * STOP_ATR_BUFFER
        : stopPoint.price + atr4h * STOP_ATR_BUFFER;

      const stopDist = Math.abs(currentPrice - stopLoss);
      const stopPct  = stopDist / currentPrice;
      if (stopPct < MIN_STOP_PCT || stopPct > MAX_STOP_PCT) continue;

      const targets = findStructuralTargets(candles1d, candles4h, currentPrice, stopLoss, isLong);
      if (targets.primary === null) {
        targets.primary = isLong
          ? currentPrice + stopDist * MIN_RR_PRIMARY
          : currentPrice - stopDist * MIN_RR_PRIMARY;
      }

      const rr = Math.abs(targets.primary - currentPrice) / stopDist;
      const atrBuffer = atr4h * 0.15;
      const entryZone: [number, number] = [currentPrice - atrBuffer, currentPrice + atrBuffer];

      // Scoring
      const components = this.zeroComponents();
      components.htfAlignment   = bias.confidence === 'HIGH' ? 20 : 14;
      components.setupQuality   = Math.min(20, zone.confluenceScore * 5);
      components.momentum       = trigger.quality;

      const rsiVals4h  = cachedRsi(candles4h, 14);
      const rsi4h      = rsiVals4h[rsiVals4h.length - 1] ?? 50;
      const distCenter = Math.abs(rsi4h - 50);
      components.volatilityQuality = (rsi4h >= 35 && rsi4h <= 65)
        ? (distCenter <= 10 ? 10 : distCenter <= 20 ? 7 : 5)
        : 2;

      components.regimeFit =
        (regime === 'TREND_UP' && isLong) || (regime === 'TREND_DOWN' && !isLong) ? 10 :
        regime === 'RANGE' ? 7 : 5;

      components.liquidity       = trigger.hasVolumeConfirmation ? 10 : 5;
      components.slippageRisk    = rr >= 3.0 ? 5 : rr >= 2.5 ? 4 : 2;
      components.sessionQuality  = sessionQualityScore();
      components.recentPerformance = 3;

      const score = this.totalScore(components);
      const tier: ScoreTier =
        score >= 80 ? 'ELITE' : score >= 60 ? 'STRONG' : score >= 40 ? 'MEDIUM' : 'NO_TRADE';
      if (tier === 'NO_TRADE') continue;

      // Tier-based leverage (ELITE=10x, STRONG=8x, MEDIUM=5x) — no dynamic formula.
      const swingLevTiers = config.leverageTiers['swing'] as Record<string, number>;
      const suggestedLeverage = swingLevTiers[tier] ?? 5;
      const capitalAtRisk = stopPct * suggestedLeverage;

      const swingMeta: SwingMeta = {
        bias,
        zone,
        trigger:          trigger.type,
        triggerQuality:   trigger.quality,
        stopSwingPoint:   stopPoint.price,
        primaryTP:        targets.primary,
        extendedTP:       targets.extended,
        rr,
        suggestedLeverage,
        capitalAtRiskPct: capitalAtRisk,
      };

      const biasStr = `W:${bias.weeklyBias[0]} D:${bias.dailyBias[0]} 4H:${bias.fourHourBias[0]}`;
      const trigStr = trigger.type === 'DISPLACEMENT' ? '📊 Displacement'
                    : trigger.type === 'RSI_DIVERGENCE' ? '📉 RSI Div' : '💧 Liq Sweep';

      return {
        id: uuidv4(),
        strategy:  this.name,
        asset:     data.asset,
        direction: isLong ? 'LONG' : 'SHORT',
        tradeType: 'SWING',
        entryZone,
        stopLoss,
        takeProfit: targets.primary,
        components,
        score,
        tier,
        regime,
        timestamp: Date.now(),
        swingMeta,
        notes: `[${biasStr}] ${trigStr} @ ${zone.notes} | SL=${(stopPct * 100).toFixed(2)}% | ${suggestedLeverage}x lev (${(capitalAtRisk * 100).toFixed(1)}% risk) | ${rr.toFixed(1)}:1 R:R${targets.extended ? ` | Ext TP: $${targets.extended.toFixed(2)}` : ''}`,
      };
    }

    return null;
  }

  private detectEntryTrigger(
    candles4h: OHLCV[],
    candles15m: OHLCV[],
    isLong: boolean,
    zone: AreaOfValue
  ): { type: SwingTrigger; quality: number; hasVolumeConfirmation: boolean } | null {
    const avgAtr4h = cachedAtrAverage(candles4h, 14);
    const avgVol4h = candles4h.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const lastCandle4h = candles4h[candles4h.length - 1];

    // candles15m accepted for future use
    void candles15m;

    // Trigger A: Displacement candle
    const disp = this.checkDisplacementCandle(candles4h, isLong, avgAtr4h, avgVol4h);
    if (disp) return disp;

    // Trigger B: RSI divergence
    const rsiVals4h = cachedRsi(candles4h, 14);
    const hasDivergence = isLong
      ? hasBullishDivergence(candles4h.slice(-30), rsiVals4h.slice(-30))
      : hasBearishDivergence(candles4h.slice(-30), rsiVals4h.slice(-30));
    if (hasDivergence) {
      const hasVol = lastCandle4h.volume > avgVol4h * 1.1;
      return { type: 'RSI_DIVERGENCE', quality: hasVol ? 14 : 11, hasVolumeConfirmation: hasVol };
    }

    // Trigger C: Liquidity sweep
    return this.checkLiquiditySweep(candles4h, isLong, zone, avgVol4h);
  }

  private checkDisplacementCandle(
    candles4h: OHLCV[], isLong: boolean, avgAtr4h: number, avgVol4h: number
  ): { type: SwingTrigger; quality: number; hasVolumeConfirmation: boolean } | null {
    for (let i = candles4h.length - 1; i >= candles4h.length - 2; i--) {
      const c = candles4h[i];
      const body = Math.abs(c.close - c.open);
      if (isLong ? c.close <= c.open : c.close >= c.open) continue;
      if (body < avgAtr4h * DISPLACEMENT_BODY_ATR_MULT) continue;
      const hasVolume = c.volume >= avgVol4h * DISPLACEMENT_VOLUME_MULT;
      const bodyRatio = body / avgAtr4h;
      let quality = Math.min(15, Math.round(bodyRatio * 8));
      if (hasVolume) quality = Math.min(15, quality + 3);
      return { type: 'DISPLACEMENT', quality, hasVolumeConfirmation: hasVolume };
    }
    return null;
  }

  private checkLiquiditySweep(
    candles4h: OHLCV[], isLong: boolean, zone: AreaOfValue, avgVol4h: number
  ): { type: SwingTrigger; quality: number; hasVolumeConfirmation: boolean } | null {
    for (let i = candles4h.length - 1; i >= candles4h.length - 3; i--) {
      const c = candles4h[i];
      const threshold = c.close * SWEEP_WICK_THRESHOLD_PCT;
      const isBullSweep = isLong  && c.low  < zone.priceLow  - threshold && c.close > zone.priceLow;
      const isBearSweep = !isLong && c.high > zone.priceHigh + threshold && c.close < zone.priceHigh;
      if (!isBullSweep && !isBearSweep) continue;
      const body = Math.abs(c.close - c.open);
      const wickSize = isLong ? (zone.priceLow - c.low) : (c.high - zone.priceHigh);
      const wickRatio = body > 0 ? wickSize / body : 1;
      const hasVol = c.volume > avgVol4h * 1.2;
      const quality = Math.min(13, Math.round(wickRatio * 5 + 6) + (hasVol ? 2 : 0));
      return { type: 'LIQUIDITY_SWEEP', quality, hasVolumeConfirmation: hasVol };
    }
    return null;
  }
}
