/**
 * Fixed asset list — no network fetching required.
 *
 * Crypto pairs use Gate.io (CCXT) for OHLCV data.
 * Traditional assets (XAU, XAG, QQQ, SPY) use Yahoo Finance.
 *
 * If any crypto pair is unavailable on Gate.io the scan cycle skips it
 * gracefully (Promise.allSettled in marketData.ts).
 */

import { config } from '../config';
import { logger } from '../utils/logger';

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

/** Loads the fixed asset list into config.trading.assets. Called once on startup. */
export function initializeTopCryptos(): void {
  config.trading.assets.length = 0;
  for (const a of ALL_ASSETS) config.trading.assets.push(a);
  logger.info(`Assets initialised: ${ALL_ASSETS.join(', ')}`);
}

/** No-op kept for compatibility — asset list is static, nothing to refresh. */
export function refreshTopCryptos(): void {
  logger.debug('topCryptos: static list — no refresh needed');
}

/** Returns the full asset list. */
export function getTopCryptoPairs(): string[] {
  return [...CRYPTO_ASSETS];
}
