// eslint-disable-next-line @typescript-eslint/no-require-imports
const ccxt = require('ccxt');
import type { OHLCV, Asset, Timeframe, MultiTimeframeData } from '../types';
import { getCached, setCache } from './cache';
import { config } from '../config';
import { logger } from '../utils/logger';

const TIMEFRAMES: Timeframe[] = ['4h', '15m', '5m', '1m'];
const CANDLE_LIMIT = 200; // enough for all indicators

// Spot exchanges only — no geo-restricted futures endpoints.
// All three support BTC/USDT, ETH/USDT, SOL/USDT, XRP/USDT, PEPE/USDT with no API key.
const EXCHANGE_PRIORITY = ['binance', 'gate', 'mexc'];

function resolveStartIndex(): number {
  const id = config.engine.exchangeId;
  const idx = EXCHANGE_PRIORITY.indexOf(id);
  return idx >= 0 ? idx : 0;
}

let currentExchangeIndex = resolveStartIndex();
let exchange: any = null;

function getExchange(): any {
  if (!exchange) {
    const id = EXCHANGE_PRIORITY[currentExchangeIndex];
    logger.info(`[marketData] Using exchange: ${id}`);
    exchange = new ccxt[id]({
      enableRateLimit: true,
      timeout: 10000, // 10 s — fail fast rather than hanging indefinitely
    });
  }
  return exchange;
}

function isAvailabilityError(err: unknown): boolean {
  return err instanceof ccxt.ExchangeNotAvailable || err instanceof ccxt.NetworkError;
}

function advanceExchange(err: unknown): boolean {
  if (currentExchangeIndex >= EXCHANGE_PRIORITY.length - 1) return false;
  const failed = EXCHANGE_PRIORITY[currentExchangeIndex];
  currentExchangeIndex++;
  exchange = null; // force fresh instance on next getExchange() call
  logger.warn(
    `[marketData] Exchange "${failed}" unavailable (${(err as Error).message?.slice(0, 80)}). ` +
      `Falling back to "${EXCHANGE_PRIORITY[currentExchangeIndex]}".`
  );
  return true;
}

async function withFallback<T>(fn: (ex: any) => Promise<T>): Promise<T> {
  currentExchangeIndex = resolveStartIndex(); // reset so each call starts from the preferred exchange
  exchange = null;                            // discard any stale instance from a previous failure
  let lastErr: unknown;
  while (currentExchangeIndex < EXCHANGE_PRIORITY.length) {
    try {
      return await fn(getExchange());
    } catch (err) {
      lastErr = err;
      if (!isAvailabilityError(err)) throw err; // non-availability error — don't cascade
      if (!advanceExchange(err)) break; // no more exchanges to try
    }
  }
  throw lastErr;
}

function toOHLCV(raw: any[][]): OHLCV[] {
  return raw.map((c) => ({
    time: c[0] as number,
    open: c[1] as number,
    high: c[2] as number,
    low: c[3] as number,
    close: c[4] as number,
    volume: c[5] as number,
  }));
}

function checkStaleness(candles: OHLCV[], timeframe: Timeframe): void {
  const staleThreshold = config.engine.staleThresholds[timeframe];
  const lastCandle = candles[candles.length - 1];
  const age = Date.now() - lastCandle.time;
  if (age > staleThreshold) {
    logger.warn(
      `Stale data for ${timeframe}: last candle is ${Math.round(age / 1000)}s old — using anyway`
    );
  }
}

export async function fetchOHLCV(
  asset: Asset,
  timeframe: Timeframe,
  limit = CANDLE_LIMIT
): Promise<OHLCV[]> {
  const cached = getCached(asset, timeframe);
  if (cached) return cached;

  logger.debug(`Fetching ${asset} ${timeframe} (${limit} candles)`);
  const raw = await withFallback<any[][]>((ex) => ex.fetchOHLCV(asset, timeframe, undefined, limit));
  const candles = toOHLCV(raw);

  checkStaleness(candles, timeframe);
  setCache(asset, timeframe, candles);

  return candles;
}

export async function fetchMultiTimeframe(asset: Asset): Promise<MultiTimeframeData> {
  const [tf4h, tf15m, tf5m, tf1m] = await Promise.all(
    TIMEFRAMES.map((tf) => fetchOHLCV(asset, tf))
  );

  return {
    asset,
    '4h': tf4h,
    '15m': tf15m,
    '5m': tf5m,
    '1m': tf1m,
  };
}

/** Fetch current mid-price without going through OHLCV */
export async function fetchCurrentPrice(asset: Asset): Promise<number> {
  const ticker = await withFallback<any>((ex) => ex.fetchTicker(asset));
  return ticker.last ?? ticker.close ?? 0;
}

/** Fetch all assets in parallel */
export async function fetchAllAssets(): Promise<MultiTimeframeData[]> {
  return Promise.all(
    config.trading.assets.map((asset) => fetchMultiTimeframe(asset as Asset))
  );
}
