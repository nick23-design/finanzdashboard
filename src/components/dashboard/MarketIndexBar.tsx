"use client";

import { useEffect, useState } from "react";
import type { MarketIndex } from "@/lib/finance-client";

const SHORT_NAME: Record<string, string> = {
  "S&P 500":   "S&P 500",
  "NASDAQ":    "NASDAQ",
  "DAX":       "DAX",
  "Dow Jones": "Dow",
};

export function MarketIndexBar() {
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/market/indices");
      if (res.ok) setIndices(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Refresh every 5 minutes
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex-shrink-0 h-12 w-24 rounded-xl animate-pulse"
            style={{ background: "var(--card)" }} />
        ))}
      </div>
    );
  }

  if (indices.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
      {indices.map(idx => {
        const up = idx.change_pct != null && idx.change_pct > 0;
        const down = idx.change_pct != null && idx.change_pct < 0;
        const color = up ? "#22c55e" : down ? "#ef4444" : "var(--muted)";
        const arrow = up ? "▲" : down ? "▼" : "";

        return (
          <div
            key={idx.symbol}
            className="flex-shrink-0 rounded-xl px-3 py-2 min-w-[88px]"
            style={{
              background: "var(--card)",
              border: "1px solid var(--card-border)",
            }}>
            <p className="text-[10px] font-medium" style={{ color: "var(--muted)" }}>
              {SHORT_NAME[idx.name] ?? idx.name}
            </p>
            <p className="text-xs font-bold text-white mt-0.5">
              {idx.price != null ? idx.price.toLocaleString("de-DE") : "—"}
            </p>
            {idx.change_pct != null && (
              <p className="text-[10px] font-semibold mt-0.5" style={{ color }}>
                {arrow} {Math.abs(idx.change_pct).toFixed(2)}%
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
