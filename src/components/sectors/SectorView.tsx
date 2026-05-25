"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
import type { SectorData } from "@/app/api/market/sectors/route";

type Period = "1d" | "1w" | "1m";

const PERIOD_LABEL: Record<Period, string> = { "1d": "1T", "1w": "1W", "1m": "1M" };

const SECTOR_EMOJI: Record<string, string> = {
  "Technologie":       "💻",
  "Gesundheit":        "🏥",
  "Finanzen":          "🏦",
  "Energie":           "⚡",
  "Konsum (zyklisch)": "🛍️",
  "Konsum (defensiv)": "🛒",
  "Industrie":         "🏭",
  "Materialien":       "⛏️",
  "Immobilien":        "🏠",
  "Versorger":         "💡",
  "Kommunikation":     "📡",
};

function perfColor(p: number | null): { bg: string; text: string } {
  if (p == null) return { bg: "var(--card-border)", text: "var(--muted)" };
  if (p >= 3)   return { bg: "rgba(34,197,94,0.25)",  text: "#22c55e" };
  if (p >= 1)   return { bg: "rgba(34,197,94,0.14)",  text: "#4ade80" };
  if (p >= 0)   return { bg: "rgba(34,197,94,0.07)",  text: "#86efac" };
  if (p >= -1)  return { bg: "rgba(239,68,68,0.07)",  text: "#fca5a5" };
  if (p >= -3)  return { bg: "rgba(239,68,68,0.14)",  text: "#f87171" };
  return        { bg: "rgba(239,68,68,0.25)",  text: "#ef4444" };
}

function SectorTile({ sector, maxAbs }: { sector: SectorData; maxAbs: number }) {
  const { bg, text } = perfColor(sector.performance);
  const p = sector.performance;
  const barWidth = p != null && maxAbs > 0 ? Math.min(Math.abs(p) / maxAbs, 1) * 100 : 0;
  const isUp = (p ?? 0) >= 0;

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2 relative overflow-hidden"
      style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}>

      {/* Color fill bar */}
      <div className="absolute bottom-0 left-0 h-1 rounded-b-2xl transition-all duration-700"
        style={{ width: `${barWidth}%`, background: text, opacity: 0.6 }} />

      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <span className="text-base">{SECTOR_EMOJI[sector.name] ?? "📊"}</span>
          <p className="text-xs font-semibold text-white leading-tight mt-0.5">{sector.name}</p>
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>{sector.etf}</p>
        </div>
        {p != null ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-base font-bold leading-none" style={{ color: text }}>
              {isUp ? "+" : ""}{p.toFixed(2)}%
            </span>
            {isUp
              ? <TrendingUp size={12} style={{ color: text }} />
              : <TrendingDown size={12} style={{ color: text }} />
            }
          </div>
        ) : (
          <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>
        )}
      </div>

      {sector.price != null && (
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>
          {sector.price.toFixed(2)} <span>{sector.currency ?? "USD"}</span>
        </p>
      )}
    </div>
  );
}

function SectorSkeleton() {
  return (
    <div className="rounded-2xl p-4 animate-pulse" style={{ background: "var(--card)", border: "1px solid var(--card-border)", height: 96 }}>
      <div className="h-3 w-16 rounded mb-2" style={{ background: "var(--card-border)" }} />
      <div className="h-5 w-12 rounded" style={{ background: "var(--card-border)" }} />
    </div>
  );
}

export function SectorView() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("1d");
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/market/sectors?period=${period}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: SectorData[]) => {
        const sorted = [...data].sort((a, b) => (b.performance ?? -Infinity) - (a.performance ?? -Infinity));
        setSectors(sorted);
      })
      .catch(() => setSectors([]))
      .finally(() => setLoading(false));
  }, [period]);

  const maxAbs = Math.max(...sectors.map(s => Math.abs(s.performance ?? 0)), 1);
  const best = sectors[0];
  const worst = sectors[sectors.length - 1];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "var(--card-border)" }}>
          <ArrowLeft size={16} style={{ color: "var(--muted)" }} />
        </button>
        <div>
          <h2 className="text-lg font-bold text-white">Sektor-Radar</h2>
          <p className="text-xs" style={{ color: "var(--muted)" }}>S&P 500 Sektoren via SPDR-ETFs</p>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-2">
        {(["1d", "1w", "1m"] as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{
              background: period === p ? "var(--primary)" : "var(--card)",
              color: period === p ? "#000" : "var(--muted)",
              border: `1px solid ${period === p ? "transparent" : "var(--card-border)"}`,
            }}>
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {/* Best / Worst summary */}
      {!loading && sectors.length > 0 && best?.performance != null && worst?.performance != null && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-3 border" style={{ background: "rgba(34,197,94,0.07)", borderColor: "rgba(34,197,94,0.2)" }}>
            <p className="text-[10px] font-medium mb-1" style={{ color: "var(--muted)" }}>Stärkster Sektor</p>
            <p className="text-sm font-bold text-white">{SECTOR_EMOJI[best.name]} {best.name}</p>
            <p className="text-base font-bold" style={{ color: "#22c55e" }}>+{best.performance.toFixed(2)}%</p>
          </div>
          <div className="rounded-2xl p-3 border" style={{ background: "rgba(239,68,68,0.07)", borderColor: "rgba(239,68,68,0.2)" }}>
            <p className="text-[10px] font-medium mb-1" style={{ color: "var(--muted)" }}>Schwächster Sektor</p>
            <p className="text-sm font-bold text-white">{SECTOR_EMOJI[worst.name]} {worst.name}</p>
            <p className="text-base font-bold" style={{ color: "#ef4444" }}>{worst.performance.toFixed(2)}%</p>
          </div>
        </div>
      )}

      {/* Sector grid */}
      <div className="grid grid-cols-2 gap-3">
        {loading
          ? Array.from({ length: 11 }).map((_, i) => <SectorSkeleton key={i} />)
          : sectors.map(s => <SectorTile key={s.etf} sector={s} maxAbs={maxAbs} />)
        }
      </div>

      {!loading && (
        <p className="text-[10px] text-center pb-2" style={{ color: "var(--muted)" }}>
          Daten basieren auf SPDR Sektor-ETFs · {PERIOD_LABEL[period]} Performance
        </p>
      )}
    </div>
  );
}
