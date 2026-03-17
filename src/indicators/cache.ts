/**
 * Indicator result cache
 *
 * Uses WeakMap keyed on OHLCV array references so results are automatically
 * released when a candles array goes out of scope (after each scan cycle).
 * All strategies receive the same array references from the engine, so they
 * share results — zero redundant recomputation per asset per cycle.
 *
 * Usage — swap `ema(candles, 20)` for `cachedEma(candles, 20)` etc.
 */
import type { OHLCV } from '../types';
import { ema, rsi, atr, atrAverage, vwap } from './indicators';

const store = new WeakMap<OHLCV[], Map<string, unknown>>();

function get<T>(candles: OHLCV[], key: string, compute: () => T): T {
  let inner = store.get(candles);
  if (!inner) {
    inner = new Map();
    store.set(candles, inner);
  }
  if (!inner.has(key)) inner.set(key, compute());
  return inner.get(key) as T;
}

export const cachedEma = (candles: OHLCV[], period: number): number[] =>
  get(candles, `ema_${period}`, () => ema(candles, period));

export const cachedRsi = (candles: OHLCV[], period: number): number[] =>
  get(candles, `rsi_${period}`, () => rsi(candles, period));

export const cachedAtr = (candles: OHLCV[], period: number): number[] =>
  get(candles, `atr_${period}`, () => atr(candles, period));

/**
 * Returns the rolling average of the ATR series (last `period` values).
 * Internally reuses the cached ATR array — no double computation.
 */
export const cachedAtrAverage = (candles: OHLCV[], period: number): number =>
  get(candles, `atrAvg_${period}`, () => atrAverage(cachedAtr(candles, period), period));

export const cachedVwap = (candles: OHLCV[]): number[] =>
  get(candles, 'vwap', () => vwap(candles));
