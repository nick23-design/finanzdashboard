"use client";

import { useEffect, useState } from "react";
import type { PortfolioGroup } from "@/app/api/portfolio/route";

interface Props {
  groups: PortfolioGroup[];
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - meanA, y = b[i] - meanB;
    num += x * y; da += x * x; db += y * y;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}

function corrColor(r: number) {
  if (r >= 0.7)  return { bg: "rgba(239,68,68,0.25)",   text: "#f87171" };
  if (r >= 0.4)  return { bg: "rgba(251,146,60,0.20)",  text: "#fb923c" };
  if (r >= 0.1)  return { bg: "rgba(234,179,8,0.18)",   text: "#facc15" };
  if (r >= -0.1) return { bg: "rgba(148,163,184,0.15)", text: "#94a3b8" };
  if (r >= -0.4) return { bg: "rgba(99,102,241,0.18)",  text: "#818cf8" };
  return                { bg: "rgba(34,197,94,0.18)",   text: "#4ade80" };
}

export function CorrelationMatrix({ groups }: Props) {
  const [returns, setReturns] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);

  const symbols = groups.map(g => g.symbol);

  useEffect(() => {
    if (symbols.length < 2) { setLoading(false); return; }
    setLoading(true);

    Promise.all(
      symbols.map(sym =>
        fetch(`/api/assets/${sym}/history?period=3mo`)
          .then(r => r.ok ? r.json() : [])
          .then((pts: { time: string; value: number }[]) => {
            // Daily returns
            const rets: number[] = [];
            for (let i = 1; i < pts.length; i++) {
              const prev = pts[i - 1].value;
              if (prev > 0) rets.push((pts[i].value - prev) / prev);
            }
            return { sym, rets };
          })
          .catch(() => ({ sym, rets: [] }))
      )
    ).then(results => {
      const map: Record<string, number[]> = {};
      for (const { sym, rets } of results) map[sym] = rets;
      setReturns(map);
      setLoading(false);
    });
  }, [symbols.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (symbols.length < 2) return null;

  if (loading) {
    return (
      <div className="rounded-2xl border p-4 space-y-2"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>Korrelationsmatrix</p>
        <div className="h-32 rounded-xl animate-pulse" style={{ background: "var(--card-border)" }} />
      </div>
    );
  }

  const n = symbols.length;
  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? 1 : pearson(returns[symbols[i]] ?? [], returns[symbols[j]] ?? [])
    )
  );

  const cellSize = Math.min(52, Math.floor(320 / (n + 1)));

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="px-4 py-3 border-b flex items-center justify-between"
        style={{ borderColor: "var(--card-border)" }}>
        <div>
          <p className="text-sm font-semibold text-white">Korrelationsmatrix</p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
            Tägl. Rendite-Korrelation · 3 Monate
          </p>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-1.5">
          {[
            { label: "−", col: "#4ade80" },
            { label: "0", col: "#94a3b8" },
            { label: "+", col: "#f87171" },
          ].map(({ label, col }) => (
            <div key={label} className="flex items-center gap-0.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: col, opacity: 0.5 }} />
              <span className="text-[9px]" style={{ color: "var(--muted)" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3 overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th style={{ width: cellSize, minWidth: cellSize }} />
              {symbols.map(sym => (
                <th key={sym} style={{ width: cellSize, minWidth: cellSize }}>
                  <p className="text-[9px] font-bold text-white text-center truncate">{sym}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((rowSym, i) => (
              <tr key={rowSym}>
                <td>
                  <p className="text-[9px] font-bold text-right pr-1 truncate"
                    style={{ color: "var(--muted)", maxWidth: cellSize }}>{rowSym}</p>
                </td>
                {symbols.map((_, j) => {
                  const r = matrix[i][j];
                  const { bg, text } = corrColor(r);
                  const isDiag = i === j;
                  return (
                    <td key={j}>
                      <div
                        className="flex items-center justify-center rounded-lg text-[10px] font-bold"
                        style={{
                          width: cellSize, height: cellSize,
                          background: isDiag ? "rgba(99,102,241,0.2)" : bg,
                          color: isDiag ? "#818cf8" : text,
                        }}>
                        {isDiag ? "1.0" : r.toFixed(2)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Interpretation guide */}
      <div className="px-4 pb-3 grid grid-cols-3 gap-2">
        {[
          { range: "≥ 0.7", label: "Stark positiv", color: "#f87171", note: "Hohe Klumpenrisiko" },
          { range: "≈ 0",   label: "Unkorrelliert",  color: "#94a3b8", note: "Gute Diversif." },
          { range: "< 0",   label: "Negativ",        color: "#4ade80", note: "Hedge-Effekt" },
        ].map(({ range, label, color, note }) => (
          <div key={range} className="rounded-lg p-2" style={{ background: "var(--card-border)" }}>
            <p className="text-[10px] font-bold" style={{ color }}>{range}</p>
            <p className="text-[9px] font-semibold text-white">{label}</p>
            <p className="text-[9px]" style={{ color: "var(--muted)" }}>{note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
