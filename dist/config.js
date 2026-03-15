"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
function requireEnv(key) {
    const value = process.env[key];
    if (!value)
        throw new Error(`Missing required environment variable: ${key}`);
    return value;
}
function optionalEnv(key, fallback) {
    return process.env[key] ?? fallback;
}
exports.config = {
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
        assets: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'PEPE/USDT'],
        // No fixed capital — sizing is confidence-based (% of whatever you allocate)
        maxOpenPositions: Number(optionalEnv('MAX_OPEN_POSITIONS', '3')),
        maxDailyLoss: Number(optionalEnv('MAX_DAILY_LOSS', '150')),
        minScoreThreshold: Number(optionalEnv('MIN_SCORE_THRESHOLD', '60')),
        // Hard leverage caps per trade type
        maxLeverageScalp: Number(optionalEnv('MAX_LEVERAGE_SCALP', '50')),
        maxLeverageHybrid: Number(optionalEnv('MAX_LEVERAGE_HYBRID', '30')),
        maxLeverageSwing: Number(optionalEnv('MAX_LEVERAGE_SWING', '20')),
        // Leverage-adjusted profit targets (fraction, e.g. 0.5 = 50% return on capital).
        // With 25x leverage a 2% price move = 50% capital return, 4% move = 100% return.
        //   earlyProfitAlertPct  – alert threshold; fires without closing the position
        //   targetReturnPct      – sets the actual TP price on each confirmed position
        // Set to 0 to disable the respective feature.
        earlyProfitAlertPct: Number(optionalEnv('EARLY_PROFIT_ALERT_PCT', '0.25')),
        targetReturnPct: Number(optionalEnv('TARGET_RETURN_PCT', '1.0')),
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
        },
    },
    paths: {
        data: path_1.default.join(process.cwd(), 'data'),
        tradesFile: path_1.default.join(process.cwd(), 'data', 'trades.json'),
        stateFile: path_1.default.join(process.cwd(), 'data', 'state.json'),
        logsDir: path_1.default.join(process.cwd(), 'logs'),
    },
    // Leverage tiers by score tier per trade type
    // Scalp:  SL < 0.3%  — tight stop justifies high leverage
    // Hybrid: SL 0.3-1.5% — blended approach, medium leverage
    // Swing:  SL > 1.5%  — wide stop, lower leverage
    leverageTiers: {
        scalp: { ELITE: 50, STRONG: 30, MEDIUM: 15, NO_TRADE: 0 },
        hybrid: { ELITE: 30, STRONG: 20, MEDIUM: 10, NO_TRADE: 0 },
        swing: { ELITE: 20, STRONG: 10, MEDIUM: 5, NO_TRADE: 0 },
    },
    // Score tier boundaries
    scoreTiers: {
        ELITE: 80,
        STRONG: 60,
        MEDIUM: 40,
    },
};
//# sourceMappingURL=config.js.map