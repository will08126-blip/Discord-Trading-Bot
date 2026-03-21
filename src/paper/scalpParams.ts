/**
 * Adaptive Scalp Parameter Store
 *
 * Reads/writes `data/scalp_params.json` — a live-editable file that lets the
 * bot (and the auto-adjuster) tune scalp behaviour without a redeploy.
 *
 * The bot reads these params at the start of every scan cycle.  The
 * auto-adjuster (run weekly) writes updated values.  You can also edit the
 * JSON directly to override anything.
 *
 * Parameter philosophy: START aggressive, let the 7-day analysis narrow in.
 * - Low min score   → more trades → more data → faster learning
 * - High leverage   → bigger moves captured → PF compounds quicker
 * - All regimes     → don't pre-filter, learn which regimes work
 */

import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';

const PARAMS_FILE = path.join(config.paths.data, 'scalp_params.json');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScalpParams {
  // Signal filtering
  minScoreScalp: number;          // min score to act on a scalp signal (default 35)
  minScoreHybrid: number;         // min score for hybrid signals (default 45)
  bypassSwingGateForScalps: boolean; // skip HTF bias+zone gate for SCALP/HYBRID (default true)
  allowedRegimes: string[];       // regimes where scalp trades are taken

  // Position sizing
  riskPerTradePct: number;        // fraction of virtual balance risked per trade (default 0.02)
  leverageMultiplier: number;     // multiplied on top of calculated leverage (default 1.0)
  maxConcurrentScalps: number;    // max open paper scalp positions (default 5)

  // Dedup & timing
  dedupWindowMinutes: number;     // suppress same-asset signal for N minutes (default 10)
  sessionFilterEnabled: boolean;  // only trade London/NY sessions (default false)
  allowedHoursUTC: number[];      // empty = all hours; populated when sessionFilter enabled

  // Per-asset weight overrides (1.0 = normal, 0.0 = skip)
  assetWeights: Record<string, number>;

  // Per-strategy weight overrides (1.0 = normal, 0.0 = skip)
  strategyWeights: Record<string, number>;

  // Auto-adjustment metadata
  lastAutoAdjust: string;         // ISO timestamp of last auto-adjustment
  adjustmentHistory: AdjustmentRecord[];
}

export interface AdjustmentRecord {
  timestamp: string;
  reason: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// ─── Defaults — aggressive, let data decide ──────────────────────────────────

export const DEFAULT_SCALP_PARAMS: ScalpParams = {
  minScoreScalp: 35,
  minScoreHybrid: 45,
  bypassSwingGateForScalps: true,
  allowedRegimes: ['TREND_UP', 'TREND_DOWN', 'RANGE', 'VOL_EXPANSION', 'LOW_VOL_COMPRESSION'],

  riskPerTradePct: 0.02,
  leverageMultiplier: 1.0,
  maxConcurrentScalps: 5,

  dedupWindowMinutes: 10,
  sessionFilterEnabled: false,
  allowedHoursUTC: [],

  assetWeights: {},
  strategyWeights: {},

  lastAutoAdjust: new Date(0).toISOString(),
  adjustmentHistory: [],
};

// ─── Load / Save ──────────────────────────────────────────────────────────────

export function loadScalpParams(): ScalpParams {
  try {
    if (fs.existsSync(PARAMS_FILE)) {
      const raw = fs.readFileSync(PARAMS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<ScalpParams>;
      // Deep merge: defaults for any missing keys
      return {
        ...DEFAULT_SCALP_PARAMS,
        ...parsed,
        assetWeights: { ...DEFAULT_SCALP_PARAMS.assetWeights, ...(parsed.assetWeights ?? {}) },
        strategyWeights: { ...DEFAULT_SCALP_PARAMS.strategyWeights, ...(parsed.strategyWeights ?? {}) },
        adjustmentHistory: parsed.adjustmentHistory ?? [],
      };
    }
  } catch (e) {
    logger.warn(`scalpParams: could not load ${PARAMS_FILE}, using defaults: ${e}`);
  }
  return { ...DEFAULT_SCALP_PARAMS, assetWeights: {}, strategyWeights: {}, adjustmentHistory: [] };
}

export function saveScalpParams(params: ScalpParams): void {
  try {
    fs.mkdirSync(config.paths.data, { recursive: true });
    const tmp = PARAMS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(params, null, 2));
    fs.renameSync(tmp, PARAMS_FILE);
  } catch (e) {
    logger.error(`scalpParams: failed to save: ${e}`);
  }
}

// ─── Initialise with defaults if file doesn't exist ──────────────────────────

export function ensureScalpParamsExist(): void {
  if (!fs.existsSync(PARAMS_FILE)) {
    saveScalpParams({ ...DEFAULT_SCALP_PARAMS, assetWeights: {}, strategyWeights: {}, adjustmentHistory: [] });
    logger.info('scalpParams: created default scalp_params.json');
  }
}

// ─── Auto-adjustment helpers ──────────────────────────────────────────────────

/**
 * Record a single parameter change in the params file.
 * Called by the weekly auto-adjuster to keep a trail of every change.
 */
export function recordAdjustment(
  params: ScalpParams,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  reason: string,
): void {
  const record: AdjustmentRecord = {
    timestamp: new Date().toISOString(),
    reason,
    field,
    oldValue,
    newValue,
  };
  params.adjustmentHistory = [record, ...params.adjustmentHistory].slice(0, 100); // keep last 100
  logger.info(`scalpParams: auto-adjusted ${field}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)} (${reason})`);
}

/**
 * Update per-asset weight.  0.0 = skip asset entirely, 1.0 = normal.
 */
export function setAssetWeight(asset: string, weight: number, reason: string): void {
  const params = loadScalpParams();
  const oldVal = params.assetWeights[asset] ?? 1.0;
  params.assetWeights[asset] = Math.max(0, Math.min(1.5, weight));
  recordAdjustment(params, `assetWeights.${asset}`, oldVal, params.assetWeights[asset], reason);
  params.lastAutoAdjust = new Date().toISOString();
  saveScalpParams(params);
}

/**
 * Update per-strategy weight.
 */
export function setStrategyWeight(strategy: string, weight: number, reason: string): void {
  const params = loadScalpParams();
  const oldVal = params.strategyWeights[strategy] ?? 1.0;
  params.strategyWeights[strategy] = Math.max(0, Math.min(1.5, weight));
  recordAdjustment(params, `strategyWeights.${strategy}`, oldVal, params.strategyWeights[strategy], reason);
  params.lastAutoAdjust = new Date().toISOString();
  saveScalpParams(params);
}

/**
 * Getter helpers used at signal evaluation time.
 */
export function getAssetWeight(asset: string): number {
  const params = loadScalpParams();
  return params.assetWeights[asset] ?? 1.0;
}

export function getStrategyWeightScalp(strategy: string): number {
  const params = loadScalpParams();
  return params.strategyWeights[strategy] ?? 1.0;
}

export function isScalpRegimeAllowed(regime: string): boolean {
  const params = loadScalpParams();
  return params.allowedRegimes.includes(regime);
}
