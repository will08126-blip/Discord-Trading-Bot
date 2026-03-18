import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  discord: {
    token: requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('DISCORD_CLIENT_ID'),
    signalChannelId: requireEnv('SIGNAL_CHANNEL_ID'),
    summaryChannelId: optionalEnv('SUMMARY_CHANNEL_ID', process.env['SIGNAL_CHANNEL_ID'] ?? ''),
  },

  // Public spot market data — no API key required

  anthropic: {
    apiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
    model: 'claude-haiku-4-5-20251001',
  },

  trading: {
    assets: [
      'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'PEPE/USDT',
      'XAU/USD',  'XAG/USD',  'QQQ/USD',  'SPY/USD',
    ] as const,
    // No fixed capital — sizing is confidence-based (% of whatever you allocate)
    maxOpenPositions: Number(optionalEnv('MAX_OPEN_POSITIONS', '3')),
    maxDailyLoss: Number(optionalEnv('MAX_DAILY_LOSS', '150')),
    minScoreThreshold: Number(optionalEnv('MIN_SCORE_THRESHOLD', '60')),
    // Hard leverage caps per trade type — increased to match high-conviction style
    // where tight stops (0.3-0.5% for HYBRID) justify significant leverage.
    maxLeverageScalp:  Number(optionalEnv('MAX_LEVERAGE_SCALP',  '75')),
    maxLeverageHybrid: Number(optionalEnv('MAX_LEVERAGE_HYBRID', '50')),
    maxLeverageSwing:  Number(optionalEnv('MAX_LEVERAGE_SWING',  '25')),

    // Leverage-adjusted profit targets (fraction, e.g. 0.5 = 50% return on capital).
    //   earlyProfitAlertPct  – alert threshold; fires without closing the position
    //   targetReturnPct      – DISABLED (0): strategies now use 4H ATR-based TP targets
    //                          that project to real chart resistance/support levels.
    //                          Set to >0 via env var to re-enable the leverage-formula override.
    earlyProfitAlertPct: Number(optionalEnv('EARLY_PROFIT_ALERT_PCT', '0.25')),
    targetReturnPct:     Number(optionalEnv('TARGET_RETURN_PCT',      '0')),
  },

  engine: {
    scanIntervalMinutes: Number(optionalEnv('SCAN_INTERVAL_MINUTES', '5')),
    enabled: optionalEnv('ENABLED', 'true') === 'true',
    exchangeId: optionalEnv('EXCHANGE_ID', 'binance'),
    // Duplicate signal suppression window per strategy+asset+direction (ms)
    duplicateWindowMs: 30 * 60 * 1000,
    // Stale data thresholds per timeframe (ms) — 2× the candle size
    staleThresholds: {
      '4h': 2 * 4 * 60 * 60 * 1000,
      '15m': 2 * 15 * 60 * 1000,
      '5m': 2 * 5 * 60 * 1000,
      '1m': 2 * 1 * 60 * 1000,
    } as Record<string, number>,
  },

  paths: {
    data: path.join(process.cwd(), 'data'),
    tradesFile: path.join(process.cwd(), 'data', 'trades.json'),
    stateFile: path.join(process.cwd(), 'data', 'state.json'),
    logsDir: path.join(process.cwd(), 'logs'),
  },

  // Leverage tiers by score tier per trade type
  // Scalp:  SL < 0.3%  — tight stop justifies aggressive leverage
  // Hybrid: SL 0.3-1.5% — blended; high conviction setups warrant higher leverage
  // Swing:  SL > 1.5%  — wide stop, moderate leverage
  leverageTiers: {
    scalp:  { ELITE: 75, STRONG: 50, MEDIUM: 20, NO_TRADE: 0 },
    hybrid: { ELITE: 50, STRONG: 35, MEDIUM: 15, NO_TRADE: 0 },
    swing:  { ELITE: 25, STRONG: 15, MEDIUM: 7,  NO_TRADE: 0 },
  } as Record<string, Record<string, number>>,

  // Score tier boundaries
  scoreTiers: {
    ELITE: 80,
    STRONG: 60,
    MEDIUM: 40,
  },

  // Per-asset leverage caps — override trade-type tier maximums for lower-volatility instruments.
  // Crypto leverage tiers (scalp: 75, hybrid: 50, swing: 25) are not appropriate for gold/silver
  // or equity ETFs. These caps are applied on top of the normal tier calculation.
  assetLeverageCap: {
    'XAU/USD': 10,  // Gold: moderate leverage (wide ATR relative to % move)
    'XAG/USD': 10,  // Silver: same as gold
    'QQQ/USD': 5,   // Equity ETF: low leverage; not a crypto instrument
    'SPY/USD': 5,   // Equity ETF: same as QQQ
  } as Partial<Record<string, number>>,
} as const;

export type Config = typeof config;
