// eslint-disable-next-line @typescript-eslint/no-require-imports
const ccxt = require('ccxt');
import type { OHLCV, Asset, Timeframe, MultiTimeframeData } from '../types';
import { getCached, setCache } from './cache';
import { config } from '../config';
import { logger } from '../utils/logger';
import { isYahooAsset, fetchYahooOHLCV, fetchYahooCurrentPrice } from './yahooFinanceData';

// Candle limits per timeframe — swing analysis needs more history on HTF
const CANDLE_LIMITS: Record<string, number> = {
  '1w':  100,   // ~2 years of weekly structure
  '1d':  200,   // ~9 months of daily structure
  '4h':  200,
  '15m': 200,
  '5m':  200,
  '1m':  200,
};

const EXCHANGE_PRIORITY = ['binance', 'gate', 'mexc'];
const exchangePool: Record<string, any> = {};

function resolveStartIndex(): number {
  const id = config.engine.exchangeId;
  const idx = EXCHANGE_PRIORITY.indexOf(id);
  return idx >= 0 ? idx : 0;
}

function getPooledExchange(id: string): any {
  if (!exchangePool[id]) {
    logger.info(`[marketData] Initialising exchange: ${id}`);
    exchangePool[id] = new ccxt[id]({
      enableRateLimit: true,
      timeout: 10000,
    });
  }
  return exchangePool[id];
}

function isAvailabilityError(err: unknown): boolean {
  return err instanceof ccxt.ExchangeNotAvailable || err instanceof ccxt.NetworkError;
}

async function withFallback<T>(fn: (ex: any) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = resolveStartIndex(); i < EXCHANGE_PRIORITY.length; i++) {
    const id = EXCHANGE_PRIORITY[i];
    try {
      return await fn(getPooledExchange(id));
    } catch (err) {
      lastErr = err;
      if (!isAvailabilityError(err)) throw err;
      logger.warn(
        `[marketData] Exchange "${id}" unavailable (${(err as Error).message?.slice(0, 80)}). ` +
          `Falling back to "${EXCHANGE_PRIORITY[i + 1] ?? 'none'}".`
      );
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
  limit?: number
): Promise<OHLCV[]> {
  const resolvedLimit = limit ?? CANDLE_LIMITS[timeframe] ?? 200;
  const cached = getCached(asset, timeframe);
  if (cached) return cached;

  logger.debug(`Fetching ${asset} ${timeframe} (${resolvedLimit} candles)`);

  let candles: OHLCV[];
  if (isYahooAsset(asset)) {
    candles = await fetchYahooOHLCV(asset, timeframe, resolvedLimit);
  } else {
    const raw = await withFallback<any[][]>((ex) =>
      ex.fetchOHLCV(asset, timeframe, undefined, resolvedLimit)
    );
    candles = toOHLCV(raw);
  }

  checkStaleness(candles, timeframe);
  setCache(asset, timeframe, candles);

  return candles;
}

export async function fetchMultiTimeframe(asset: Asset): Promise<MultiTimeframeData> {
  const [tf1w, tf1d, tf4h, tf15m, tf5m, tf1m] = await Promise.all([
    fetchOHLCV(asset, '1w'),
    fetchOHLCV(asset, '1d'),
    fetchOHLCV(asset, '4h'),
    fetchOHLCV(asset, '15m'),
    fetchOHLCV(asset, '5m'),
    fetchOHLCV(asset, '1m'),
  ]);

  return {
    asset,
    '1w':  tf1w,
    '1d':  tf1d,
    '4h':  tf4h,
    '15m': tf15m,
    '5m':  tf5m,
    '1m':  tf1m,
  };
}

export async function fetchCurrentPrice(asset: Asset): Promise<number> {
  if (isYahooAsset(asset)) {
    return fetchYahooCurrentPrice(asset);
  }
  const ticker = await withFallback<any>((ex) => ex.fetchTicker(asset));
  const mid = (ticker.bid != null && ticker.ask != null) ? (ticker.bid + ticker.ask) / 2 : undefined;
  const price = ticker.last ?? ticker.close ?? mid;
  if (!price || price <= 0) {
    throw new Error(`Could not determine current price for ${asset} — ticker fields all null/zero`);
  }
  return price;
}

export async function fetchAllAssets(): Promise<MultiTimeframeData[]> {
  return Promise.all(
    config.trading.assets.map((asset) => fetchMultiTimeframe(asset as Asset))
  );
}
