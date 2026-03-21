import fs from 'fs';
import https from 'https';
import { config } from '../config';
import { logger } from '../utils/logger';

const YAHOO_ASSETS = ['XAU/USD', 'XAG/USD', 'QQQ/USD', 'SPY/USD'];
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=40&page=1';
// Fetch more than 20 so that after Coinbase filtering we still have enough pairs
const COINBASE_PRODUCTS_URL = 'https://api.exchange.coinbase.com/products';

// CoinGecko coin ID → CCXT symbol override (for non-standard mappings)
const ID_TO_SYMBOL_OVERRIDE: Record<string, string> = {
  'shiba-inu': 'SHIB/USDT',
  'wrapped-bitcoin': 'WBTC/USDT',
  'wrapped-ethereum': 'WETH/USDT',
  'staked-ether': 'STETH/USDT',
  'usd-coin': 'USDC/USDT',
  'tether': 'USDT/USDT',  // skip — stablecoin
  'binance-usd': 'BUSD/USDT',
  'dai': 'DAI/USDT',
  'true-usd': 'TUSD/USDT',
};

// Stablecoins to skip (not useful for trading signals)
const SKIP_IDS = new Set(['tether', 'usd-coin', 'binance-usd', 'dai', 'true-usd', 'frax', 'usdd', 'paxos-standard', 'gemini-dollar']);

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
}

interface CoinbaseProduct {
  id: string;
  base_currency: string;
  quote_currency: string;
  status: string;
}

interface TopCryptosCache {
  pairs: string[];
  fetchedAt: number;
}

let memoryCache: TopCryptosCache | null = null;

// Symbols that are valid for CCXT: purely alphanumeric, 2–10 chars, no underscores/hyphens
const VALID_SYMBOL_RE = /^[A-Z0-9]{2,10}$/;

function coinToUsdtPair(coin: CoinGeckoMarket): string | null {
  if (!coin || typeof coin.id !== 'string' || typeof coin.symbol !== 'string') return null;
  if (SKIP_IDS.has(coin.id)) return null;

  if (ID_TO_SYMBOL_OVERRIDE[coin.id]) {
    const override = ID_TO_SYMBOL_OVERRIDE[coin.id];
    // Double-check override itself isn't a skip target
    if (SKIP_IDS.has(coin.id)) return null;
    return override;
  }

  const symbol = coin.symbol.toUpperCase().trim();

  // Reject anything that looks like a derivative product, LP token, or garbage
  // Valid exchange symbols are 2–10 uppercase letters/digits only — no underscores, hyphens, dots
  if (!VALID_SYMBOL_RE.test(symbol)) {
    logger.debug(`topCryptos: skipping coin "${coin.id}" — symbol "${symbol}" is not a plain CCXT symbol`);
    return null;
  }

  return `${symbol}/USDT`;
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DiscordTradingBot/1.0',
        ...(config.coingecko.apiKey ? { 'x-cg-demo-api-key': config.coingecko.apiKey } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('CoinGecko request timeout')); });
  });
}

function loadDiskCache(): TopCryptosCache | null {
  try {
    if (!fs.existsSync(config.paths.topCryptosCache)) return null;
    const raw = fs.readFileSync(config.paths.topCryptosCache, 'utf-8');
    return JSON.parse(raw) as TopCryptosCache;
  } catch {
    return null;
  }
}

function saveDiskCache(cache: TopCryptosCache): void {
  try {
    fs.mkdirSync(config.paths.data, { recursive: true });
    fs.writeFileSync(config.paths.topCryptosCache, JSON.stringify(cache, null, 2));
  } catch (e) {
    logger.warn(`topCryptos: failed to save disk cache: ${e}`);
  }
}

/**
 * Fetch the set of base-currency symbols that are actively traded on Coinbase Exchange
 * (covers the same assets as the Coinbase / BASE app consumer product).
 * Returns an empty Set on failure so callers can decide whether to filter or pass-through.
 */
async function fetchCoinbaseSymbols(): Promise<Set<string>> {
  try {
    const data = await fetchJson(COINBASE_PRODUCTS_URL) as CoinbaseProduct[];
    if (!Array.isArray(data)) {
      logger.warn('topCryptos: Coinbase products endpoint returned unexpected shape — skipping filter');
      return new Set();
    }
    const symbols = new Set<string>();
    for (const product of data) {
      if (
        typeof product.base_currency === 'string' &&
        product.status === 'online' &&
        // Only USD or USDT quote — these are the spot markets users can trade
        (product.quote_currency === 'USD' || product.quote_currency === 'USDT')
      ) {
        symbols.add(product.base_currency.toUpperCase());
      }
    }
    logger.info(`topCryptos: Coinbase filter loaded — ${symbols.size} tradeable base assets`);
    return symbols;
  } catch (err) {
    logger.warn(`topCryptos: Coinbase filter fetch failed — all top-20 pairs will be used: ${err}`);
    return new Set(); // empty = no filter applied
  }
}

async function fetchFromCoinGecko(): Promise<string[]> {
  // Pull top-40 from CoinGecko (we ask for more so filtering still yields ~20)
  const data = await fetchJson(COINGECKO_URL) as CoinGeckoMarket[];
  if (!Array.isArray(data)) {
    throw new Error(`CoinGecko returned unexpected data: ${typeof data}`);
  }

  // Build the full candidate list (validated, deduplicated, no stablecoins)
  const candidates: string[] = [];
  for (const coin of data) {
    const pair = coinToUsdtPair(coin);
    if (pair && pair !== 'USDT/USDT') {
      candidates.push(pair);
    }
  }

  // Apply Coinbase filter if enabled (default: true)
  const filterEnabled = (process.env.COINBASE_FILTER ?? 'true').toLowerCase() !== 'false';
  if (!filterEnabled) {
    logger.info('topCryptos: COINBASE_FILTER=false — using raw CoinGecko top-20');
    return candidates.slice(0, 20);
  }

  const coinbaseSymbols = await fetchCoinbaseSymbols();

  if (coinbaseSymbols.size === 0) {
    // Fetch failed — fall back to top-20 unfiltered so the bot keeps running
    logger.warn('topCryptos: Coinbase filter empty — using unfiltered CoinGecko top-20');
    return candidates.slice(0, 20);
  }

  // Keep only coins whose base symbol exists on Coinbase
  const filtered = candidates.filter((pair) => {
    const base = pair.split('/')[0];
    return coinbaseSymbols.has(base);
  });

  logger.info(
    `topCryptos: Coinbase filter applied — ${filtered.length}/${candidates.length} pairs pass ` +
    `(${candidates.filter(p => !coinbaseSymbols.has(p.split('/')[0])).map(p => p.split('/')[0]).join(', ')} excluded)`
  );

  // Return up to 20 Coinbase-available pairs
  return filtered.slice(0, 20);
}

export async function refreshTopCryptos(): Promise<void> {
  try {
    logger.info('topCryptos: refreshing from CoinGecko...');
    const pairs = await fetchFromCoinGecko();
    const cache: TopCryptosCache = { pairs, fetchedAt: Date.now() };
    memoryCache = cache;
    saveDiskCache(cache);
    logger.info(`topCryptos: refreshed — ${pairs.length} pairs: ${pairs.join(', ')}`);
  } catch (e) {
    logger.error(`topCryptos: refresh failed: ${e}`);
  }
}

export async function getTopCryptoPairs(): Promise<string[]> {
  // Check memory cache
  if (memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return memoryCache.pairs;
  }
  // Check disk cache
  const disk = loadDiskCache();
  if (disk && Date.now() - disk.fetchedAt < CACHE_TTL_MS) {
    memoryCache = disk;
    return disk.pairs;
  }
  // Fetch fresh
  try {
    const pairs = await fetchFromCoinGecko();
    const cache: TopCryptosCache = { pairs, fetchedAt: Date.now() };
    memoryCache = cache;
    saveDiskCache(cache);
    return pairs;
  } catch (e) {
    logger.error(`topCryptos: failed to fetch, using stale cache or defaults: ${e}`);
    if (disk) {
      memoryCache = disk;
      return disk.pairs;
    }
    // Fallback: top Coinbase-listed coins by approximate market cap (all tradeable on BASE app)
    return ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT',
            'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'SHIB/USDT', 'DOT/USDT',
            'LTC/USDT', 'BCH/USDT', 'UNI/USDT', 'ATOM/USDT', 'NEAR/USDT',
            'APT/USDT', 'OP/USDT', 'ARB/USDT', 'SUI/USDT', 'INJ/USDT'];
  }
}

export async function initializeTopCryptos(): Promise<void> {
  const pairs = await getTopCryptoPairs();
  logger.info(`topCryptos: initialized with ${pairs.length} pairs`);
  logger.info(`topCryptos: ${pairs.join(', ')}`);

  // Update config.trading.assets with top cryptos + fixed Yahoo assets
  const allAssets = [...pairs, ...YAHOO_ASSETS];
  config.trading.assets.length = 0;
  for (const a of allAssets) config.trading.assets.push(a);
  logger.info(`config.trading.assets updated: ${config.trading.assets.length} total assets`);
}
