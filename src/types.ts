export type Asset = 'BTC/USDT:USDT' | 'ETH/USDT:USDT';
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
  entryZone: [number, number]; // [low, high]
  stopLoss: number;
  takeProfit: number;
  components: ScoreComponents;
  score: number;  // 0-100
  tier: ScoreTier;
  regime: Regime;
  timestamp: number;
  notes?: string;
}

export interface ActivePosition {
  id: string;
  signal: StrategySignal;
  entryPrice: number;
  suggestedSize: number;    // USDT notional
  suggestedLeverage: number;
  dollarRisk: number;
  confirmedAt: number;
  messageId: string;        // Discord message ID for updates
  channelId: string;
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
  consecutiveLosses: number;
  byStrategy: Record<string, StrategyStats>;
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
  dailyLossDate: string;    // YYYY-MM-DD
  consecutiveLosses: number;
  riskMultiplier: number;   // 0.25–1.0 based on adaptation
  recoveryTradesLeft: number;
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
