# Claw Webhook Integration Setup

Connect your Discord Trading Bot to Claw for real-time monitoring and AI-powered optimization.

## What This Does

- **Real-time monitoring**: Claw sees every signal, trade, and report instantly
- **Pattern detection**: Identifies issues (low win rate, bad score thresholds, etc.)
- **Auto-alerts**: Warns you when performance drops or patterns emerge
- **Optimization suggestions**: Recommends when to run `/optimize`

## Setup Steps

### 1. Configure Environment Variables

Add to your `.env` file:

```env
# Claw Webhook Integration
CLAW_WEBHOOK_ENABLED=true
CLAW_WEBHOOK_ENDPOINT=https://your-claw-instance.com/webhook
CLAW_WEBHOOK_SECRET=your-secret-key-here
```

**Note:** If Claw is running on the same machine, use `http://localhost:3000/webhook` or your actual OpenClaw gateway URL.

### 2. Import and Use in Your Bot Code

**In `src/engine.ts` where signals are posted:**

```typescript
import { notifySignal } from './claw/sender';

// When posting a signal:
await postSignal(signal);
await notifySignal(signal); // Add this line
```

**In `src/signals/signalManager.ts` when trades close:**

```typescript
import { notifyTradeClosed } from '../claw/sender';

// When a trade closes:
const trade = handleSLTPHit(update);
if (trade) {
  await notifyTradeClosed(trade); // Add this line
}
```

**In `src/paper/dailyReport.ts` when generating daily report:**

```typescript
import { notifyDailyReport } from '../claw/sender';

// After building report:
await postDailyPaperReport(channel, date);
await notifyDailyReport(reportData); // Add this line
```

### 3. Test the Connection

Run this in your bot:

```typescript
import { testWebhook } from './claw/sender';

const connected = await testWebhook();
console.log(connected ? '✅ Claw connected' : '❌ Connection failed');
```

### 4. Verify in Claw

You should see logs like:
```
[Claw] Signal received: BTC LONG (score: 78)
[Claw] Trade closed: +$45.20 (hold time: 23min)
[Claw] Daily report received: 12 trades, 58.3% WR
```

## What Claw Monitors

### Automatic Alerts
- **Win rate drops below 30%**: "CRITICAL: Performance below target"
- **4+ losses in a row**: "Consider pausing new signals"
- **High score (75+) loses money**: "Score threshold not predictive"
- **Daily loss > $300**: "Large loss day - check limits"
- **Strategy under 30% WR**: "Underperforming strategy detected"
- **Asset with 0% WR (3+ trades)**: "Zero win rate asset - reduce weight"

### Smart Suggestions
- Auto-suggests running `/optimize` when performance drops
- Flags quick losses (SL too tight)
- Identifies overperforming/underperforming assets
- Tracks hold times vs win rate

## Troubleshooting

### Webhook not sending?
- Check `CLAW_WEBHOOK_ENABLED=true`
- Verify endpoint URL is correct
- Check firewall/network access

### Connection timeouts?
- Increase timeout in `sender.ts` (default 5s)
- Check Claw instance is running

### Missing data?
- Ensure imports are added in all relevant files
- Check logs for errors

## Security

- Use `CLAW_WEBHOOK_SECRET` to verify requests
- Keep endpoint URL private
- Webhook fails silently - never blocks trading

## Next Steps

Once connected:
1. Watch for Claw alerts in your logs
2. Run `/optimize mode:dry` when suggested
3. Review PRs created by the optimizer
4. Merge optimizations that improve performance
