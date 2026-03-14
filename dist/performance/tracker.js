"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTrades = loadTrades;
exports.saveTrades = saveTrades;
exports.addTrade = addTrade;
exports.computeStats = computeStats;
exports.strategyWinRate = strategyWinRate;
exports.dailyPnl = dailyPnl;
exports.buildDailySummaryContext = buildDailySummaryContext;
exports.buildWeeklySummaryContext = buildWeeklySummaryContext;
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
// ─── Persistence ─────────────────────────────────────────────────────────────
function ensureDataDir() {
    if (!fs_1.default.existsSync(config_1.config.paths.data)) {
        fs_1.default.mkdirSync(config_1.config.paths.data, { recursive: true });
    }
}
function loadTrades() {
    ensureDataDir();
    if (!fs_1.default.existsSync(config_1.config.paths.tradesFile))
        return [];
    try {
        const raw = fs_1.default.readFileSync(config_1.config.paths.tradesFile, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        logger_1.logger.warn('Could not load trades.json, starting fresh');
        return [];
    }
}
function saveTrades(trades) {
    ensureDataDir();
    fs_1.default.writeFileSync(config_1.config.paths.tradesFile, JSON.stringify(trades, null, 2));
}
function addTrade(trade) {
    const trades = loadTrades();
    trades.push(trade);
    saveTrades(trades);
    logger_1.logger.info(`Trade closed: ${trade.signal.asset} ${trade.signal.direction} ` +
        `${trade.exitReason} P&L=${trade.pnlDollar >= 0 ? '+' : ''}$${trade.pnlDollar.toFixed(2)}`);
}
// ─── Stats computation ────────────────────────────────────────────────────────
function computeStats(trades) {
    const wins = trades.filter((t) => t.pnlDollar > 0);
    const losses = trades.filter((t) => t.pnlDollar <= 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnlDollar, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlDollar, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    const avgScore = trades.length > 0
        ? trades.reduce((s, t) => s + t.signal.score, 0) / trades.length
        : 0;
    // Per-strategy stats
    const byStrategy = {};
    for (const t of trades) {
        const s = t.signal.strategy;
        if (!byStrategy[s]) {
            byStrategy[s] = { totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgScore: 0 };
        }
        byStrategy[s].totalTrades++;
        if (t.pnlDollar > 0)
            byStrategy[s].wins++;
        else
            byStrategy[s].losses++;
        byStrategy[s].avgScore += t.signal.score;
    }
    for (const s of Object.keys(byStrategy)) {
        const st = byStrategy[s];
        st.winRate = st.totalTrades > 0 ? st.wins / st.totalTrades : 0;
        st.avgScore = st.totalTrades > 0 ? st.avgScore / st.totalTrades : 0;
    }
    // Per trade-type stats
    const byTradeType = {
        SCALP: { trades: 0, wins: 0, winRate: 0 },
        HYBRID: { trades: 0, wins: 0, winRate: 0 },
        SWING: { trades: 0, wins: 0, winRate: 0 },
    };
    for (const t of trades) {
        const tt = t.signal.tradeType ?? 'HYBRID';
        byTradeType[tt].trades++;
        if (t.pnlDollar > 0)
            byTradeType[tt].wins++;
    }
    for (const tt of Object.keys(byTradeType)) {
        const b = byTradeType[tt];
        b.winRate = b.trades > 0 ? b.wins / b.trades : 0;
    }
    return {
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: trades.length > 0 ? wins.length / trades.length : 0,
        avgScore,
        profitFactor,
        totalPnlDollar: grossProfit - grossLoss,
        byStrategy,
        byTradeType,
    };
}
/** Returns the win rate for a specific strategy over the last N trades */
function strategyWinRate(strategyName, lastN = 10) {
    const trades = loadTrades();
    const stratTrades = trades
        .filter((t) => t.signal.strategy === strategyName)
        .slice(-lastN);
    if (stratTrades.length === 0)
        return 0.5; // neutral default
    const wins = stratTrades.filter((t) => t.pnlDollar > 0).length;
    return wins / stratTrades.length;
}
/** P&L for current calendar day (UTC) */
function dailyPnl() {
    const today = new Date().toISOString().slice(0, 10);
    const trades = loadTrades();
    return trades
        .filter((t) => new Date(t.closedAt).toISOString().slice(0, 10) === today)
        .reduce((s, t) => s + t.pnlDollar, 0);
}
/**
 * Build a human-readable daily summary string for LLM consumption
 */
function buildDailySummaryContext() {
    const today = new Date().toISOString().slice(0, 10);
    const trades = loadTrades();
    const todayTrades = trades.filter((t) => new Date(t.closedAt).toISOString().slice(0, 10) === today);
    const stats = computeStats(todayTrades);
    const lines = [
        `Date: ${today}`,
        `Total trades: ${stats.totalTrades}`,
        `Wins: ${stats.wins} | Losses: ${stats.losses} | Win rate: ${(stats.winRate * 100).toFixed(1)}%`,
        `Total P&L: $${stats.totalPnlDollar.toFixed(2)}`,
        `Profit factor: ${stats.profitFactor.toFixed(2)}`,
        `Average setup score: ${stats.avgScore.toFixed(1)}`,
        '',
        'Trades:',
        ...todayTrades.map((t) => `  ${t.signal.asset} ${t.signal.direction} (${t.signal.strategy}) ` +
            `Score=${t.signal.score} Entry=${t.entryPrice.toFixed(2)} Exit=${t.exitPrice.toFixed(2)} ` +
            `P&L=$${t.pnlDollar.toFixed(2)} Reason=${t.exitReason}`),
    ];
    return lines.join('\n');
}
function buildWeeklySummaryContext() {
    const trades = loadTrades();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekTrades = trades.filter((t) => t.closedAt >= weekAgo);
    const stats = computeStats(weekTrades);
    const lines = [
        `Weekly summary (last 7 days)`,
        `Total trades: ${stats.totalTrades}`,
        `Wins: ${stats.wins} | Losses: ${stats.losses} | Win rate: ${(stats.winRate * 100).toFixed(1)}%`,
        `Total P&L: $${stats.totalPnlDollar.toFixed(2)}`,
        `Profit factor: ${stats.profitFactor.toFixed(2)}`,
        '',
        'Strategy breakdown:',
        ...Object.entries(stats.byStrategy).map(([name, s]) => `  ${name}: ${s.totalTrades} trades, ${(s.winRate * 100).toFixed(1)}% WR, avg score ${s.avgScore.toFixed(1)}`),
    ];
    return lines.join('\n');
}
//# sourceMappingURL=tracker.js.map