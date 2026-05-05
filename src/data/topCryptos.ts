/**
 * Adaptive asset validation — verifies symbols are tradeable on startup and
 * prunes dead/unavailable symbols from the scan list so no cycles are wasted
 * fetching OHLCV for delisted or inactive pairs.
 *
 * Crypto pairs use CCXT (configured exchange) for OHLCV data.
 * Traditional assets (XAU, XAG, QQQ, SPY) use Yahoo Finance.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ccxt = require('ccxt');
import { config } from '../config';
import { logger } from '../utils/logger';
import { isYahooAsset, fetchYahooOHLCV } from './yahooFinanceData';

export const CRYPTO_ASSETS = [
  'BTC/USDT',
  'ETH/USDT',
  'SOL/USDT',
  'XRP/USDT',
  'PEPE/USDT',
  'BONK/USDT',
  'HYPE/USDT',
  'SHIB/USDT',
  'AERO/USDT',
  'TAO/USDT',
  'DOGE/USDT',
] as const;

export const TRADITIONAL_ASSETS = [
  'XAU/USD',
  'XAG/USD',
  'QQQ/USD',
  'SPY/USD',
] as const;

export const ALL_ASSETS: string[] = [
  ...CRYPTO_ASSETS,
  ...TRADITIONAL_ASSETS,
];

/**
 * Module-level cache of verified assets after startup validation.
 * Set by verifyAssets() — used by getVerifiedAssets() for external consumers.
 */
let _verifiedAssets: string[] | null = null;

/**
 * Returns the verified asset list (set after startup verification completes).
 * Falls back to ALL_ASSETS if verification hasn't run yet (defensive).
 */
export function getVerifiedAssets(): string[] {
  return _verifiedAssets ?? [...ALL_ASSETS];
}

/** Loads the full asset list into config.trading.assets. Called once on startup. */
export function initializeTopCryptos(): void {
  config.trading.assets.length = 0;
  for (const a of ALL_ASSETS) config.trading.assets.push(a);
  logger.info(`Assets initialised: ${ALL_ASSETS.join(', ')}`);
}

/** No-op kept for compatibility — asset list is static, nothing to refresh. */
export function refreshTopCryptos(): void {
  // If verification already pruned dead assets, re-run to catch newly listed pairs.
  // Currently a no-op — future enhancement could periodically re-verify.
  logger.debug('topCryptos: static list — no refresh needed');
}

/** Returns the full crypto asset list. */
export function getTopCryptoPairs(): string[] {
  return [...CRYPTO_ASSETS];
}

export interface AssetVerificationResult {
  ok: string[];
  failed: string[];
}

/**
 * Verifies ALL assets (crypto + traditional) are reachable, then prunes
 * config.trading.assets to only verified symbols and caches them in
 * _verifiedAssets. Subsequent scan cycles never waste API calls on dead pairs.
 *
 * Crypto pairs are checked via CCXT (configured exchange).
 * Traditional assets checked via Yahoo Finance.
 *
 * If all assets of a type fail (e.g. exchange is down), the original list is
 * preserved rather than silently dropping every symbol.
 */
export async function verifyAssets(): Promise<AssetVerificationResult> {
  const exchangeId: string = config.engine.exchangeId ?? 'binance';
  logger.info(`[assetVerify] Checking ${CRYPTO_ASSETS.length} crypto + ${TRADITIONAL_ASSETS.length} traditional assets…`);

  // ── Crypto verification ─────────────────────────────────────────────
  const cryptoOk: string[] = [];
  const cryptoFailed: string[] = [];

  let exchange: any;
  try {
    const options: any = { enableRateLimit: true, timeout: 10000 };
    if (exchangeId === 'binance' || exchangeId === 'binanceusdm') {
      options.options = { defaultType: 'future' };
    } else if (exchangeId === 'gate' || exchangeId === 'gateio') {
      options.options = { defaultType: 'future' };
    } else if (exchangeId === 'mexc') {
      options.options = { defaultType: 'future' };
    }
    exchange = new ccxt[exchangeId](options);
  } catch (err) {
    logger.warn(`[assetVerify] Could not instantiate exchange "${exchangeId}": ${err}`);
    // Preserve all crypto assets if exchange itself is broken
    cryptoOk.push(...CRYPTO_ASSETS);
  }

  if (exchange) {
    const results = await Promise.allSettled(
      CRYPTO_ASSETS.map(async (symbol) => {
        const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, 3);
        if (!Array.isArray(ohlcv) || ohlcv.length === 0) {
          throw new Error(`Empty OHLCV response for ${symbol}`);
        }
        return symbol;
      })
    );

    results.forEach((r, i) => {
      const symbol = CRYPTO_ASSETS[i];
      if (r.status === 'fulfilled') {
        cryptoOk.push(symbol);
      } else {
        cryptoFailed.push(symbol);
        logger.warn(`[assetVerify] ⚠️  ${symbol} — NOT available on ${exchangeId}: ${(r as PromiseRejectedResult).reason}`);
      }
    });
  }

  // ── Traditional asset verification (Yahoo Finance) ───────────────────
  const tradOk: string[] = [];
  const tradFailed: string[] = [];

  const tradResults = await Promise.allSettled(
    TRADITIONAL_ASSETS.map(async (symbol) => {
      // Fetch 3 daily candles — fast and lightweight
      const ohlcv = await fetchYahooOHLCV(symbol as any, '1d', 3);
      if (!Array.isArray(ohlcv) || ohlcv.length === 0) {
        throw new Error(`Empty OHLCV response for ${symbol}`);
      }
      return symbol;
    })
  );

  tradResults.forEach((r, i) => {
    const symbol = TRADITIONAL_ASSETS[i];
    if (r.status === 'fulfilled') {
      tradOk.push(symbol);
    } else {
      tradFailed.push(symbol);
      logger.warn(`[assetVerify] ⚠️  ${symbol} — NOT available via Yahoo Finance: ${(r as PromiseRejectedResult).reason}`);
    }
  });

  const ok = [...cryptoOk, ...tradOk];
  const failed = [...cryptoFailed, ...tradFailed];

  // ── Prune config.trading.assets to only verified symbols ────────────
  // If ALL symbols failed (exchange outage), keep the original list rather than
  // scanning nothing — the scan cycle will handle individual failures gracefully.
  if (ok.length > 0) {
    const removed = ALL_ASSETS.filter((a) => !ok.includes(a));
    config.trading.assets.length = 0;
    for (const a of ok) config.trading.assets.push(a);
    _verifiedAssets = [...ok];

    if (removed.length > 0) {
      logger.info(
        `[assetVerify] Pruned ${removed.length} dead assets: ${removed.join(', ')} — ` +
        `scanning ${ok.length}/${ALL_ASSETS.length} assets. Run \`/status\` to see active list.`
      );
    } else {
      logger.info(`[assetVerify] ✅ All ${ok.length} assets verified — no pruning needed`);
    }
  } else {
    logger.warn(
      `[assetVerify] All assets failed verification (exchange may be down) — ` +
      `preserving original list; scan cycle will skip dead assets individually`
    );
    _verifiedAssets = [...ALL_ASSETS];
  }

  return { ok, failed };
}
