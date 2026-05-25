"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";

interface NHSelectEntry {
  symbol: string;
  name?: string;
  recommendation: string;
  conviction: number;
  rationale: string;
  agent: string;
  created_at: string;
}

const REC_COLOR: Record<string, string> = {
  "Kaufen":        "#22c55e",
  "Leicht kaufen": "#86efac",
  "Halten":        "#ca8a04",
};

export function NHSelectTeaser() {
  const [pick, setPick] = useState<NHSelectEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("nhselect_collapsed") === "1";
  });

  function toggleCollapse() {
    setCollapsed(v => {
      const next = !v;
      localStorage.setItem("nhselect_collapsed", next ? "1" : "0");
      return next;
    });
  }

  useEffect(() => {
    fetch("/api/nh-select")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.symbol) setPick(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border p-4 animate-pulse"
        style={{ background: "var(--card)", borderColor: "rgba(245,158,11,0.25)" }}>
        <div className="flex gap-2">
          <div className="w-6 h-6 rounded-full" style={{ background: "var(--card-border)" }} />
          <div className="h-3 w-32 rounded mt-1" style={{ background: "var(--card-border)" }} />
        </div>
      </div>
    );
  }

  if (!pick) return null;

  const recColor = REC_COLOR[pick.recommendation] ?? "#94a3b8";
  const timeStr = new Date(pick.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(245,158,11,0.07) 0%, var(--card) 70%)",
        borderColor: "rgba(245,158,11,0.3)",
      }}>

      {/* Header — always visible, clickable */}
      <div className="px-4 py-3 flex items-center justify-between cursor-pointer"
        onClick={toggleCollapse}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <AgentAvatar agent="synthesizer" size="xs" />
          <Sparkles size={12} style={{ color: "#f59e0b" }} />
          <span className="text-xs font-semibold uppercase tracking-wider flex-shrink-0"
            style={{ color: "#f59e0b" }}>
            NH Select
          </span>
          <span className="text-xs font-bold flex-shrink-0" style={{ color: recColor }}>
            {pick.symbol}
          </span>
          {collapsed && (
            <span className="text-xs truncate" style={{ color: "var(--muted)" }}>
              · {pick.recommendation} · {pick.conviction}/10
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!collapsed && (
            <span className="text-[10px]" style={{ color: "var(--muted)" }}>{timeStr}</span>
          )}
          {collapsed
            ? <ChevronDown size={14} style={{ color: "var(--muted)" }} />
            : <ChevronUp size={14} style={{ color: "var(--muted)" }} />}
        </div>
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "rgba(245,158,11,0.15)" }}>
          <div className="flex items-center justify-between pt-3">
            <div>
              <p className="text-lg font-bold text-white">{pick.symbol}</p>
              {pick.name && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>{pick.name}</p>
              )}
            </div>
            <div className="text-right">
              <span className="text-sm font-semibold px-2 py-1 rounded-lg"
                style={{ background: `${recColor}22`, color: recColor }}>
                {pick.recommendation}
              </span>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                Überzeugung {pick.conviction}/10
              </p>
            </div>
          </div>

          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            {pick.rationale}
          </p>

          <div className="flex gap-2">
            <Link href={`/dashboard/asset/${pick.symbol}`}
              className="flex-1 py-2 rounded-xl text-center text-sm font-semibold"
              style={{ background: "#f59e0b", color: "#000" }}>
              Aktie ansehen
            </Link>
            <Link href="/dashboard/search"
              className="px-4 py-2 rounded-xl text-center text-sm font-semibold"
              style={{ background: "var(--card-border)", color: "var(--muted)" }}>
              Alle Picks →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
