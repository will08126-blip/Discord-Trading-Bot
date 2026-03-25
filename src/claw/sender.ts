import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * Claw Webhook Sender
 * 
 * Sends real-time trading data to Claw for monitoring and analysis.
 * Add this to your trading bot to enable Claw integration.
 */

interface WebhookConfig {
  enabled: boolean;
  endpoint: string;
  secret?: string;
  timeoutMs: number;
}

// Default config - update in your config.ts or .env
const defaultConfig: WebhookConfig = {
  enabled: process.env.CLAW_WEBHOOK_ENABLED === 'true',
  endpoint: process.env.CLAW_WEBHOOK_ENDPOINT || '',
  secret: process.env.CLAW_WEBHOOK_SECRET,
  timeoutMs: 5000,
};

/**
 * Send payload to Claw webhook
 */
async function sendWebhook(type: string, data: any): Promise<boolean> {
  if (!defaultConfig.enabled || !defaultConfig.endpoint) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), defaultConfig.timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (defaultConfig.secret) {
      headers['x-claw-secret'] = defaultConfig.secret;
    }

    const response = await fetch(defaultConfig.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type,
        timestamp: Date.now(),
        data,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(`[Claw Webhook] Failed: ${response.status} ${await response.text()}`);
      return false;
    }

    return true;
  } catch (error) {
    // Silently fail - don't block trading on webhook errors
    return false;
  }
}

/**
 * Send signal to Claw
 */
export async function notifySignal(signal: any): Promise<void> {
  await sendWebhook('signal', {
    asset: signal.asset,
    direction: signal.direction,
    strategy: signal.strategy,
    score: signal.score,
    tier: signal.tier,
    tradeType: signal.tradeType,
    regime: signal.regime,
    entryZone: signal.entryZone,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
  });
}

/**
 * Send closed trade to Claw
 */
export async function notifyTradeClosed(trade: any): Promise<void> {
  const holdTimeMinutes = Math.round((trade.closedAt - trade.enteredAt) / (60 * 1000));

  await sendWebhook('trade_closed', {
    id: trade.id,
    signal: trade.signal,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    pnlDollar: trade.pnlDollar,
    pnlPct: trade.pnlPct,
    exitReason: trade.exitReason,
    closedAt: trade.closedAt,
    holdTimeMinutes,
  });
}

/**
 * Send daily report to Claw
 */
export async function notifyDailyReport(report: any): Promise<void> {
  await sendWebhook('daily_report', report);
}

/**
 * Send position update to Claw
 */
export async function notifyPositionUpdate(position: any, update: any): Promise<void> {
  await sendWebhook('position_update', {
    positionId: position.id,
    currentPrice: update.currentPrice,
    unrealizedPnL: update.unrealizedPnL,
    trailingStop: update.trailingStop,
    takeProfit: update.takeProfit,
  });
}

/**
 * Send alert to Claw
 */
export async function notifyAlert(message: string, severity: 'info' | 'warn' | 'error' = 'info'): Promise<void> {
  await sendWebhook('alert', {
    message,
    severity,
    timestamp: Date.now(),
  });
}

/**
 * Test webhook connection
 */
export async function testWebhook(): Promise<boolean> {
  return await sendWebhook('alert', {
    message: 'Webhook test - Claw integration active',
    severity: 'info',
    test: true,
  });
}
