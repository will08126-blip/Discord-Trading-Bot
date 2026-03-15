"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSingleAsset = scanSingleAsset;
exports.runScanCycle = runScanCycle;
exports.startScheduler = startScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const client_1 = require("./bot/client");
const marketData_1 = require("./data/marketData");
const regimeDetector_1 = require("./regime/regimeDetector");
const trendPullback_1 = require("./strategies/trendPullback");
const breakoutRetest_1 = require("./strategies/breakoutRetest");
const liquiditySweep_1 = require("./strategies/liquiditySweep");
const volatilityExpansion_1 = require("./strategies/volatilityExpansion");
const votingEngine_1 = require("./scoring/votingEngine");
const signalManager_1 = require("./signals/signalManager");
const adaptation_1 = require("./adaptation/adaptation");
const embeds_1 = require("./bot/embeds");
const summaries_1 = require("./llm/summaries");
const indicators_1 = require("./indicators/indicators");
const config_1 = require("./config");
const logger_1 = require("./utils/logger");
// Minimum price move (fraction) before posting a health update for an active position.
// 0.015 = 1.5% — meaningful enough to warrant a re-assessment without being too noisy.
const HEALTH_UPDATE_THRESHOLD = 0.015;
// Minimum time between health updates for the same position (ms) — prevents spam on volatile candles
const HEALTH_UPDATE_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const strategies = [
    new trendPullback_1.TrendPullbackStrategy(),
    new breakoutRetest_1.BreakoutRetestStrategy(),
    new liquiditySweep_1.LiquiditySweepStrategy(),
    new volatilityExpansion_1.VolatilityExpansionStrategy(),
];
async function scanSingleAsset(symbol) {
    try {
        const asset = symbol;
        const [candles4h, candles15m, candles5m, candles1m] = await Promise.all([
            (0, marketData_1.fetchOHLCV)(asset, '4h', 200),
            (0, marketData_1.fetchOHLCV)(asset, '15m', 200),
            (0, marketData_1.fetchOHLCV)(asset, '5m', 200),
            (0, marketData_1.fetchOHLCV)(asset, '1m', 200),
        ]);
        const mtfData = {
            asset,
            '4h': candles4h,
            '15m': candles15m,
            '5m': candles5m,
            '1m': candles1m,
        };
        const regime = (0, regimeDetector_1.detectRegime)(asset, candles4h);
        (0, regimeDetector_1.setLastRegime)(asset, regime);
        const signals = [];
        for (const strategy of strategies) {
            try {
                let signal = strategy.analyze(mtfData, regime.regime);
                if (!signal)
                    continue;
                signal = { ...signal, asset };
                const weight = (0, adaptation_1.getStrategyWeight)(strategy.name);
                signal = (0, votingEngine_1.applyAdaptationWeight)(signal, weight);
                signals.push(signal);
            }
            catch {
                // skip failing strategies silently
            }
        }
        return { asset: symbol, regime, signals };
    }
    catch (err) {
        return { asset: symbol, regime: null, signals: [], error: String(err) };
    }
}
// ─── Signal posting ───────────────────────────────────────────────────────────
async function postSignal(signal) {
    const channel = await client_1.discordClient.channels.fetch(config_1.config.discord.signalChannelId);
    if (!channel) {
        logger_1.logger.error(`postSignal: channel ${config_1.config.discord.signalChannelId} not found — check SIGNAL_CHANNEL_ID`);
        return;
    }
    if (!channel.isTextBased()) {
        logger_1.logger.error(`postSignal: channel ${config_1.config.discord.signalChannelId} is not a text channel (type=${channel.type})`);
        return;
    }
    await channel.send((0, embeds_1.buildSignalEmbed)(signal));
    (0, signalManager_1.addPendingSignal)(signal);
    (0, signalManager_1.markSignalSent)(signal);
    logger_1.logger.info(`Signal posted: ${signal.asset} ${signal.direction} score=${signal.score} [${signal.tier}]`);
}
// ─── Position monitoring ──────────────────────────────────────────────────────
async function monitorActivePositions() {
    const positions = (0, signalManager_1.getAllActivePositions)();
    if (positions.length === 0)
        return;
    for (const position of positions) {
        try {
            const asset = position.signal.asset;
            const candles5m = await (0, marketData_1.fetchOHLCV)(asset, '5m');
            const currentPrice = candles5m[candles5m.length - 1].close;
            // ── Early profit alert ────────────────────────────────────────────
            // Fire once when capital return crosses earlyProfitAlertPct threshold.
            const earlyAlertThreshold = config_1.config.trading.earlyProfitAlertPct;
            if (earlyAlertThreshold > 0 && !position.exitAlertSent) {
                const isLong = position.signal.direction === 'LONG';
                const priceMoved = isLong
                    ? (currentPrice - position.entryPrice) / position.entryPrice
                    : (position.entryPrice - currentPrice) / position.entryPrice;
                const capitalReturn = priceMoved * position.suggestedLeverage;
                if (capitalReturn >= earlyAlertThreshold) {
                    position.exitAlertSent = true; // reuse flag — fires once per position
                    const channel = await client_1.discordClient.channels.fetch(position.channelId);
                    if (channel?.isTextBased()) {
                        await channel.send((0, embeds_1.buildEarlyProfitAlertEmbed)(position, currentPrice, capitalReturn));
                    }
                }
            }
            // ── Position health update on significant price moves ──────────────────
            // When price moves ≥1.5% from the last update price, post a health check
            // embed telling the user if the trade still looks valid. Minimum 10-minute
            // gap between updates to avoid spamming during volatile candles.
            const refPrice = position.lastHealthUpdatePrice ?? position.entryPrice;
            const priceMoveSinceUpdate = Math.abs(currentPrice - refPrice) / refPrice;
            const timeSinceUpdate = Date.now() - (position.lastHealthUpdateAt ?? 0);
            if (priceMoveSinceUpdate >= HEALTH_UPDATE_THRESHOLD
                && timeSinceUpdate >= HEALTH_UPDATE_MIN_INTERVAL_MS) {
                try {
                    const rsiVals = (0, indicators_1.rsi)(candles5m, 14);
                    const emaVals = (0, indicators_1.ema)(candles5m, 9);
                    const currentRsi = rsiVals[rsiVals.length - 1] ?? NaN;
                    const currentEma = emaVals[emaVals.length - 1] ?? NaN;
                    position.lastHealthUpdatePrice = currentPrice;
                    position.lastHealthUpdateAt = Date.now();
                    const healthChannel = await client_1.discordClient.channels.fetch(position.channelId);
                    if (healthChannel?.isTextBased()) {
                        await healthChannel.send((0, embeds_1.buildPositionHealthEmbed)(position, currentPrice, currentRsi, currentEma));
                    }
                }
                catch (healthErr) {
                    logger_1.logger.warn(`Health update failed for position ${position.id}:`, healthErr);
                }
            }
            const update = (0, signalManager_1.updateDynamicSLTP)(position, candles5m, currentPrice);
            if (!update)
                continue;
            const channel = await client_1.discordClient.channels.fetch(position.channelId);
            if (!channel?.isTextBased())
                continue;
            const tc = channel;
            // ── TP hit ───────────────────────────────────────────────────────────
            if (update.hitTP) {
                await tc.send((0, embeds_1.buildExitAlertEmbed)(position, 'TP_HIT', currentPrice));
                const trade = (0, signalManager_1.handleSLTPHit)(update);
                if (trade) {
                    await tc.send((0, embeds_1.buildClosedTradeEmbed)(trade));
                }
                continue;
            }
            // ── TP level extended ────────────────────────────────────────────────
            if (update.oldTP !== update.newTP) {
                await tc.send((0, embeds_1.buildTPUpdateEmbed)(position, update.oldTP, update.newTP, currentPrice));
            }
            // ── TP proximity: try to extend before alerting ──────────────────────
            const tpDist = Math.abs(currentPrice - update.newTP) / currentPrice;
            if (tpDist < 0.003) {
                const extension = (0, signalManager_1.attemptMomentumTPExtension)(position, candles5m, currentPrice);
                if (extension) {
                    // Momentum is strong — push TP out and let it run
                    await tc.send((0, embeds_1.buildTPUpdateEmbed)(position, extension.oldTP, extension.newTP, currentPrice));
                }
                else {
                    // Momentum is fading or cap reached — alert to consider taking profit
                    await tc.send((0, embeds_1.buildExitAlertEmbed)(position, 'TP_APPROACH', currentPrice));
                }
            }
        }
        catch (err) {
            logger_1.logger.error(`Error monitoring position ${position.id}:`, err);
        }
    }
}
// ─── Main scan loop ───────────────────────────────────────────────────────────
async function runScanCycle() {
    const guard = (0, adaptation_1.checkHardControls)();
    if (!guard.allowed) {
        logger_1.logger.info(`Scan skipped: ${guard.reason}`);
        return { signalCount: 0, skipped: true, reason: guard.reason };
    }
    logger_1.logger.info('Starting scan cycle...');
    try {
        // 1. Monitor active positions first (most time-sensitive)
        await monitorActivePositions();
        // 2. Fetch all asset data
        let allData;
        try {
            allData = await (0, marketData_1.fetchAllAssets)();
        }
        catch (err) {
            logger_1.logger.error('Data fetch failed:', err);
            return { signalCount: 0, skipped: false };
        }
        const newSignals = [];
        for (const mtfData of allData) {
            const asset = mtfData.asset;
            const regime = (0, regimeDetector_1.detectRegime)(asset, mtfData['4h']);
            (0, regimeDetector_1.setLastRegime)(asset, regime);
            if (!(0, regimeDetector_1.isTradeableRegime)(regime.regime)) {
                logger_1.logger.info(`${asset}: ${regime.regime} — skipping`);
                continue;
            }
            logger_1.logger.info(`${asset}: ${regime.regime} (ADX=${regime.adx.toFixed(1)}, ATRx=${regime.atrRatio.toFixed(2)})`);
            // Run each strategy
            for (const strategy of strategies) {
                try {
                    let signal = strategy.analyze(mtfData, regime.regime);
                    if (!signal) {
                        logger_1.logger.info(`  ${strategy.name}: no setup detected`);
                        continue;
                    }
                    // Fix asset on signals that use placeholder
                    signal = { ...signal, asset };
                    // Apply adaptation weight
                    const weight = (0, adaptation_1.getStrategyWeight)(strategy.name);
                    const preWeightScore = signal.score;
                    signal = (0, votingEngine_1.applyAdaptationWeight)(signal, weight);
                    const weightNote = weight < 1.0
                        ? ` [weight=${weight.toFixed(2)}, score ${preWeightScore}→${signal.score}]`
                        : '';
                    if (signal.tier === 'NO_TRADE') {
                        logger_1.logger.info(`  ${strategy.name}: score=${signal.score} NO_TRADE${weightNote} — filtered out`);
                        continue;
                    }
                    if ((0, signalManager_1.isDuplicateSignal)(signal)) {
                        logger_1.logger.info(`  ${strategy.name}: score=${signal.score} [${signal.tier}]${weightNote} ${signal.direction} — duplicate suppressed (30min window)`);
                        continue;
                    }
                    logger_1.logger.info(`  ${strategy.name}: score=${signal.score} [${signal.tier}]${weightNote} ${signal.direction} ✓ queued`);
                    newSignals.push(signal);
                }
                catch (err) {
                    logger_1.logger.error(`Strategy ${strategy.name} error for ${asset}:`, err);
                }
            }
        }
        // Filter, rank, de-duplicate across strategies
        const ranked = (0, votingEngine_1.filterAndRankSignals)(newSignals, config_1.config.trading.minScoreThreshold);
        const deduped = (0, votingEngine_1.deduplicateSignals)(ranked);
        logger_1.logger.info(`Scan complete: ${newSignals.length} raw → ${ranked.length} ranked → ${deduped.length} posted`);
        let postedCount = 0;
        for (const signal of deduped) {
            try {
                await postSignal(signal);
                postedCount++;
            }
            catch (err) {
                logger_1.logger.error(`Failed to post signal for ${signal.asset} ${signal.direction}:`, err);
            }
        }
        return { signalCount: postedCount, skipped: false };
    }
    catch (err) {
        logger_1.logger.error('Scan cycle error:', err);
        return { signalCount: 0, skipped: false };
    }
}
// ─── Daily summary cron ──────────────────────────────────────────────────────
async function postDailySummary() {
    logger_1.logger.info('Generating daily summary...');
    try {
        const summary = await (0, summaries_1.generateDailySummary)();
        const channel = await client_1.discordClient.channels.fetch(config_1.config.discord.summaryChannelId);
        if (channel?.isTextBased()) {
            await channel.send(summary.slice(0, 2000));
        }
    }
    catch (err) {
        logger_1.logger.error('Daily summary error:', err);
    }
}
// ─── Schedule setup ───────────────────────────────────────────────────────────
function startScheduler() {
    const interval = config_1.config.engine.scanIntervalMinutes;
    logger_1.logger.info(`Starting scan scheduler: every ${interval} min`);
    // Main scan: every N minutes
    // Cron minutes field only accepts 0-59; use setInterval for intervals >= 60
    if (interval < 60) {
        node_cron_1.default.schedule(`*/${interval} * * * *`, () => {
            runScanCycle().catch((err) => logger_1.logger.error('Unhandled scan error:', err));
        });
    }
    else {
        const intervalMs = interval * 60 * 1000;
        setInterval(() => {
            runScanCycle().catch((err) => logger_1.logger.error('Unhandled scan error:', err));
        }, intervalMs);
        logger_1.logger.info(`Using setInterval for ${interval}-minute scan cadence`);
    }
    // Daily summary: midnight UTC
    node_cron_1.default.schedule('0 0 * * *', () => {
        postDailySummary().catch((err) => logger_1.logger.error('Unhandled summary error:', err));
    });
}
//# sourceMappingURL=engine.js.map