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

  anthropic: {
    apiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
    model: 'claude-haiku-4-5-20251001',
  },

  trading: {
    assets: [
      'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'PEPE/USDT',
      'XAU/USD',  'XAG/USD',  'QQQ/USD',  'SPY/USD',
    ] as const,
    maxOpenPositions: Number(optionalEnv('MAX_OPEN_POSITIONS', '3')),
    maxDailyLoss: Number(optionalEnv('MAX_DAILY_LOSS', '150')),
    minScoreThreshold: Number(optionalEnv('MIN_SCORE_THRESHOLD', '60')),
    maxLeverageScalp:  Number(optionalEnv('MAX_LEVERAGE_SCALP',  '75')),
    maxLeverageHybrid: Number(optionalEnv('MAX_LEVERAGE_HYBRID', '50')),
    maxLeverageSwing:  Number(optionalEnv('MAX_LEVERAGE_SWING',  '10')),
    earlyProfitAlertPct: Number(optionalEnv('EARLY_PROFIT_ALERT_PCT', '0.25')),
    targetReturnPct:     Number(optionalEnv('TARGET_RETURN_PCT',      '0')),
  },

  engine: {
    scanIntervalMinutes: Number(optionalEnv('SCAN_INTERVAL_MINUTES', '5')),
    enabled: optionalEnv('ENABLED', 'true') === 'true',
    exchangeId: optionalEnv('EXCHANGE_ID', 'binance'),
    duplicateWindowMs: 30 * 60 * 1000,
    staleThresholds: {
      '1w':  2 * 7 * 24 * 60 * 60 * 1000,
      '1d':  2 * 24 * 60 * 60 * 1000,
      '4h':  2 * 4 * 60 * 60 * 1000,
      '15m': 2 * 15 * 60 * 1000,
      '5m':  2 * 5 * 60 * 1000,
      '1m':  2 * 1 * 60 * 1000,
    } as Record<string, number>,
  },

  paths: {
    data: path.join(process.cwd(), 'data'),
    tradesFile: path.join(process.cwd(), 'data', 'trades.json'),
    stateFile: path.join(process.cwd(), 'data', 'state.json'),
    logsDir: path.join(process.cwd(), 'logs'),
  },

  // SWING leverage is DYNAMIC (3% risk cap / stopPct, max 10x).
  // These tier values are HARD CAPS applied on top of the dynamic calculation.
  leverageTiers: {
    scalp:  { ELITE: 75, STRONG: 50, MEDIUM: 20, NO_TRADE: 0 },
    hybrid: { ELITE: 50, STRONG: 35, MEDIUM: 15, NO_TRADE: 0 },
    swing:  { ELITE: 10, STRONG: 7,  MEDIUM: 5,  NO_TRADE: 0 },
  } as Record<string, Record<string, number>>,

  scoreTiers: {
    ELITE: 80,
    STRONG: 60,
    MEDIUM: 40,
  },

  assetLeverageCap: {
    'XAU/USD': 10,
    'XAG/USD': 10,
    'QQQ/USD': 5,
    'SPY/USD': 5,
  } as Partial<Record<string, number>>,
} as const;

export type Config = typeof config;
