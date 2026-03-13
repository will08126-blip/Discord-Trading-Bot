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
} from './signals/signalManager';
import { checkHardControls, getStrategyWeight } from './adaptation/adaptation';
import {
  buildSignalEmbed,
  buildTPUpdateEmbed,
  buildExitAlertEmbed,
  buildClosedTradeEmbed,
} from './bot/embeds';
import { generateDailySummary } from './llm/summaries';
import { config } from './config';
import { logger } from './utils/logger';
import type { Asset, MultiTimeframeData, RegimeResult, StrategySignal } from './types';

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

      // ── TP proximity alert ───────────────────────────────────────────────
      const tpDist = Math.abs(currentPrice - update.newTP) / currentPrice;
      if (tpDist < 0.003) {
        await tc.send(buildExitAlertEmbed(position, 'TP_APPROACH', currentPrice));
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

    return { signalCount: deduped.length, skipped: false };
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
  cron.schedule(`*/${interval} * * * *`, () => {
    runScanCycle().catch((err) => logger.error('Unhandled scan error:', err));
  });

  // Daily summary: midnight UTC
  cron.schedule('0 0 * * *', () => {
    postDailySummary().catch((err) => logger.error('Unhandled summary error:', err));
  });
}
