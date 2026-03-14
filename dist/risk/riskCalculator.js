"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDeploymentScore = calculateDeploymentScore;
exports.classifyTradeType = classifyTradeType;
exports.calculateRisk = calculateRisk;
exports.formatPrice = formatPrice;
exports.formatPct = formatPct;
const config_1 = require("../config");
/**
 * Confidence-based risk percentages — no fixed capital required.
 * User scales these to whatever they're working with that week.
 *
 * Scalp trades get slightly higher allocation because the leverage
 * is higher and stops are tighter, so the % risk stays manageable.
 */
const RISK_PCT = {
    scalp: { ELITE: 2.0, STRONG: 1.5, MEDIUM: 1.0, NO_TRADE: 0 },
    hybrid: { ELITE: 2.0, STRONG: 1.5, MEDIUM: 1.0, NO_TRADE: 0 },
    swing: { ELITE: 2.0, STRONG: 1.5, MEDIUM: 1.0, NO_TRADE: 0 },
};
function leverageCap(tier, tradeType) {
    const typeKey = tradeType === 'SCALP' ? 'scalp' : tradeType === 'HYBRID' ? 'hybrid' : 'swing';
    const tiers = config_1.config.leverageTiers[typeKey];
    const byTier = tiers[tier] ?? 5;
    const hardCap = tradeType === 'SCALP'
        ? config_1.config.trading.maxLeverageScalp
        : tradeType === 'HYBRID'
            ? config_1.config.trading.maxLeverageHybrid
            : config_1.config.trading.maxLeverageSwing;
    return Math.min(byTier, hardCap);
}
/**
 * Deployment confidence score (0-100).
 * Measures how favourable the *environment* is to deploy capital right now,
 * based on HTF alignment, momentum, volatility, regime, liquidity and session.
 * Intentionally excludes setupQuality/slippageRisk/recentPerformance — those
 * measure pattern quality (already captured in signal.score).
 */
function calculateDeploymentScore(signal) {
    const c = signal.components;
    const raw = c.htfAlignment + // 0-20
        c.momentum + // 0-15
        c.volatilityQuality + // 0-10
        c.regimeFit + // 0-10
        c.liquidity + // 0-10
        c.sessionQuality; // 0-5
    // Max possible = 70; normalise to 0-100
    return Math.round((raw / 70) * 100);
}
function classifyTradeType(signal) {
    const entry = (signal.entryZone[0] + signal.entryZone[1]) / 2;
    const stopPct = Math.abs(entry - signal.stopLoss) / entry;
    if (stopPct < 0.003)
        return 'SCALP';
    if (stopPct < 0.015)
        return 'HYBRID';
    return 'SWING';
}
function calculateRisk(signal) {
    const entryPrice = (signal.entryZone[0] + signal.entryZone[1]) / 2;
    const stopDistance = Math.abs(entryPrice - signal.stopLoss);
    const stopDistancePct = entryPrice > 0 ? stopDistance / entryPrice : 0;
    const rewardDistance = Math.abs(signal.takeProfit - entryPrice);
    const rewardRiskRatio = stopDistance > 0 ? rewardDistance / stopDistance : 0;
    const tradeType = signal.tradeType ?? classifyTradeType(signal);
    const typeKey = tradeType === 'SCALP' ? 'scalp' : tradeType === 'HYBRID' ? 'hybrid' : 'swing';
    // Confidence-based risk %
    const riskPct = RISK_PCT[typeKey][signal.tier] ?? 1.0;
    // Leverage: based on how much notional you need vs capital to achieve riskPct
    // At riskPct% risk with stopDistancePct% stop:
    //   positionSize = capital * riskPct% / stopDistancePct%
    //   leverage     = positionSize / capital = riskPct / stopDistancePct
    const impliedLeverage = stopDistancePct > 0 ? riskPct / 100 / stopDistancePct : 1;
    const maxLev = leverageCap(signal.tier, tradeType);
    const suggestedLeverage = Math.max(1, Math.min(maxLev, Math.ceil(impliedLeverage)));
    const deploymentScore = calculateDeploymentScore(signal);
    return {
        entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        stopDistancePct,
        rewardRiskRatio,
        suggestedLeverage,
        riskPct,
        tradeType,
        deploymentScore,
    };
}
function formatPrice(price, asset) {
    let decimals;
    if (asset.startsWith('BTC')) {
        decimals = 0;
    }
    else if (price < 0.0001) {
        decimals = 8; // micro-caps like PEPE (~0.000012)
    }
    else if (price < 1) {
        decimals = 5; // sub-dollar assets
    }
    else {
        decimals = 2; // standard (ETH, SOL, XRP)
    }
    return `$${price.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    })}`;
}
function formatPct(pct) {
    return `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(2)}%`;
}
//# sourceMappingURL=riskCalculator.js.map