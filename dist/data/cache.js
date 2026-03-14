"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCached = getCached;
exports.setCache = setCache;
exports.clearCache = clearCache;
exports.isCacheFresh = isCacheFresh;
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const store = new Map();
function makeKey(asset, timeframe) {
    return `${asset}:${timeframe}`;
}
function getCached(asset, timeframe) {
    const entry = store.get(makeKey(asset, timeframe));
    if (!entry)
        return null;
    const staleThreshold = config_1.config.engine.staleThresholds[timeframe];
    const age = Date.now() - entry.fetchedAt;
    if (age > staleThreshold) {
        logger_1.logger.warn(`Cache stale for ${asset} ${timeframe} (age=${Math.round(age / 1000)}s)`);
        return null;
    }
    return entry.data;
}
function setCache(asset, timeframe, data) {
    store.set(makeKey(asset, timeframe), { data, fetchedAt: Date.now() });
}
function clearCache() {
    store.clear();
}
function isCacheFresh(asset, timeframe) {
    return getCached(asset, timeframe) !== null;
}
//# sourceMappingURL=cache.js.map