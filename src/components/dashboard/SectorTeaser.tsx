"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { SectorData } from "@/app/api/market/sectors/route";

export function SectorTeaser() {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/market/sectors?period=1d")
      .then(r => r.ok ? r.json() : [])
      .then((data: SectorData[]) => {
        const sorted = [...data]
          .filter(s => s.performance != null)
          .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0));
        setSectors(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const best = sectors[0];
  const worst = sectors[sectors.length - 1];

  return (
    <Link href="/dashboard/sectors"
      className="flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all active:opacity-80"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      <span className="text-xl flex-shrink-0">📊</span>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white">Sektor-Radar</p>
        {loading ? (
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>Wird geladen…</p>
        ) : best && worst ? (
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            <span style={{ color: "#22c55e" }}>▲ {best.name} +{best.performance!.toFixed(1)}%</span>
            {"  ·  "}
            <span style={{ color: "#ef4444" }}>▼ {worst.name} {worst.performance!.toFixed(1)}%</span>
          </p>
        ) : (
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>S&amp;P 500 Sektoren im Überblick</p>
        )}
      </div>

      <ChevronRight size={14} style={{ color: "var(--muted)" }} className="flex-shrink-0" />
    </Link>
  );
}
