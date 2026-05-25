"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ScreenerEntry } from "@/app/api/screener/route";

const SIGNAL_COLOR: Record<string, string> = {
  "Bullish":          "#4ade80",
  "Slightly Bullish": "#86efac",
  "Neutral":          "#94a3b8",
  "Caution":          "#fb923c",
  "High Risk":        "#f87171",
};

export function ScreenerTeaser() {
  const [top, setTop] = useState<ScreenerEntry[]>([]);

  useEffect(() => {
    fetch("/api/screener")
      .then(r => r.ok ? r.json() : [])
      .then((entries: ScreenerEntry[]) => {
        const sorted = [...entries].sort((a, b) => b.total_score - a.total_score);
        setTop(sorted.slice(0, 3));
      })
      .catch(() => {});
  }, []);

  if (!top.length) return null;

  return (
    <Link href="/dashboard/screener" className="block active:opacity-80">
      <div className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: "var(--card-border)" }}>
          <div className="flex items-center gap-2">
            <span className="text-base">🔍</span>
            <p className="text-sm font-semibold text-white">Screener</p>
          </div>
          <span className="text-xs font-medium" style={{ color: "var(--primary)" }}>Alle →</span>
        </div>
        <div className="flex divide-x" style={{ borderColor: "var(--card-border)" }}>
          {top.map(e => (
            <div key={e.symbol} className="flex-1 px-3 py-3 text-center">
              <p className="text-xs font-bold text-white">{e.symbol}</p>
              <p className="text-lg font-bold mt-0.5" style={{ color: SIGNAL_COLOR[e.signal] ?? "#94a3b8" }}>
                {e.total_score}
              </p>
              <p className="text-[9px] font-medium mt-0.5" style={{ color: SIGNAL_COLOR[e.signal] ?? "#94a3b8" }}>
                {e.signal === "Slightly Bullish" ? "Sl. Bull." : e.signal}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}
