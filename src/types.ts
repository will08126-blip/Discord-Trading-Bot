export type Asset =
  | 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT' | 'XRP/USDT' | 'PEPE/USDT'
  | 'XAU/USD'  | 'XAG/USD'  | 'QQQ/USD'  | 'SPY/USD';
export type Timeframe = '1w' | '1d' | '4h' | '15m' | '5m' | '1m';
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
 * SCALP  → SL < 0.3%, 5m/1m entry, hold < 1h,    high leverage (up to 75x)
 * HYBRID → SL 0.3-1.5%, 5m/15m, hold 1-4h,        medium leverage (up to 50x)
 * SWING  → SL 0.3-4%, 4h/Daily, hold 24-72 hours,  dynamic leverage (3% risk cap / stopPct, max 10x)
 *           Requires Weekly + Daily + 4h structural confluence.
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
  '1w': OHLCV[];   // Weekly — HTF structural bias
  '1d': OHLCV[];   // Daily  — primary swing anchor
  '4h': OHLCV[];
  '15m': OHLCV[];
  '5m': OHLCV[];
  '1m'?: OHLCV[];
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
  swingMeta?: SwingMeta;  // populated only for SWING trade type
}

export interface ActivePosition {
  id: string;
  signal: StrategySignal;
  entryPrice: number;
  suggestedLeverage: number;
  riskPct: number;
  confirmedAt: number;
  messageId: string;
  channelId: string;
  currentStopLoss: number;
  currentTakeProfit: number;
  highestPrice: number;
  lowestPrice: number;
  lastSLTPUpdateAt: number;
  tpExtensionCount: number;
  exitAlertSent: boolean;
  firedMilestones?: number[];
  /** @deprecated */
  lastProfitMilestonePct?: number;
  slProximityAlertAt?: number;
  lastHealthUpdatePrice?: number;
  lastHealthUpdateAt?: number;
}

export interface ClosedTrade extends ActivePosition {
  exitPrice: number;
  closedAt: number;
  pnlPct: number;
  pnlDollar: number;
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
  dailyLossDate: string;
  strategyWeights: Record<string, number>;
  minScoreThreshold?: number;
}

export interface RegimeResult {
  asset: Asset;
  regime: Regime;
  adx: number;
  atrRatio: number;
  emaAligned: boolean;
  timestamp: number;
}

// ─── Swing trade types ────────────────────────────────────────────────────────

export type StructuralBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type SwingBiasConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Result of top-down market structure analysis across Weekly, Daily, 4h.
 * HIGH   = all 3 agree on HH/HL or LH/LL structure.
 * MEDIUM = Daily + 4h agree (Weekly neutral/insufficient data).
 * LOW    = no tradeable confluence — no swing signal fires.
 */
export interface SwingBias {
  direction: 'LONG' | 'SHORT' | null;
  confidence: SwingBiasConfidence;
  weeklyBias: StructuralBias;
  dailyBias: StructuralBias;
  fourHourBias: StructuralBias;
  agreementCount: number;
  notes: string;
}

/** A zone where multiple value criteria converge */
export interface AreaOfValue {
  priceHigh: number;
  priceLow: number;
  midpoint: number;
  confluenceScore: number;       // 0–4, one point per criterion met
  hasStructure: boolean;
  hasEmaConfluence: boolean;
  hasFibLevel: boolean;
  hasVolumeNode: boolean;
  nearestFibPct: number | null;
  notes: string;
}

export type SwingTrigger = 'DISPLACEMENT' | 'RSI_DIVERGENCE' | 'LIQUIDITY_SWEEP';

/** Swing-specific metadata attached to a StrategySignal */
export interface SwingMeta {
  bias: SwingBias;
  zone: AreaOfValue;
  trigger: SwingTrigger;
  triggerQuality: number;        // 0–15
  stopSwingPoint: number;
  primaryTP: number;
  extendedTP: number | null;
  rr: number;
  suggestedLeverage: number;     // dynamic: 3% risk cap / stopPct, hard cap 10x
  capitalAtRiskPct: number;      // stopPct × leverage (always ≤ 0.03)
}
