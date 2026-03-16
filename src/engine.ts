import cron from 'node-cron';
import type { TextChannel } from 'discord.js';
import { discordClient } from './bot/client';
import { fetchAllAssets, fetchOHLCV } from './data/marketData';
import { detectRegime, isTradeableRegime, setLastRegime } from './regime/regimeDetector';
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
} from './bot/embeds';
import { generateDailySummary } from './llm/summaries';
import { rsi, ema } from './indicators/indicators';
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
      const candles5m = await fetchOHLCV(asset, '5m');
      const currentPrice = candles5m[candles5m.length - 1].close;

      // ── Profit milestone alerts ───────────────────────────────────────
      // Fire at each milestone (25%, 75%, 150%, 300% capital return), independently.
      // Much better than the old single-fire flag — positions get up to 4 profit pings.
      const isLong = position.signal.direction === 'LONG';
      const priceMoved = isLong
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice;
      const capitalReturn = priceMoved * position.suggestedLeverage;
      const lastMilestone = position.lastProfitMilestonePct ?? -1;
      const hitMilestone = PROFIT_MILESTONES.find(m => m > lastMilestone && capitalReturn >= m);
      if (hitMilestone !== undefined) {
        position.lastProfitMilestonePct = hitMilestone;
        const profitChannel = await discordClient.channels.fetch(position.channelId);
        if (profitChannel?.isTextBased()) {
          await (profitChannel as TextChannel).send(
            buildEarlyProfitAlertEmbed(position, currentPrice, capitalReturn, hitMilestone)
          );
        }
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
          const rsiVals = rsi(candles5m, 14);
          const emaVals = ema(candles5m, 9);
          const currentRsi = rsiVals[rsiVals.length - 1] ?? NaN;
          const currentEma = emaVals[emaVals.length - 1] ?? NaN;

          position.lastHealthUpdatePrice = currentPrice;
          position.lastHealthUpdateAt = Date.now();

          const healthChannel = await discordClient.channels.fetch(position.channelId);
          if (healthChannel?.isTextBased()) {
            await (healthChannel as TextChannel).send(
              buildPositionHealthEmbed(position, currentPrice, currentRsi, currentEma,
                timeTriggered && !priceTriggered ? 'TIME' : 'PRICE')
            );
          }
        } catch (healthErr) {
          logger.warn(`Health update failed for position ${position.id}:`, healthErr);
        }
      }

      const update = updateDynamicSLTP(position, candles5m, currentPrice);
      if (!update) continue;

      const channel = await discordClient.channels.fetch(position.channelId);
      if (!channel?.isTextBased()) continue;
      const tc = channel as TextChannel;

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

      // ── TP proximity: try to extend before alerting ──────────────────────
      const tpDist = Math.abs(currentPrice - update.newTP) / currentPrice;
      if (tpDist < 0.003) {
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

// ─── Main scan loop ───────────────────────────────────────────────────────────

export async function runScanCycle(): Promise<{ signalCount: number; skipped: boolean; reason?: string }> {
  const guard = checkHardControls();
  if (!guard.allowed) {
    logger.info(`Scan skipped: ${guard.reason}`);
    return { signalCount: 0, skipped: true, reason: guard.reason };
  }

  logger.info('Starting scan cycle...');

  try {
    // 1. Monitor active positions first (most time-sensitive)
    await monitorActivePositions();

    // 2. Fetch all asset data
    let allData: MultiTimeframeData[];
    try {
      allData = await fetchAllAssets();
    } catch (err) {
      logger.error('Data fetch failed:', err);
      return { signalCount: 0, skipped: false };
    }

    const newSignals: any[] = [];

    for (const mtfData of allData) {
      const asset = mtfData.asset;
      const regime = detectRegime(asset, mtfData['4h']);
      setLastRegime(asset, regime);

      if (!isTradeableRegime(regime.regime)) {
        logger.info(`${asset}: ${regime.regime} — skipping`);
        continue;
      }

      logger.info(`${asset}: ${regime.regime} (ADX=${regime.adx.toFixed(1)}, ATRx=${regime.atrRatio.toFixed(2)})`);

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
        } catch (err) {
          logger.error(`Strategy ${strategy.name} error for ${asset}:`, err);
        }
      }
    }

    // Filter, rank, de-duplicate across strategies
    // Uses the runtime threshold (set via /filter) or falls back to config default.
    const ranked = filterAndRankSignals(newSignals, getMinScoreThreshold());
    const deduped = deduplicateSignals(ranked);

    logger.info(`Scan complete: ${newSignals.length} raw → ${ranked.length} ranked → ${deduped.length} posted`);

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
