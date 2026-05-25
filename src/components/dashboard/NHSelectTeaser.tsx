"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

interface NHSelectEntry {
  symbol: string;
  name?: string;
  recommendation: string;
  conviction: number;
}

const REC_COLOR: Record<string, string> = {
  "Kaufen":        "#22c55e",
  "Leicht kaufen": "#86efac",
  "Halten":        "#ca8a04",
};

export function NHSelectTeaser() {
  const [pick, setPick] = useState<NHSelectEntry | null>(null);

  useEffect(() => {
    fetch("/api/nh-select")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.symbol) setPick(data); })
      .catch(() => {});
  }, []);

  const recColor = pick ? (REC_COLOR[pick.recommendation] ?? "#94a3b8") : "var(--muted)";

  return (
    <Link href="/dashboard/market"
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border active:opacity-75 transition-opacity"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <Sparkles size={13} style={{ color: "#f59e0b" }} />
      <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>NH Select</span>
      <span className="text-xs" style={{ color: "var(--card-border)" }}>·</span>
      {pick ? (
        <>
          <span className="text-sm font-bold text-white">{pick.symbol}</span>
          {pick.name && (
            <span className="text-xs truncate flex-1 min-w-0" style={{ color: "var(--muted)" }}>
              {pick.name}
            </span>
          )}
          <span className="text-xs font-semibold flex-shrink-0 ml-auto" style={{ color: recColor }}>
            {pick.recommendation} →
          </span>
        </>
      ) : (
        <span className="text-xs flex-1" style={{ color: "var(--muted)" }}>
          Heute noch kein Pick verfügbar →
        </span>
      )}
    </Link>
  );
}
