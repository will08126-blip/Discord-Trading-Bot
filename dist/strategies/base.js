"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseStrategy = void 0;
class BaseStrategy {
    isRegimeSupported(regime) {
        return this.supportedRegimes.includes(regime);
    }
    zeroComponents() {
        return {
            htfAlignment: 0,
            setupQuality: 0,
            momentum: 0,
            volatilityQuality: 0,
            regimeFit: 0,
            liquidity: 0,
            slippageRisk: 0,
            sessionQuality: 0,
            recentPerformance: 0,
        };
    }
    totalScore(c) {
        return (c.htfAlignment +
            c.setupQuality +
            c.momentum +
            c.volatilityQuality +
            c.regimeFit +
            c.liquidity +
            c.slippageRisk +
            c.sessionQuality +
            c.recentPerformance);
    }
}
exports.BaseStrategy = BaseStrategy;
//# sourceMappingURL=base.js.map