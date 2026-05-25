"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { EarningsEntry } from "@/app/api/earnings-calendar/route";

export function EarningsCalendarCard() {
  const [entries, setEntries] = useState<EarningsEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/earnings-calendar")
      .then(r => r.ok ? r.json() : [])
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (!loading && entries.length === 0) return null;

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--card-border)" }}>
        <div className="flex items-center gap-2">
          <span className="text-base">📅</span>
          <p className="text-sm font-semibold text-white">Earnings-Kalender</p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
          style={{ background: "var(--card-border)", color: "var(--muted)" }}>
          nächste 60 Tage
        </span>
      </div>

      <div className="divide-y" style={{ borderColor: "var(--card-border)" }}>
        {loading ? (
          [1, 2, 3].map(i => (
            <div key={i} className="px-4 py-3 flex items-center gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-xl flex-shrink-0" style={{ background: "var(--card-border)" }} />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-16 rounded" style={{ background: "var(--card-border)" }} />
                <div className="h-2.5 w-24 rounded" style={{ background: "var(--card-border)" }} />
              </div>
              <div className="h-5 w-12 rounded" style={{ background: "var(--card-border)" }} />
            </div>
          ))
        ) : (
          entries.map(e => {
            const urgent = e.days_until <= 3;
            const soon = e.days_until <= 7;
            const dateLabel = e.days_until === 0 ? "Heute" : e.days_until === 1 ? "Morgen" :
              new Date(e.next_earnings_date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

            return (
              <Link key={e.symbol} href={`/dashboard/asset/${e.symbol}`}
                className="px-4 py-3 flex items-center gap-3 active:opacity-80 block">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-center"
                  style={{
                    background: urgent ? "rgba(239,68,68,0.12)" : soon ? "rgba(251,146,60,0.12)" : "rgba(99,102,241,0.1)",
                    border: `1px solid ${urgent ? "rgba(239,68,68,0.3)" : soon ? "rgba(251,146,60,0.3)" : "rgba(99,102,241,0.2)"}`,
                  }}>
                  <p className="text-[10px] font-bold leading-tight"
                    style={{ color: urgent ? "#ef4444" : soon ? "#fb923c" : "#818cf8" }}>
                    {e.days_until === 0 ? "HEU" : e.days_until === 1 ? "MOR" : `${e.days_until}T`}
                  </p>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{e.symbol}</p>
                  <p className="text-[11px] truncate" style={{ color: "var(--muted)" }}>
                    {dateLabel}
                    {e.eps_estimate != null && ` · EPS-Schätzung: $${e.eps_estimate.toFixed(2)}`}
                  </p>
                </div>

                {urgent && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                    style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                    Bald
                  </span>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
