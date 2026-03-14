"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchOHLCV = fetchOHLCV;
exports.fetchMultiTimeframe = fetchMultiTimeframe;
exports.fetchCurrentPrice = fetchCurrentPrice;
exports.fetchAllAssets = fetchAllAssets;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ccxt = require('ccxt');
const cache_1 = require("./cache");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const TIMEFRAMES = ['4h', '15m', '5m', '1m'];
const CANDLE_LIMIT = 200; // enough for all indicators
// Spot exchanges only — no geo-restricted futures endpoints.
// All three support BTC/USDT, ETH/USDT, SOL/USDT, XRP/USDT, PEPE/USDT with no API key.
const EXCHANGE_PRIORITY = ['binance', 'gate', 'mexc'];
function resolveStartIndex() {
    const id = config_1.config.engine.exchangeId;
    const idx = EXCHANGE_PRIORITY.indexOf(id);
    return idx >= 0 ? idx : 0;
}
let currentExchangeIndex = resolveStartIndex();
let exchange = null;
function getExchange() {
    if (!exchange) {
        const id = EXCHANGE_PRIORITY[currentExchangeIndex];
        logger_1.logger.info(`[marketData] Using exchange: ${id}`);
        exchange = new ccxt[id]({
            enableRateLimit: true,
            timeout: 10000, // 10 s — fail fast rather than hanging indefinitely
        });
    }
    return exchange;
}
function isAvailabilityError(err) {
    return err instanceof ccxt.ExchangeNotAvailable || err instanceof ccxt.NetworkError;
}
function advanceExchange(err) {
    if (currentExchangeIndex >= EXCHANGE_PRIORITY.length - 1)
        return false;
    const failed = EXCHANGE_PRIORITY[currentExchangeIndex];
    currentExchangeIndex++;
    exchange = null; // force fresh instance on next getExchange() call
    logger_1.logger.warn(`[marketData] Exchange "${failed}" unavailable (${err.message?.slice(0, 80)}). ` +
        `Falling back to "${EXCHANGE_PRIORITY[currentExchangeIndex]}".`);
    return true;
}
async function withFallback(fn) {
    let lastErr;
    while (currentExchangeIndex < EXCHANGE_PRIORITY.length) {
        try {
            return await fn(getExchange());
        }
        catch (err) {
            lastErr = err;
            if (!isAvailabilityError(err))
                throw err; // non-availability error — don't cascade
            if (!advanceExchange(err))
                break; // no more exchanges to try
        }
    }
    throw lastErr;
}
function toOHLCV(raw) {
    return raw.map((c) => ({
        time: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5],
    }));
}
function checkStaleness(candles, timeframe) {
    const staleThreshold = config_1.config.engine.staleThresholds[timeframe];
    const lastCandle = candles[candles.length - 1];
    const age = Date.now() - lastCandle.time;
    if (age > staleThreshold) {
        logger_1.logger.warn(`Stale data for ${timeframe}: last candle is ${Math.round(age / 1000)}s old — using anyway`);
    }
}
async function fetchOHLCV(asset, timeframe, limit = CANDLE_LIMIT) {
    const cached = (0, cache_1.getCached)(asset, timeframe);
    if (cached)
        return cached;
    logger_1.logger.debug(`Fetching ${asset} ${timeframe} (${limit} candles)`);
    const raw = await withFallback((ex) => ex.fetchOHLCV(asset, timeframe, undefined, limit));
    const candles = toOHLCV(raw);
    checkStaleness(candles, timeframe);
    (0, cache_1.setCache)(asset, timeframe, candles);
    return candles;
}
async function fetchMultiTimeframe(asset) {
    const [tf4h, tf15m, tf5m, tf1m] = await Promise.all(TIMEFRAMES.map((tf) => fetchOHLCV(asset, tf)));
    return {
        asset,
        '4h': tf4h,
        '15m': tf15m,
        '5m': tf5m,
        '1m': tf1m,
    };
}
/** Fetch current mid-price without going through OHLCV */
async function fetchCurrentPrice(asset) {
    const ticker = await withFallback((ex) => ex.fetchTicker(asset));
    return ticker.last ?? ticker.close ?? 0;
}
/** Fetch all assets in parallel */
async function fetchAllAssets() {
    return Promise.all(config_1.config.trading.assets.map((asset) => fetchMultiTimeframe(asset)));
}
//# sourceMappingURL=marketData.js.map