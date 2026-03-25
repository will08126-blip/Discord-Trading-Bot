import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * Claw Webhook Integration
 * 
 * Receives real-time data from the trading bot for monitoring,
 * analysis, and optimization suggestions.
 */

interface WebhookPayload {
  type: 'signal' | 'trade_closed' | 'daily_report' | 'position_update' | 'alert';
  timestamp: number;
  data: any;
}

interface SignalData {
  asset: string;
  direction: 'LONG' | 'SHORT';
  strategy: string;
  score: number;
  tier: string;
  tradeType: string;
  regime: string;
  entryZone: [number, number];
  stopLoss: number;
  takeProfit: number;
}

interface TradeClosedData {
  id: string;
  signal: SignalData;
  entryPrice: number;
  exitPrice: number;
  pnlDollar: number;
  pnlPct: number;
  exitReason: string;
  closedAt: number;
  holdTimeMinutes: number;
}

interface DailyReportData {
  date: string;
  balanceStart: number;
  balanceEnd: number;
  dayPnL: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  strategyBreakdown: Record<string, any>;
  assetBreakdown: Record<string, any>;
  observations: string[];
}

// In-memory storage for recent data (last 100 signals, 50 trades)
const recentSignals: SignalData[] = [];
const recentTrades: TradeClosedData[] = [];
let lastReport: DailyReportData | null = null;

/**
 * Express middleware/handler for webhook endpoint
 */
export function webhookHandler(req: Request, res: Response): void {
  // Verify webhook secret if configured
  const secret = req.headers['x-claw-secret'];
  if (config.claw?.webhookSecret && secret !== config.claw.webhookSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = req.body as WebhookPayload;

  if (!payload.type || !payload.data) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  try {
    switch (payload.type) {
      case 'signal':
        handleSignal(payload.data as SignalData);
        break;
      case 'trade_closed':
        handleTradeClosed(payload.data as TradeClosedData);
        break;
      case 'daily_report':
        handleDailyReport(payload.data as DailyReportData);
        break;
      case 'position_update':
        handlePositionUpdate(payload.data);
        break;
      case 'alert':
        handleAlert(payload.data);
        break;
      default:
        logger.warn(`[Webhook] Unknown payload type: ${payload.type}`);
    }

    res.status(200).json({ received: true, type: payload.type });
  } catch (error) {
    logger.error('[Webhook] Error processing payload:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
}

function handleSignal(signal: SignalData): void {
  recentSignals.push(signal);
  if (recentSignals.length > 100) {
    recentSignals.shift();
  }

  // Real-time analysis
  if (signal.score < 60) {
    logger.info(`[Claw] Low score signal detected: ${signal.asset} ${signal.direction} (score: ${signal.score})`);
  }

  if (signal.strategy === 'Scalp FVG' && signal.score < 70) {
    logger.warn(`[Claw] Low scalp score — consider raising minScoreScalp threshold`);
  }
}

function handleTradeClosed(trade: TradeClosedData): void {
  recentTrades.push(trade);
  if (recentTrades.length > 50) {
    recentTrades.shift();
  }

  // Analyze trade immediately
  const isWin = trade.pnlDollar > 0;
  const holdTime = trade.holdTimeMinutes;

  // Pattern detection
  if (!isWin && trade.signal.score > 75) {
    logger.warn(`[Claw] High-score signal (${trade.signal.score}) lost money — score threshold may not be predictive`);
  }

  if (isWin && holdTime < 10) {
    logger.info(`[Claw] Quick win (${holdTime}min) — good momentum capture`);
  }

  if (!isWin && holdTime < 5) {
    logger.warn(`[Claw] Quick loss (${holdTime}min) — SL too tight or entries too aggressive`);
  }

  // Check for consecutive losses
  const recentLosses = recentTrades.slice(-5).filter(t => t.pnlDollar <= 0).length;
  if (recentLosses >= 4) {
    logger.error(`[Claw] ALERT: 4 of last 5 trades were losses — consider pausing new signals`);
  }
}

function handleDailyReport(report: DailyReportData): void {
  lastReport = report;

  logger.info(`[Claw] Daily report received: ${report.totalTrades} trades, ${(report.winRate * 100).toFixed(1)}% WR`);

  // Critical alerts
  if (report.winRate < 0.30) {
    logger.error(`[Claw] CRITICAL: Win rate ${(report.winRate * 100).toFixed(1)}% — well below target. Run /optimize immediately!`);
  }

  if (report.profitFactor < 0.5) {
    logger.error(`[Claw] CRITICAL: Profit factor ${report.profitFactor.toFixed(2)} — losing day. Check thresholds.`);
  }

  if (report.dayPnL < -300) {
    logger.error(`[Claw] ALERT: Large daily loss $${report.dayPnL.toFixed(2)} — daily loss limit may need review`);
  }

  // Strategy-specific issues
  for (const [strategy, stats] of Object.entries(report.strategyBreakdown || {})) {
    if (stats.trades >= 5 && stats.winRate < 0.30) {
      logger.warn(`[Claw] Underperforming strategy: ${strategy} at ${(stats.winRate * 100).toFixed(0)}% WR`);
    }
  }

  // Asset-specific issues
  for (const [asset, stats] of Object.entries(report.assetBreakdown || {})) {
    if (stats.trades >= 3 && stats.winRate === 0) {
      logger.warn(`[Claw] Zero win rate asset: ${asset} — consider reducing weight`);
    }
  }

  // Auto-trigger optimization suggestion
  if (report.winRate < 0.40 && report.totalTrades >= 20) {
    logger.info(`[Claw] SUGGESTION: Run /optimize mode:dry days:1 — performance below target`);
  }
}

function handlePositionUpdate(data: any): void {
  logger.debug('[Claw] Position update received:', data);
}

function handleAlert(data: any): void {
  logger.info('[Claw] Alert received:', data.message);
}

/**
 * Get current monitoring data
 */
export function getMonitoringData(): {
  recentSignals: SignalData[];
  recentTrades: TradeClosedData[];
  lastReport: DailyReportData | null;
  stats: {
    totalSignals: number;
    totalTrades: number;
    recentWinRate: number;
    avgHoldTime: number;
  };
} {
  const recentWins = recentTrades.filter(t => t.pnlDollar > 0).length;
  const avgHold = recentTrades.length > 0
    ? recentTrades.reduce((sum, t) => sum + t.holdTimeMinutes, 0) / recentTrades.length
    : 0;

  return {
    recentSignals: [...recentSignals],
    recentTrades: [...recentTrades],
    lastReport,
    stats: {
      totalSignals: recentSignals.length,
      totalTrades: recentTrades.length,
      recentWinRate: recentTrades.length > 0 ? recentWins / recentTrades.length : 0,
      avgHoldTime: avgHold,
    },
  };
}

/**
 * Reset monitoring data
 */
export function resetMonitoringData(): void {
  recentSignals.length = 0;
  recentTrades.length = 0;
  lastReport = null;
  logger.info('[Claw] Monitoring data reset');
}
