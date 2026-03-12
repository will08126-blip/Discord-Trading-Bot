import cron from 'node-cron';
import type { TextChannel } from 'discord.js';
import { discordClient } from './bot/client';
import { fetchAllAssets, fetchOHLCV } from './data/marketData';
import { detectRegime, isTradeableRegime } from './regime/regimeDetector';
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
} from './signals/signalManager';
import { checkHardControls, getStrategyWeight } from './adaptation/adaptation';
import {
  buildSignalEmbed,
  buildSLTPUpdateEmbed,
  buildExitAlertEmbed,
  buildClosedTradeEmbed,
} from './bot/embeds';
import { generateDailySummary } from './llm/summaries';
import { config } from './config';
import { logger } from './utils/logger';
import type { Asset, MultiTimeframeData } from './types';

const strategies = [
  new TrendPullbackStrategy(),
  new BreakoutRetestStrategy(),
  new LiquiditySweepStrategy(),
  new VolatilityExpansionStrategy(),
];

// ─── Signal posting ───────────────────────────────────────────────────────────

async function postSignal(signal: (typeof strategies)[0] extends { analyze: (...a: any) => infer R } ? Exclude<R, null> : never) {
  const channel = await discordClient.channels.fetch(config.discord.signalChannelId);
  if (!channel?.isTextBased()) return;

  const msg = await (channel as TextChannel).send(buildSignalEmbed(signal as any));
  addPendingSignal(signal as any);
  markSignalSent(signal as any);
  logger.info(`Signal posted: ${(signal as any).asset} ${(signal as any).direction} score=${(signal as any).score} [${(signal as any).tier}]`);
}

// ─── Position monitoring ──────────────────────────────────────────────────────

async function monitorActivePositions() {
  const positions = getAllActivePositions();
  if (positions.length === 0) return;

  for (const position of positions) {
    try {
      const asset = position.signal.asset as Asset;
      const candles5m = await fetchOHLCV(asset, '5m', 50);
      const currentPrice = candles5m[candles5m.length - 1].close;

      const update = updateDynamicSLTP(position, candles5m, currentPrice);
      if (!update) continue;

      const channel = await discordClient.channels.fetch(position.channelId);
      if (!channel?.isTextBased()) continue;
      const tc = channel as TextChannel;

      // ── SL/TP hit ────────────────────────────────────────────────────────
      if (update.hitSL || update.hitTP) {
        const type = update.hitTP ? 'TP_HIT' : 'SL_HIT';
        await tc.send(buildExitAlertEmbed(position, type, currentPrice));

        const trade = handleSLTPHit(update);
        if (trade) {
          await tc.send(buildClosedTradeEmbed(trade));
        }
        continue;
      }

      // ── SL/TP levels updated ─────────────────────────────────────────────
      if (update.oldSL !== update.newSL || update.oldTP !== update.newTP) {
        await tc.send(
          buildSLTPUpdateEmbed(
            position,
            update.oldSL,
            update.newSL,
            update.oldTP,
            update.newTP,
            currentPrice
          )
        );
      }

      // ── Proximity alerts ─────────────────────────────────────────────────
      const isLong = position.signal.direction === 'LONG';
      const slDist = Math.abs(currentPrice - update.newSL) / currentPrice;
      const tpDist = Math.abs(currentPrice - update.newTP) / currentPrice;

      if (!position.exitAlertSent && slDist < 0.005) {
        await tc.send(buildExitAlertEmbed(position, 'SL_APPROACH', currentPrice));
        position.exitAlertSent = true;
      } else if (tpDist < 0.003) {
        await tc.send(buildExitAlertEmbed(position, 'TP_APPROACH', currentPrice));
      }
    } catch (err) {
      logger.error(`Error monitoring position ${position.id}:`, err);
    }
  }
}

// ─── Main scan loop ───────────────────────────────────────────────────────────

export async function runScanCycle() {
  const guard = checkHardControls();
  if (!guard.allowed) {
    logger.info(`Scan skipped: ${guard.reason}`);
    return;
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
      return;
    }

    const newSignals: any[] = [];

    for (const mtfData of allData) {
      const asset = mtfData.asset;
      const regime = detectRegime(asset, mtfData['4h']);

      if (!isTradeableRegime(regime.regime)) {
        logger.info(`${asset}: ${regime.regime} — skipping`);
        continue;
      }

      logger.info(`${asset}: ${regime.regime} (ADX=${regime.adx.toFixed(1)}, ATRx=${regime.atrRatio.toFixed(2)})`);

      // Run each strategy
      for (const strategy of strategies) {
        try {
          let signal = strategy.analyze(mtfData, regime.regime);
          if (!signal) continue;

          // Fix asset on signals that use placeholder
          signal = { ...signal, asset };

          // Apply adaptation weight
          const weight = getStrategyWeight(strategy.name);
          signal = applyAdaptationWeight(signal, weight);

          if (signal.tier === 'NO_TRADE') continue;
          if (isDuplicateSignal(signal)) {
            logger.debug(`Duplicate signal suppressed: ${asset} ${signal.direction}`);
            continue;
          }

          newSignals.push(signal);
        } catch (err) {
          logger.error(`Strategy ${strategy.name} error for ${asset}:`, err);
        }
      }
    }

    // Filter, rank, de-duplicate across strategies
    const ranked = filterAndRankSignals(newSignals, config.trading.minScoreThreshold);
    const deduped = deduplicateSignals(ranked);

    logger.info(`Scan complete: ${deduped.length} qualifying signals`);

    for (const signal of deduped) {
      await postSignal(signal);
    }
  } catch (err) {
    logger.error('Scan cycle error:', err);
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
  cron.schedule(`*/${interval} * * * *`, () => {
    runScanCycle().catch((err) => logger.error('Unhandled scan error:', err));
  });

  // Daily summary: midnight UTC
  cron.schedule('0 0 * * *', () => {
    postDailySummary().catch((err) => logger.error('Unhandled summary error:', err));
  });
}
