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
    summaryChannelId: requireEnv('SUMMARY_CHANNEL_ID'),
  },

  // Binance public API — no key required for OHLCV market data

  anthropic: {
    apiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
    model: 'claude-haiku-4-5-20251001',
  },

  trading: {
    assets: ['BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT', 'XRP/USDT:USDT', 'PEPE/USDT:USDT'] as const,
    // No fixed capital — sizing is confidence-based (% of whatever you allocate)
    maxOpenPositions: Number(optionalEnv('MAX_OPEN_POSITIONS', '3')),
    maxDailyLoss: Number(optionalEnv('MAX_DAILY_LOSS', '150')),
    minScoreThreshold: Number(optionalEnv('MIN_SCORE_THRESHOLD', '60')),
    // Hard leverage caps — scalp trades can go higher because SL is tight
    maxLeverageScalp: Number(optionalEnv('MAX_LEVERAGE_SCALP', '50')),
    maxLeverageSwing: Number(optionalEnv('MAX_LEVERAGE_SWING', '20')),
  },

  engine: {
    scanIntervalMinutes: Number(optionalEnv('SCAN_INTERVAL_MINUTES', '5')),
    enabled: optionalEnv('ENABLED', 'true') === 'true',
    exchangeId: optionalEnv('EXCHANGE_ID', 'bybit'),
    // Duplicate signal suppression window (ms)
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

  // Leverage tiers: [SCALP leverage, SWING leverage] by score tier
  // Scalp trades: tight SL on 5m/1m — high leverage is justified
  // Swing trades: wide SL on 15m/4h — moderate leverage to manage risk
  leverageTiers: {
    scalp: { ELITE: 50, STRONG: 30, MEDIUM: 15, NO_TRADE: 0 },
    swing: { ELITE: 20, STRONG: 10, MEDIUM: 5,  NO_TRADE: 0 },
  } as Record<string, Record<string, number>>,

  // Score tier boundaries
  scoreTiers: {
    ELITE: 80,
    STRONG: 60,
    MEDIUM: 40,
  },
} as const;

export type Config = typeof config;
