// eslint-disable-next-line @typescript-eslint/no-require-imports
const ccxt = require('ccxt');
import type { OHLCV, Asset, Timeframe, MultiTimeframeData } from '../types';
import { getCached, setCache } from './cache';
import { config } from '../config';
import { logger } from '../utils/logger';

const TIMEFRAMES: Timeframe[] = ['4h', '15m', '5m', '1m'];
const CANDLE_LIMIT = 200; // enough for all indicators

let exchange: any = null;

function getExchange(): any {
  if (!exchange) {
    // No API key needed — Binance Futures public endpoints are free and unauthenticated
    exchange = new ccxt.binanceusdm({
      enableRateLimit: true,
      options: { defaultType: 'future' },
    });
  }
  return exchange;
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
    throw new Error(
      `Stale data for ${timeframe}: last candle is ${Math.round(age / 1000)}s old`
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

  const ex = getExchange();
  logger.debug(`Fetching ${asset} ${timeframe} (${limit} candles)`);

  const raw = await ex.fetchOHLCV(asset, timeframe, undefined, limit);
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
  const ex = getExchange();
  const ticker = await ex.fetchTicker(asset);
  return ticker.last ?? ticker.close ?? 0;
}

/** Fetch all assets in parallel */
export async function fetchAllAssets(): Promise<MultiTimeframeData[]> {
  return Promise.all(
    config.trading.assets.map((asset) => fetchMultiTimeframe(asset as Asset))
  );
}
