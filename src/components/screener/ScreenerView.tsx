"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import type { ScreenerEntry } from "@/app/api/screener/route";

const SIGNALS = ["Bullish", "Slightly Bullish", "Neutral", "Caution", "High Risk"];

const SIGNAL_COLOR: Record<string, { bg: string; text: string }> = {
  "Bullish":          { bg: "rgba(34,197,94,0.18)",  text: "#4ade80" },
  "Slightly Bullish": { bg: "rgba(34,197,94,0.10)",  text: "#86efac" },
  "Neutral":          { bg: "rgba(148,163,184,0.15)", text: "#94a3b8" },
  "Caution":          { bg: "rgba(251,146,60,0.18)",  text: "#fb923c" },
  "High Risk":        { bg: "rgba(239,68,68,0.18)",   text: "#f87171" },
};

const SORT_OPTIONS = [
  { id: "score_desc",  label: "Score ↓" },
  { id: "score_asc",   label: "Score ↑" },
  { id: "rsi_desc",    label: "RSI ↓" },
  { id: "pe_asc",      label: "KGV ↑" },
  { id: "cap_desc",    label: "MarktKap ↓" },
];

function fmtCap(v: number | null) {
  if (v == null) return "–";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card-border)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono w-6 text-right" style={{ color: "var(--muted)" }}>{value}</span>
    </div>
  );
}

export function ScreenerView() {
  const [entries, setEntries] = useState<ScreenerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [signalFilter, setSignalFilter] = useState<string>("alle");
  const [minScore, setMinScore] = useState(0);
  const [sortBy, setSortBy] = useState("score_desc");

  useEffect(() => {
    fetch("/api/screener")
      .then(r => r.ok ? r.json() : [])
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = entries.filter(e => {
      if (signalFilter !== "alle" && e.signal !== signalFilter) return false;
      if (e.total_score < minScore) return false;
      return true;
    });

    switch (sortBy) {
      case "score_asc":  list = [...list].sort((a, b) => a.total_score - b.total_score); break;
      case "score_desc": list = [...list].sort((a, b) => b.total_score - a.total_score); break;
      case "rsi_desc":   list = [...list].sort((a, b) => (b.rsi ?? 0) - (a.rsi ?? 0)); break;
      case "pe_asc":     list = [...list].sort((a, b) => (a.pe_ratio ?? 999) - (b.pe_ratio ?? 999)); break;
      case "cap_desc":   list = [...list].sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0)); break;
    }
    return list;
  }, [entries, signalFilter, minScore, sortBy]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Screener</h2>
        <span className="text-xs px-2 py-1 rounded-lg font-medium"
          style={{ background: "var(--card-border)", color: "var(--muted)" }}>
          {filtered.length} Aktien
        </span>
      </div>

      {/* Signal filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
        {["alle", ...SIGNALS].map(s => {
          const active = signalFilter === s;
          const col = s !== "alle" ? SIGNAL_COLOR[s] : null;
          return (
            <button key={s} onClick={() => setSignalFilter(s)}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-semibold transition-all"
              style={{
                background: active ? (col?.bg ?? "var(--primary)") : "var(--card)",
                color: active ? (col?.text ?? "#000") : "var(--muted)",
                border: `1px solid ${active ? (col?.text ?? "var(--primary)") : "var(--card-border)"}`,
              }}>
              {s === "alle" ? "Alle" : s}
            </button>
          );
        })}
      </div>

      {/* Score range + Sort */}
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-xl border px-3 py-2 flex items-center gap-2"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: "var(--muted)" }}>
            Min Score
          </span>
          <input
            type="range" min={0} max={90} step={5} value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            className="flex-1 h-1.5 accent-[var(--primary)]"
          />
          <span className="text-xs font-bold text-white w-5 text-right">{minScore}</span>
        </div>

        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="text-xs px-2 py-2 rounded-xl border font-medium"
          style={{ background: "var(--card)", borderColor: "var(--card-border)", color: "var(--muted)" }}>
          {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} className="px-4 py-3 border-b animate-pulse flex gap-3"
              style={{ borderColor: "var(--card-border)" }}>
              <div className="w-10 h-10 rounded-xl flex-shrink-0" style={{ background: "var(--card-border)" }} />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-20 rounded" style={{ background: "var(--card-border)" }} />
                <div className="h-2 w-32 rounded" style={{ background: "var(--card-border)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border p-8 text-center space-y-2"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-2xl">🔍</p>
          <p className="text-sm font-semibold text-white">Keine Aktien gefunden</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Analysiere zuerst Aktien auf der Watchlist oder im NH Select.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          {filtered.map((e, idx) => {
            const sigCol = SIGNAL_COLOR[e.signal] ?? SIGNAL_COLOR["Neutral"];
            return (
              <Link key={e.symbol} href={`/dashboard/asset/${e.symbol}`}
                className="block active:opacity-80 transition-opacity">
                <div className={`px-4 py-3 ${idx < filtered.length - 1 ? "border-b" : ""}`}
                  style={{ borderColor: "var(--card-border)" }}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: sigCol.bg, color: sigCol.text }}>
                        {e.total_score}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{e.symbol}</p>
                        <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                          {e.price != null ? `$${e.price.toFixed(2)}` : "–"}
                          {e.pe_ratio != null ? ` · KGV ${e.pe_ratio.toFixed(1)}` : ""}
                          {e.rsi != null ? ` · RSI ${e.rsi.toFixed(0)}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: sigCol.bg, color: sigCol.text }}>
                        {e.signal}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                        {fmtCap(e.market_cap)}
                      </span>
                    </div>
                  </div>

                  {/* Score bars */}
                  <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                    <div>
                      <p className="text-[9px] mb-0.5" style={{ color: "var(--muted)" }}>Fundamental</p>
                      <ScoreBar value={e.fundamental_score} color="#6366f1" />
                    </div>
                    <div>
                      <p className="text-[9px] mb-0.5" style={{ color: "var(--muted)" }}>Technisch</p>
                      <ScoreBar value={e.technical_score} color="#22c55e" />
                    </div>
                    <div>
                      <p className="text-[9px] mb-0.5" style={{ color: "var(--muted)" }}>Risiko</p>
                      <ScoreBar value={e.risk_score} color="#f59e0b" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
