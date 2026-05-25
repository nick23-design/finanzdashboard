"use client";

import { useEffect, useState } from "react";
import type { PortfolioGroup } from "@/app/api/portfolio/route";

interface Props {
  groups: PortfolioGroup[];
  totalInvested: number;
  period: "all" | "1mo" | "3mo" | "6mo" | "1y";
}

interface ChartPoint { date: string; value: number }
interface BenchmarkPoint { date: string; pct: number }

const HIST_PERIOD: Record<string, string> = {
  all: "2y", "1mo": "1mo", "3mo": "3mo", "6mo": "6mo", "1y": "1y",
};

export function PortfolioChart({ groups, totalInvested, period }: Props) {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [spyPcts, setSpyPcts] = useState<BenchmarkPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!groups.length) { setLoading(false); return; }
    setLoading(true);

    const histPeriod = HIST_PERIOD[period] ?? "1y";

    // Fetch SPY benchmark alongside portfolio
    fetch(`/api/assets/SPY/history?period=${histPeriod}`)
      .then(r => r.ok ? r.json() : [])
      .then((pts: { time: string; value: number }[]) => {
        if (!pts.length) return;
        const base = pts[0].value;
        setSpyPcts(pts.map(p => ({ date: p.time, pct: ((p.value - base) / base) * 100 })));
      })
      .catch(() => {});

    Promise.all(
      groups.map(g =>
        fetch(`/api/assets/${g.symbol}/history?period=${histPeriod}`)
          .then(r => r.ok ? r.json() : [])
          .then((pts: { time: string; value: number }[]) => ({ symbol: g.symbol, shares: g.total_shares, pts }))
          .catch(() => ({ symbol: g.symbol, shares: g.total_shares, pts: [] }))
      )
    ).then(results => {
      // All unique dates sorted
      const allDates = [...new Set(results.flatMap(r => r.pts.map(p => p.time)))].sort();
      if (!allDates.length) { setPoints([]); setLoading(false); return; }

      // Forward-fill each symbol's prices across all dates
      const filled: Record<string, Record<string, number>> = {};
      for (const { symbol, pts } of results) {
        const byDate: Record<string, number> = {};
        for (const p of pts) byDate[p.time] = p.value;
        filled[symbol] = {};
        let last = 0;
        for (const d of allDates) {
          if (byDate[d] != null) last = byDate[d];
          filled[symbol][d] = last;
        }
      }

      const computed = allDates.map(date => ({
        date,
        value: results.reduce((sum, { symbol, shares }) => sum + shares * (filled[symbol][date] ?? 0), 0),
      })).filter(p => p.value > 0);

      setPoints(computed);
      setLoading(false);
    });
  }, [groups, period]);

  if (loading) {
    return <div className="h-20 rounded-xl animate-pulse mx-4 mb-4" style={{ background: "var(--card-border)" }} />;
  }
  if (points.length < 2) return null;

  const W = 300, H = 72, PL = 4, PR = 4, PT = 6, PB = 14;
  const iW = W - PL - PR;
  const iH = H - PT - PB;

  const vals = points.map(p => p.value);
  const minV = Math.min(...vals, totalInvested) * 0.998;
  const maxV = Math.max(...vals, totalInvested) * 1.002;
  const range = maxV - minV || 1;

  const xOf = (i: number) => PL + (i / (points.length - 1)) * iW;
  const yOf = (v: number) => PT + iH - ((v - minV) / range) * iH;

  const linePoints = points.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ");
  const areaPath = `M${PL},${PT + iH} ` +
    points.map((p, i) => `L${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ") +
    ` L${(PL + iW).toFixed(1)},${PT + iH} Z`;

  const lastVal = points[points.length - 1].value;
  const isUp = lastVal >= totalInvested;
  const color = isUp ? "#22c55e" : "#ef4444";
  const portfolioPct = totalInvested > 0 ? ((lastVal - totalInvested) / totalInvested) * 100 : null;
  const spyLastPct = spyPcts.at(-1)?.pct ?? null;
  const investedY = yOf(totalInvested);

  const fmtDate = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const firstDate = fmtDate(points[0].date);
  const lastDate  = fmtDate(points[points.length - 1].date);

  return (
    <div className="px-0 pb-0 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
        <defs>
          <linearGradient id="pgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#pgGrad)" />
        {investedY > PT && investedY < PT + iH && (
          <line x1={PL} y1={investedY.toFixed(1)} x2={W - PR} y2={investedY.toFixed(1)}
            stroke="rgba(100,116,139,0.35)" strokeWidth="0.7" strokeDasharray="3 2" />
        )}
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={xOf(points.length - 1).toFixed(1)} cy={yOf(lastVal).toFixed(1)} r="2.5"
          fill={color} stroke="white" strokeWidth="1" />
        <text x={PL + 2} y={H - 2} fontSize="6.5" fill="rgba(100,116,139,0.65)">{firstDate}</text>
        <text x={W - PR - 2} y={H - 2} fontSize="6.5" fill="rgba(100,116,139,0.65)" textAnchor="end">{lastDate}</text>
      </svg>

      {/* Benchmark comparison row */}
      {(portfolioPct != null || spyLastPct != null) && (
        <div className="flex items-center justify-around px-4 py-2 border-t" style={{ borderColor: "var(--card-border)" }}>
          {portfolioPct != null && (
            <div className="text-center">
              <p className="text-[10px]" style={{ color: "var(--muted)" }}>Mein Portfolio</p>
              <p className="text-sm font-bold" style={{ color: portfolioPct >= 0 ? "#22c55e" : "#ef4444" }}>
                {portfolioPct >= 0 ? "+" : ""}{portfolioPct.toFixed(2)}%
              </p>
            </div>
          )}
          {spyLastPct != null && (
            <div className="text-center">
              <p className="text-[10px]" style={{ color: "var(--muted)" }}>S&amp;P 500</p>
              <p className="text-sm font-bold" style={{ color: spyLastPct >= 0 ? "#22c55e" : "#ef4444" }}>
                {spyLastPct >= 0 ? "+" : ""}{spyLastPct.toFixed(2)}%
              </p>
            </div>
          )}
          {portfolioPct != null && spyLastPct != null && (
            <div className="text-center">
              <p className="text-[10px]" style={{ color: "var(--muted)" }}>Differenz</p>
              {(() => {
                const diff = portfolioPct - spyLastPct;
                return (
                  <p className="text-sm font-bold" style={{ color: diff >= 0 ? "#22c55e" : "#ef4444" }}>
                    {diff >= 0 ? "+" : ""}{diff.toFixed(2)}%
                  </p>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
