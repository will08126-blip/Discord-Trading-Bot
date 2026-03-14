export type Asset = 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT' | 'XRP/USDT' | 'PEPE/USDT';
export type Timeframe = '4h' | '15m' | '5m' | '1m';
export type Direction = 'LONG' | 'SHORT';
export type Regime =
  | 'TREND_UP'
  | 'TREND_DOWN'
  | 'RANGE'
  | 'VOL_EXPANSION'
  | 'LOW_VOL_COMPRESSION'
  | 'POOR';
export type ScoreTier = 'NO_TRADE' | 'MEDIUM' | 'STRONG' | 'ELITE';
export type ExitReason = 'TP' | 'SL' | 'MANUAL' | 'CONDITION_CHANGE';

/**
 * SCALP  → SL < 0.3%, 5m/1m entry, hold < 1h,   high leverage (up to 50x)
 * HYBRID → SL 0.3-1.5%, 5m/15m, hold 1-4h,       medium leverage (up to 30x)
 * SWING  → SL > 1.5%, 15m/4h,  hold 4-24h,        lower leverage (up to 20x)
 */
export type TradeType = 'SCALP' | 'HYBRID' | 'SWING';

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MultiTimeframeData {
  asset: Asset;
  '4h': OHLCV[];
  '15m': OHLCV[];
  '5m': OHLCV[];
  '1m': OHLCV[];
}

export interface ScoreComponents {
  htfAlignment: number;       // 0-20: higher timeframe trend alignment
  setupQuality: number;       // 0-20: quality of the pattern/setup
  momentum: number;           // 0-15: momentum confirmation
  volatilityQuality: number;  // 0-10: volatility is favourable for the setup
  regimeFit: number;          // 0-10: strategy fits the current regime
  liquidity: number;          // 0-10: sufficient volume/liquidity
  slippageRisk: number;       // 0-5:  low spread/slippage risk
  sessionQuality: number;     // 0-5:  good trading session (London/NY)
  recentPerformance: number;  // 0-5:  strategy recent win-rate contribution
}

export interface StrategySignal {
  id: string;
  strategy: string;
  asset: Asset;
  direction: Direction;
  tradeType: TradeType;
  entryZone: [number, number]; // [low, high]
  stopLoss: number;
  takeProfit: number;
  components: ScoreComponents;
  score: number;   // 0-100
  tier: ScoreTier;
  regime: Regime;
  timestamp: number;
  notes?: string;
}

export interface ActivePosition {
  id: string;
  signal: StrategySignal;
  entryPrice: number;
  suggestedLeverage: number;
  riskPct: number;             // % of capital to risk (confidence-based)
  confirmedAt: number;
  messageId: string;           // Discord message ID for edits
  channelId: string;
  // Dynamic TP tracking
  currentStopLoss: number;     // original SL — kept for R-multiple calc, not monitored
  currentTakeProfit: number;   // may extend from original
  highestPrice: number;        // for long TP extension tracking (peak since entry)
  lowestPrice: number;         // for short TP extension tracking (trough since entry)
  lastSLTPUpdateAt: number;    // timestamp of last adjustment
  tpExtensionCount: number;    // momentum-based TP extensions used (max 2)
  exitAlertSent: boolean;
}

export interface ClosedTrade extends ActivePosition {
  exitPrice: number;
  closedAt: number;
  pnlPct: number;           // % from entry
  pnlDollar: number;        // estimated USD P&L on suggested size
  exitReason: ExitReason;
}

export interface PerformanceStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgScore: number;
  profitFactor: number;
  totalPnlDollar: number;
  byStrategy: Record<string, StrategyStats>;
  byTradeType: Record<string, { trades: number; wins: number; winRate: number }>;
}

export interface StrategyStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgScore: number;
}

export interface BotState {
  enabled: boolean;
  dailyLoss: number;
  dailyLossDate: string;         // YYYY-MM-DD
  strategyWeights: Record<string, number>; // 0.5–1.0
}

export interface RegimeResult {
  asset: Asset;
  regime: Regime;
  adx: number;
  atrRatio: number;        // current ATR / ATR average
  emaAligned: boolean;
  timestamp: number;
}
