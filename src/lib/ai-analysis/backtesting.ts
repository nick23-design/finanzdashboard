/**
 * Backtesting utilities for historical signal validation.
 * Pure deterministic data analysis — no I/O, no look-ahead.
 * Pass pre-assembled historical data; these functions only compute statistics.
 */

import type { StockType } from "./stock-classification";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BacktestPeriod = "1m" | "3m" | "6m" | "12m";

export type SignalRecord = {
  symbol: string;
  date: string; // ISO date string of signal
  rating: string; // "Kaufen" | "Leicht kaufen" | "Halten" | "Leicht verkaufen" | "Verkaufen"
  alphaScore: number;
  stockType: StockType;
  priceAtSignal: number;
};

export type ForwardReturnRecord = {
  symbol: string;
  signalDate: string;
  period: BacktestPeriod;
  forwardReturn: number; // fractional, e.g. 0.12 = +12%
  benchmarkReturn?: number; // fractional
};

export type RatingBucketStats = {
  count: number;
  avgReturn: number;
  hitRate: number; // fraction of positive returns
  avgBenchmarkRelativeReturn?: number;
};

export type AlphaDecileBucketStats = {
  count: number;
  avgReturn: number;
  hitRate: number;
  avgAlphaScore: number;
};

export type SignalBacktestResult = {
  period: BacktestPeriod;
  sampleSize: number;
  averageForwardReturn: number;
  averageBenchmarkRelativeReturn?: number;
  hitRate: number;
  maxDrawdownAfterSignal?: number;
  byRating: Record<string, RatingBucketStats>;
  byStockType?: Record<string, RatingBucketStats>;
  byAlphaScoreDecile?: Record<string, AlphaDecileBucketStats>;
  limitations: string[];
};

// ─── Core helpers ─────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function hitRate(returns: number[]): number {
  if (returns.length === 0) return 0;
  return returns.filter(r => r > 0).length / returns.length;
}

function maxDrawdown(returns: number[]): number {
  if (returns.length === 0) return 0;
  let peak = -Infinity;
  let maxDD = 0;
  for (const r of returns) {
    if (r > peak) peak = r;
    const dd = peak - r;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function assignDecile(alphaScore: number): string {
  const decile = Math.min(9, Math.floor(alphaScore / 10));
  const lo = decile * 10;
  const hi = lo + 10;
  return `${lo}-${hi}`;
}

// ─── Merge signals + returns ──────────────────────────────────────────────────

type MergedRecord = SignalRecord & { forwardReturn: number; benchmarkReturn?: number; alphaExcess?: number };

function mergeSignalsAndReturns(
  signals: SignalRecord[],
  returns: ForwardReturnRecord[],
  period: BacktestPeriod,
): MergedRecord[] {
  const returnMap = new Map<string, ForwardReturnRecord>();
  for (const r of returns) {
    if (r.period === period) {
      returnMap.set(`${r.symbol}::${r.signalDate}`, r);
    }
  }

  const merged: MergedRecord[] = [];
  for (const s of signals) {
    const key = `${s.symbol}::${s.date}`;
    const ret = returnMap.get(key);
    if (ret === undefined) continue; // No forward return available — skip (avoid look-ahead)
    merged.push({
      ...s,
      forwardReturn: ret.forwardReturn,
      benchmarkReturn: ret.benchmarkReturn,
      alphaExcess: ret.benchmarkReturn !== undefined ? ret.forwardReturn - ret.benchmarkReturn : undefined,
    });
  }
  return merged;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function computeSignalPerformance(
  signals: SignalRecord[],
  forwardReturns: ForwardReturnRecord[],
  period: BacktestPeriod,
): SignalBacktestResult {
  const limitations: string[] = [];

  if (signals.length === 0) {
    limitations.push("Keine Signale vorhanden.");
    return { period, sampleSize: 0, averageForwardReturn: 0, hitRate: 0, byRating: {}, limitations };
  }

  const merged = mergeSignalsAndReturns(signals, forwardReturns, period);

  if (merged.length === 0) {
    limitations.push(`Keine Forward-Returns für Periode '${period}' vorhanden — möglicherweise zu wenig historische Daten.`);
    return { period, sampleSize: 0, averageForwardReturn: 0, hitRate: 0, byRating: {}, limitations };
  }

  if (merged.length < 10) {
    limitations.push(`Nur ${merged.length} Datenpunkte — statistische Aussagekraft eingeschränkt.`);
  }

  const allReturns = merged.map(m => m.forwardReturn);
  const allExcess = merged.filter(m => m.alphaExcess !== undefined).map(m => m.alphaExcess!);

  // By rating
  const byRating: Record<string, RatingBucketStats> = {};
  const ratingGroups = new Map<string, MergedRecord[]>();
  for (const m of merged) {
    if (!ratingGroups.has(m.rating)) ratingGroups.set(m.rating, []);
    ratingGroups.get(m.rating)!.push(m);
  }
  for (const [rating, group] of ratingGroups) {
    const rets = group.map(g => g.forwardReturn);
    const excess = group.filter(g => g.alphaExcess !== undefined).map(g => g.alphaExcess!);
    byRating[rating] = {
      count: group.length,
      avgReturn: avg(rets),
      hitRate: hitRate(rets),
      avgBenchmarkRelativeReturn: excess.length > 0 ? avg(excess) : undefined,
    };
  }

  // By stock type
  const byStockType: Record<string, RatingBucketStats> = {};
  const typeGroups = new Map<string, MergedRecord[]>();
  for (const m of merged) {
    const t = m.stockType as string;
    if (!typeGroups.has(t)) typeGroups.set(t, []);
    typeGroups.get(t)!.push(m);
  }
  for (const [type, group] of typeGroups) {
    const rets = group.map(g => g.forwardReturn);
    const excess = group.filter(g => g.alphaExcess !== undefined).map(g => g.alphaExcess!);
    byStockType[type] = {
      count: group.length,
      avgReturn: avg(rets),
      hitRate: hitRate(rets),
      avgBenchmarkRelativeReturn: excess.length > 0 ? avg(excess) : undefined,
    };
  }

  // By alpha score decile
  const byAlphaScoreDecile: Record<string, AlphaDecileBucketStats> = {};
  const decileGroups = new Map<string, MergedRecord[]>();
  for (const m of merged) {
    const d = assignDecile(m.alphaScore);
    if (!decileGroups.has(d)) decileGroups.set(d, []);
    decileGroups.get(d)!.push(m);
  }
  for (const [decile, group] of decileGroups) {
    const rets = group.map(g => g.forwardReturn);
    byAlphaScoreDecile[decile] = {
      count: group.length,
      avgReturn: avg(rets),
      hitRate: hitRate(rets),
      avgAlphaScore: avg(group.map(g => g.alphaScore)),
    };
  }

  if (allReturns.some(r => !Number.isFinite(r))) {
    limitations.push("Einige Forward-Returns sind nicht endlich (möglicherweise Datenfehler).");
  }

  return {
    period,
    sampleSize: merged.length,
    averageForwardReturn: avg(allReturns),
    averageBenchmarkRelativeReturn: allExcess.length > 0 ? avg(allExcess) : undefined,
    hitRate: hitRate(allReturns),
    maxDrawdownAfterSignal: maxDrawdown(allReturns),
    byRating,
    byStockType,
    byAlphaScoreDecile,
    limitations,
  };
}

export function filterByPeriodAvailability(
  signals: SignalRecord[],
  returns: ForwardReturnRecord[],
  period: BacktestPeriod,
): { withReturns: SignalRecord[]; withoutReturns: SignalRecord[] } {
  const returnKeys = new Set(
    returns.filter(r => r.period === period).map(r => `${r.symbol}::${r.signalDate}`),
  );
  const withReturns = signals.filter(s => returnKeys.has(`${s.symbol}::${s.date}`));
  const withoutReturns = signals.filter(s => !returnKeys.has(`${s.symbol}::${s.date}`));
  return { withReturns, withoutReturns };
}
