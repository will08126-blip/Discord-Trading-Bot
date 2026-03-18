import cron from 'node-cron';
import type { TextChannel } from 'discord.js';
import { discordClient } from './bot/client';
import { fetchAllAssets, fetchOHLCV, fetchCurrentPrice } from './data/marketData';
import { detectRegime, isTradeableRegime, setLastRegime, getLastRegimes } from './regime/regimeDetector';
import { TrendPullbackStrategy } from './strategies/trendPullback';
import { BreakoutRetestStrategy } from './strategies/breakoutRetest';
import { LiquiditySweepStrategy } from './strategies/liquiditySweep';
import { VolatilityExpansionStrategy } from './strategies/volatilityExpansion';
import {
  applyAdaptationWeight,
  filterAndRankSignals,
  deduplicateSignals,
} from './scoring/votingEngine';
import {
  addPendingSignal,
  getAllActivePositions,
  isDuplicateSignal,
  markSignalSent,
  updateDynamicSLTP,
  handleSLTPHit,
  attemptMomentumTPExtension,
} from './signals/signalManager';
import { checkHardControls, getStrategyWeight, getMinScoreThreshold } from './adaptation/adaptation';
import {
  buildSignalEmbed,
  buildTPUpdateEmbed,
  buildExitAlertEmbed,
  buildClosedTradeEmbed,
  buildEarlyProfitAlertEmbed,
  buildPositionHealthEmbed,
  buildWatchlistDipEmbed,
} from './bot/embeds';
import { generateDailySummary } from './llm/summaries';
import { cachedRsi, cachedEma, cachedVwap } from './indicators/cache';
import { volumeAverage } from './indicators/indicators';
import { config } from './config';
import { logger } from './utils/logger';
import type { Asset, MultiTimeframeData, RegimeResult, StrategySignal } from './types';

// Capital-return milestones that trigger profit alerts (fraction of capital).
// Each milestone fires once and independently — positions get 1–4 profit pings through a big move.
const PROFIT_MILESTONES = [0.25, 0.75, 1.50, 3.00]; // 25%, 75%, 150%, 300%

// Position health checks fire on two independent triggers:
//   TIME:  at least every 15 minutes regardless of price action
//   PRICE: whenever spot moves ≥1% from the last update price
// A 5-minute minimum gap between updates prevents spam on fast-moving candles.
const HEALTH_PRICE_TRIGGER_PCT = 0.01;          // 1% spot move
const HEALTH_TIME_TRIGGER_MS  = 15 * 60 * 1000; // 15-minute periodic check
const HEALTH_MIN_GAP_MS       =  5 * 60 * 1000; // spam guard

const strategies = [
  new TrendPullbackStrategy(),
  new BreakoutRetestStrategy(),
  new LiquiditySweepStrategy(),
  new VolatilityExpansionStrategy(),
];

// ─── Watchlist dip monitoring state ──────────────────────────────────────────

// Only crypto assets are monitored for dips (non-crypto assets have different
// volatility profiles and would generate excessive noise at these thresholds).
const CRYPTO_WATCHLIST: Asset[] = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'PEPE/USDT'];

// Alert at 3%, 5%, and 8% drops from the rolling high — each fires separately.
const DIP_LEVELS = [0.03, 0.05, 0.08];

// High-water marks: the recent peak price per asset, used as the drop baseline.
// Resets upward whenever price makes a new high.
const watchlistHighWaterMark = new Map<Asset, { price: number; timestamp: number }>();

// Rate-limit: once an alert fires for a given asset+level, suppress re-alerts
// for this duration so we don't spam on choppy price action.
const DIP_ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const watchlistDipAlertLog = new Map<string, number>(); // `${asset}:${level}` → last alert ts

// SL proximity threshold: alert when price is within this % of the stop loss.
const SL_APPROACH_PCT = 0.03; // 3% distance from SL
const SL_APPROACH_COOLDOWN_MS = 15 * 60 * 1000; // re-alert at most every 15 min

// ─── Last scan summary (read by /status) ─────────────────────────────────────

export interface LastScanSummary {
  timestamp: number;
  assetResults: { asset: string; regime: string; topScore: number | null; topStrategy: string | null }[];
  rawSignals: number;
  rankedSignals: number;
  postedSignals: number;
  skipped: boolean;
  skipReason?: string;
}

let _lastScanSummary: LastScanSummary | null = null;
export function getLastScanSummary(): LastScanSummary | null { return _lastScanSummary; }

// ─── Single-asset scan (used by /check, /watchlist, /live) ───────────────────

export interface SingleAssetScanResult {
  asset: string;
  regime: RegimeResult | null;
  signals: StrategySignal[];  // all signals from all strategies (any tier)
  error?: string;
}

export async function scanSingleAsset(symbol: string): Promise<SingleAssetScanResult> {
  try {
    const asset = symbol as Asset;
    const [candles4h, candles15m, candles5m, candles1m] = await Promise.all([
      fetchOHLCV(asset, '4h', 200),
      fetchOHLCV(asset, '15m', 200),
      fetchOHLCV(asset, '5m', 200),
      fetchOHLCV(asset, '1m', 200),
    ]);
    const mtfData: MultiTimeframeData = {
      asset,
      '4h': candles4h,
      '15m': candles15m,
      '5m': candles5m,
      '1m': candles1m,
    };
    const regime = detectRegime(asset, candles4h);
    setLastRegime(asset, regime);

    const signals: StrategySignal[] = [];
    for (const strategy of strategies) {
      try {
        let signal = strategy.analyze(mtfData, regime.regime);
        if (!signal) continue;
        signal = { ...signal, asset };
        const weight = getStrategyWeight(strategy.name);
        signal = applyAdaptationWeight(signal, weight);
        signals.push(signal);
      } catch {
        // skip failing strategies silently
      }
    }
    return { asset: symbol, regime, signals };
  } catch (err) {
    return { asset: symbol, regime: null, signals: [], error: String(err) };
  }
}

// ─── Signal posting ───────────────────────────────────────────────────────────

async function postSignal(signal: StrategySignal) {
  const channel = await discordClient.channels.fetch(config.discord.signalChannelId);
  if (!channel) {
    logger.error(`postSignal: channel ${config.discord.signalChannelId} not found — check SIGNAL_CHANNEL_ID`);
    return;
  }
  if (!channel.isTextBased()) {
    logger.error(`postSignal: channel ${config.discord.signalChannelId} is not a text channel (type=${channel.type})`);
    return;
  }

  await (channel as TextChannel).send(buildSignalEmbed(signal));
  addPendingSignal(signal);
  markSignalSent(signal);
  logger.info(`Signal posted: ${signal.asset} ${signal.direction} score=${signal.score} [${signal.tier}]`);
}

// ─── Position monitoring ──────────────────────────────────────────────────────

async function monitorActivePositions() {
  const positions = getAllActivePositions();
  if (positions.length === 0) return;

  for (const position of positions) {
    try {
      const asset = position.signal.asset as Asset;
      const [candles5m, candles15m, currentPrice] = await Promise.all([
        fetchOHLCV(asset, '5m'),
        fetchOHLCV(asset, '15m'),
        fetchCurrentPrice(asset),
      ]);

      // ── Profit milestone alerts ───────────────────────────────────────
      // ALL exceeded milestones fire in a single cycle — no one-per-cycle drip.
      // firedMilestones is a Set stored as an array for JSON serialisation.
      // Falls back to legacy lastProfitMilestonePct for positions saved before this update.
      const isLong = position.signal.direction === 'LONG';
      const priceMoved = isLong
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice;
      const capitalReturn = priceMoved * position.suggestedLeverage;

      const alreadyFired = new Set<number>(
        position.firedMilestones ??
        (() => {
          // Migrate legacy field — validate it's actually a number before using
          const legacy = position.lastProfitMilestonePct;
          return (typeof legacy === 'number' && isFinite(legacy))
            ? PROFIT_MILESTONES.filter(m => m <= legacy)
            : [];
        })()
      );
      const toFire = PROFIT_MILESTONES.filter(m => !alreadyFired.has(m) && capitalReturn >= m);
      if (toFire.length > 0) {
        for (const milestone of toFire) {
          alreadyFired.add(milestone);
          const profitChannel = await discordClient.channels.fetch(position.channelId).catch(() => null);
          if (profitChannel?.isTextBased()) {
            await (profitChannel as TextChannel).send(
              buildEarlyProfitAlertEmbed(position, currentPrice, capitalReturn, milestone)
            );
          } else {
            logger.warn(`Milestone alert dropped — channel ${position.channelId} not found for position ${position.id}`);
          }
        }
        position.firedMilestones = [...alreadyFired].sort((a, b) => a - b);
      }

      // ── Position health check ─────────────────────────────────────────────
      // Fires when: (a) 15 min have passed since last check (periodic), OR
      //             (b) price has moved ≥1% since the last update (price-triggered).
      // A 5-minute minimum gap prevents spam on fast-moving candles.
      const refPrice = position.lastHealthUpdatePrice ?? position.entryPrice;
      const priceMoveSinceUpdate = Math.abs(currentPrice - refPrice) / refPrice;
      const timeSinceUpdate = Date.now() - (position.lastHealthUpdateAt ?? 0);

      const timeTriggered  = timeSinceUpdate >= HEALTH_TIME_TRIGGER_MS;
      const priceTriggered = priceMoveSinceUpdate >= HEALTH_PRICE_TRIGGER_PCT
                             && timeSinceUpdate >= HEALTH_MIN_GAP_MS;

      if (timeTriggered || priceTriggered) {
        try {
          const rsiVals5m  = cachedRsi(candles5m, 14);
          const ema9Vals   = cachedEma(candles5m, 9);
          const vwapVals   = cachedVwap(candles5m);
          const rsi14      = rsiVals5m[rsiVals5m.length - 1] ?? NaN;
          const ema9       = ema9Vals[ema9Vals.length - 1] ?? NaN;
          const vwap       = vwapVals[vwapVals.length - 1] ?? NaN;

          // RSI slope: compare current RSI to 3 bars ago
          const rsiPrev3   = rsiVals5m[rsiVals5m.length - 4] ?? NaN;
          const rsiSlope: 'rising' | 'flat' | 'falling' =
            !isNaN(rsi14) && !isNaN(rsiPrev3)
              ? rsi14 - rsiPrev3 > 2 ? 'rising' : rsiPrev3 - rsi14 > 2 ? 'falling' : 'flat'
              : 'flat';

          // Volume ratio
          const avgVol     = volumeAverage(candles5m, 20);
          const lastVol    = candles5m[candles5m.length - 1]?.volume ?? 0;
          const volumeRatio = avgVol > 0 ? lastVol / avgVol : undefined;

          // 15m EMA(21)
          const ema21Vals15m = cachedEma(candles15m, 21);
          const ema21_15m    = ema21Vals15m[ema21Vals15m.length - 1] ?? NaN;

          // Skip health embed if core 5m indicators are both unavailable
          if (isNaN(rsi14) && isNaN(ema9)) {
            logger.warn(`Health check skipped for ${asset} — insufficient candle data for indicators`);
          } else {
            position.lastHealthUpdatePrice = currentPrice;
            position.lastHealthUpdateAt = Date.now();

            const healthChannel = await discordClient.channels.fetch(position.channelId).catch(() => null);
            if (healthChannel?.isTextBased()) {
              await (healthChannel as TextChannel).send(
                buildPositionHealthEmbed(position, currentPrice,
                  { rsi14, ema9, rsiSlope, ema21_15m, vwap, volumeRatio },
                  timeTriggered && !priceTriggered ? 'TIME' : 'PRICE')
              );
            } else {
              logger.warn(`Health update dropped — channel ${position.channelId} not found for position ${position.id}`);
            }
          }
        } catch (healthErr) {
          logger.warn(`Health update failed for position ${position.id}:`, healthErr);
        }
      }

      // ── Regime-flip gate ─────────────────────────────────────────────────
      // If the 4H regime has changed since entry, TP extensions are paused.
      // SL trailing still runs (capital protection), but we stop pushing TP
      // further when the market structure that justified this trade is gone.
      // If regime is unknown (first cycle after restart), allow extensions —
      // the next scan cycle will populate the cache and the gate activates then.
      const cachedRegime = getLastRegimes().get(asset);
      if (cachedRegime === undefined) {
        logger.debug(`${asset} regime not yet cached — TP extension gate deferred until first scan`);
      }
      const regimeFlipped = cachedRegime !== undefined && cachedRegime.regime !== position.signal.regime;
      if (regimeFlipped) {
        logger.warn(
          `${asset} regime flipped ${position.signal.regime} → ${cachedRegime!.regime} ` +
          `— TP extensions paused for position ${position.id}`
        );
      }

      // ── SL proximity alert (fires independently before SL is actually hit) ──
      const slDist = Math.abs(currentPrice - position.currentStopLoss) / currentPrice;
      const timeSinceSlAlert = Date.now() - (position.slProximityAlertAt ?? 0);
      const isApproachingSL = position.signal.direction === 'LONG'
        ? currentPrice > position.currentStopLoss   // still above SL but checking distance
        : currentPrice < position.currentStopLoss;  // still below SL but checking distance
      if (isApproachingSL && slDist < SL_APPROACH_PCT && timeSinceSlAlert > SL_APPROACH_COOLDOWN_MS) {
        position.slProximityAlertAt = Date.now();
        const slApproachChannel = await discordClient.channels.fetch(position.channelId).catch(() => null);
        if (slApproachChannel?.isTextBased()) {
          await (slApproachChannel as TextChannel).send(
            buildExitAlertEmbed(position, 'SL_APPROACH', currentPrice)
          );
          logger.info(`SL approach alert sent for ${asset} — ${(slDist * 100).toFixed(2)}% from SL`);
        }
      }

      const update = updateDynamicSLTP(position, candles5m, currentPrice, !regimeFlipped);
      if (!update) continue;

      const channel = await discordClient.channels.fetch(position.channelId);
      if (!channel?.isTextBased()) continue;
      const tc = channel as TextChannel;

      // ── SL hit ───────────────────────────────────────────────────────────
      if (update.hitSL) {
        await tc.send(buildExitAlertEmbed(position, 'SL_HIT', currentPrice));
        const trade = handleSLTPHit(update);
        if (trade) {
          await tc.send(buildClosedTradeEmbed(trade));
        }
        continue;
      }

      // ── TP hit ───────────────────────────────────────────────────────────
      if (update.hitTP) {
        await tc.send(buildExitAlertEmbed(position, 'TP_HIT', currentPrice));

        const trade = handleSLTPHit(update);
        if (trade) {
          await tc.send(buildClosedTradeEmbed(trade));
        }
        continue;
      }

      // ── TP level extended ────────────────────────────────────────────────
      if (update.oldTP !== update.newTP) {
        await tc.send(
          buildTPUpdateEmbed(
            position,
            update.oldTP,
            update.newTP,
            currentPrice
          )
        );
      }

      // ── TP proximity: momentum check at 1% out (was 0.3%) ──────────────
      // Firing at 1% gives the momentum evaluation meaningful lead time
      // rather than checking only when price is already at the doorstep.
      // Skipped entirely if the regime has flipped.
      const tpDist = Math.abs(currentPrice - update.newTP) / currentPrice;
      if (tpDist < 0.010 && !regimeFlipped) {
        const extension = attemptMomentumTPExtension(position, candles5m, currentPrice);
        if (extension) {
          // Momentum is strong — push TP out and let it run
          await tc.send(buildTPUpdateEmbed(position, extension.oldTP, extension.newTP, currentPrice));
        } else {
          // Momentum is fading or cap reached — alert to consider taking profit
          await tc.send(buildExitAlertEmbed(position, 'TP_APPROACH', currentPrice));
        }
      }
    } catch (err) {
      logger.error(`Error monitoring position ${position.id}:`, err);
    }
  }
}

// ─── Watchlist dip monitor ────────────────────────────────────────────────────

async function checkWatchlistDips(): Promise<void> {
  for (const asset of CRYPTO_WATCHLIST) {
    try {
      const currentPrice = await fetchCurrentPrice(asset);

      const watermark = watchlistHighWaterMark.get(asset);
      if (!watermark) {
        // First observation — seed the baseline and move on
        watchlistHighWaterMark.set(asset, { price: currentPrice, timestamp: Date.now() });
        continue;
      }

      // Raise high-water mark if price is making new highs
      if (currentPrice > watermark.price) {
        watchlistHighWaterMark.set(asset, { price: currentPrice, timestamp: Date.now() });
        // Clear fired dip levels so they can re-arm if price rallies and then drops again
        for (const level of DIP_LEVELS) {
          watchlistDipAlertLog.delete(`${asset}:${level}`);
        }
        continue;
      }

      const dropPct = (watermark.price - currentPrice) / watermark.price;

      // Fire alerts from largest threshold down, one per scan cycle per asset.
      // Each level has its own cooldown so a 5% dip fires both the 3% and 5% alerts
      // on their own independent timers.
      for (const level of [...DIP_LEVELS].reverse()) {
        if (dropPct < level) continue;

        const key = `${asset}:${level}`;
        const lastAlert = watchlistDipAlertLog.get(key) ?? 0;
        if (Date.now() - lastAlert <= DIP_ALERT_COOLDOWN_MS) continue;

        watchlistDipAlertLog.set(key, Date.now());
        const dipChannel = await discordClient.channels.fetch(config.discord.signalChannelId).catch(() => null);
        if (dipChannel?.isTextBased()) {
          await (dipChannel as TextChannel).send(
            buildWatchlistDipEmbed(asset, watermark.price, currentPrice, dropPct, watermark.timestamp)
          );
          logger.info(`Watchlist dip alert: ${asset} −${(dropPct * 100).toFixed(2)}% from recent high`);
        }
        break; // Only fire the highest triggered level per scan cycle
      }
    } catch (err) {
      logger.warn(`Watchlist dip check failed for ${asset}:`, err);
    }
  }
}

// ─── Main scan loop ───────────────────────────────────────────────────────────

export async function runScanCycle(): Promise<{ signalCount: number; skipped: boolean; reason?: string }> {
  const guard = checkHardControls();
  if (!guard.allowed) {
    logger.info(`Scan skipped: ${guard.reason}`);
    _lastScanSummary = { timestamp: Date.now(), assetResults: [], rawSignals: 0, rankedSignals: 0, postedSignals: 0, skipped: true, skipReason: guard.reason };
    return { signalCount: 0, skipped: true, reason: guard.reason };
  }

  logger.info('Starting scan cycle...');

  try {
    // 1. Monitor active positions first (most time-sensitive)
    await monitorActivePositions();

    // 2. Check for significant price drops across the crypto watchlist
    await checkWatchlistDips();

    // 3. Fetch all asset data
    let allData: MultiTimeframeData[];
    try {
      allData = await fetchAllAssets();
    } catch (err) {
      logger.error('Data fetch failed:', err);
      return { signalCount: 0, skipped: false };
    }

    const newSignals: any[] = [];
    const assetResults: LastScanSummary['assetResults'] = [];

    for (const mtfData of allData) {
      const asset = mtfData.asset;
      const regime = detectRegime(asset, mtfData['4h']);
      setLastRegime(asset, regime);

      if (!isTradeableRegime(regime.regime)) {
        logger.info(`${asset}: ${regime.regime} — skipping`);
        assetResults.push({ asset, regime: regime.regime, topScore: null, topStrategy: null });
        continue;
      }

      logger.info(`${asset}: ${regime.regime} (ADX=${regime.adx.toFixed(1)}, ATRx=${regime.atrRatio.toFixed(2)})`);

      let assetTopScore: number | null = null;
      let assetTopStrategy: string | null = null;

      // Run each strategy
      for (const strategy of strategies) {
        try {
          let signal = strategy.analyze(mtfData, regime.regime);
          if (!signal) {
            logger.info(`  ${strategy.name}: no setup detected`);
            continue;
          }

          // Fix asset on signals that use placeholder
          signal = { ...signal, asset };

          // Apply adaptation weight
          const weight = getStrategyWeight(strategy.name);
          const preWeightScore = signal.score;
          signal = applyAdaptationWeight(signal, weight);

          const weightNote = weight < 1.0
            ? ` [weight=${weight.toFixed(2)}, score ${preWeightScore}→${signal.score}]`
            : '';

          if (signal.tier === 'NO_TRADE') {
            logger.info(`  ${strategy.name}: score=${signal.score} NO_TRADE${weightNote} — filtered out`);
            continue;
          }
          if (isDuplicateSignal(signal)) {
            logger.info(`  ${strategy.name}: score=${signal.score} [${signal.tier}]${weightNote} ${signal.direction} — duplicate suppressed (30min window)`);
            continue;
          }

          logger.info(`  ${strategy.name}: score=${signal.score} [${signal.tier}]${weightNote} ${signal.direction} ✓ queued`);
          newSignals.push(signal);
          if (assetTopScore === null || signal.score > assetTopScore) {
            assetTopScore = signal.score;
            assetTopStrategy = strategy.name;
          }
        } catch (err) {
          logger.error(`Strategy ${strategy.name} error for ${asset}:`, err);
        }
      }
      assetResults.push({ asset, regime: regime.regime, topScore: assetTopScore, topStrategy: assetTopStrategy });
    }

    // Filter, rank, de-duplicate across strategies
    // Uses the runtime threshold (set via /filter) or falls back to config default.
    const ranked = filterAndRankSignals(newSignals, getMinScoreThreshold());
    const deduped = deduplicateSignals(ranked);

    logger.info(`Scan complete: ${newSignals.length} raw → ${ranked.length} ranked → ${deduped.length} posted`);
    _lastScanSummary = {
      timestamp: Date.now(),
      assetResults,
      rawSignals: newSignals.length,
      rankedSignals: ranked.length,
      postedSignals: deduped.length,
      skipped: false,
    };

    let postedCount = 0;
    for (const signal of deduped) {
      try {
        await postSignal(signal);
        postedCount++;
      } catch (err) {
        logger.error(`Failed to post signal for ${signal.asset} ${signal.direction}:`, err);
      }
    }

    return { signalCount: postedCount, skipped: false };
  } catch (err) {
    logger.error('Scan cycle error:', err);
    return { signalCount: 0, skipped: false };
  }
}

// ─── Daily summary cron ──────────────────────────────────────────────────────

async function postDailySummary() {
  logger.info('Generating daily summary...');
  try {
    const summary = await generateDailySummary();
    const channel = await discordClient.channels.fetch(config.discord.summaryChannelId);
    if (channel?.isTextBased()) {
      await (channel as TextChannel).send(summary.slice(0, 2000));
    }
  } catch (err) {
    logger.error('Daily summary error:', err);
  }
}

// ─── Schedule setup ───────────────────────────────────────────────────────────

export function startScheduler() {
  const interval = config.engine.scanIntervalMinutes;
  logger.info(`Starting scan scheduler: every ${interval} min`);

  // Main scan: every N minutes
  // Cron minutes field only accepts 0-59; use setInterval for intervals >= 60
  if (interval < 60) {
    cron.schedule(`*/${interval} * * * *`, () => {
      runScanCycle().catch((err) => logger.error('Unhandled scan error:', err));
    });
  } else {
    const intervalMs = interval * 60 * 1000;
    setInterval(() => {
      runScanCycle().catch((err) => logger.error('Unhandled scan error:', err));
    }, intervalMs);
    logger.info(`Using setInterval for ${interval}-minute scan cadence`);
  }

  // Daily summary: midnight UTC
  cron.schedule('0 0 * * *', () => {
    postDailySummary().catch((err) => logger.error('Unhandled summary error:', err));
  });
}
