"use client";

import { useEffect, useState } from "react";
import type { AIAnalysis } from "@/types/database";

interface HistoryEntry {
  id: string;
  recommendation: string;
  conviction: number;
  fundamental_rating: number;
  news_sentiment: string;
  summary: string;
  analyzed_at: string;
}

const REC_COLOR: Record<string, string> = {
  "Kaufen":           "#16a34a",
  "Leicht kaufen":    "#4ade80",
  "Halten":           "#ca8a04",
  "Leicht verkaufen": "#f97316",
  "Verkaufen":        "#dc2626",
};

const SENTIMENT_COLOR: Record<string, string> = {
  bullish: "#22c55e",
  neutral: "#ca8a04",
  bearish: "#ef4444",
};

const SENTIMENT_LABEL: Record<string, string> = {
  bullish: "↑ Positiv",
  neutral: "= Neutral",
  bearish: "↓ Negativ",
};

const INSIDER_LABEL: Record<string, string> = {
  bullish: "Insider kaufen",
  neutral: "Insider neutral",
  bearish: "Insider verkaufen",
};
const INST_LABEL: Record<string, string> = {
  accumulating: "Institutionen kaufen",
  stable:        "Institutionen stabil",
  reducing:      "Institutionen reduzieren",
};
const TREND_LABEL: Record<string, string> = {
  rising:   "Trends steigen",
  stable:   "Trends stabil",
  declining:"Trends fallen",
};
const SIGNAL_COLOR: Record<string, string> = {
  bullish: "#22c55e", accumulating: "#22c55e", rising: "#22c55e",
  neutral: "#ca8a04", stable: "#ca8a04",
  bearish: "#ef4444", reducing: "#ef4444", declining: "#ef4444",
};

// ── Sparkline ────────────────────────────────────────────────────────────────

function ScoreTrendChart({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length < 2) return null;

  const sorted = [...entries].reverse();
  const W = 300;
  const H = 60;
  const PAD = 10;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const xOf = (i: number) => PAD + (i / (sorted.length - 1)) * innerW;
  const yOf  = (v: number) => PAD + innerH - ((v - 1) / 9) * innerH;

  const convPoints = sorted.map((e, i) => `${xOf(i)},${yOf(e.conviction)}`).join(" ");
  const fundPoints = sorted.map((e, i) => `${xOf(i)},${yOf(e.fundamental_rating)}`).join(" ");

  const first    = sorted[0];
  const last     = sorted[sorted.length - 1];
  const firstDate = new Date(first.analyzed_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const lastDate  = new Date(last.analyzed_at).toLocaleDateString("de-DE",  { day: "2-digit", month: "2-digit" });

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 mb-1">
        <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--muted)" }}>
          <span className="inline-block w-4 h-0.5 rounded" style={{ background: "#a78bfa" }} />
          Überzeugung
        </span>
        <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--muted)" }}>
          <span className="inline-block w-4 h-0.5 rounded" style={{ background: "#38bdf8", opacity: 0.6 }} />
          Fundamental
        </span>
      </div>

      <div className="relative w-full overflow-hidden" style={{ height: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
          {[3, 5, 7].map(v => (
            <line key={v} x1={PAD} y1={yOf(v)} x2={W - PAD} y2={yOf(v)}
              stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
          ))}
          <polyline points={fundPoints} fill="none" stroke="#38bdf8"
            strokeWidth="1.2" strokeOpacity="0.45" strokeDasharray="3 2" />
          <polyline points={convPoints} fill="none" stroke="#a78bfa" strokeWidth="1.8" />
          {sorted.map((e, i) => {
            const cx    = xOf(i);
            const cy    = yOf(e.conviction);
            const color = REC_COLOR[e.recommendation] ?? "#6b7280";
            const isLast = i === sorted.length - 1;
            return (
              <g key={e.id}>
                {isLast && <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity="0.2" />}
                <circle cx={cx} cy={cy} r={isLast ? 3.5 : 2.5} fill={color}
                  stroke={isLast ? "white" : "transparent"} strokeWidth={isLast ? 1 : 0} />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex justify-between px-0.5">
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>{firstDate}</span>
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>{lastDate}</span>
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
          Letzte {sorted.length} Analysen
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ color: REC_COLOR[last.recommendation] ?? "#6b7280", background: (REC_COLOR[last.recommendation] ?? "#6b7280") + "22" }}>
            {last.recommendation}
          </span>
          <span className="text-[10px] font-semibold" style={{ color: "#a78bfa" }}>
            {last.conviction}/10
          </span>
          <span className="text-[10px]"
            style={{ color: SENTIMENT_COLOR[last.news_sentiment] ?? "var(--muted)" }}>
            {SENTIMENT_LABEL[last.news_sentiment] ?? ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Vollansicht einer einzelnen Analyse ──────────────────────────────────────

function FullAnalysisView({ id, symbol }: { id: string; symbol: string }) {
  const [data, setData] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/ai-analysis/${symbol}/history/${id}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id, symbol]);

  if (loading) {
    return (
      <div className="space-y-2 pt-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-3 rounded animate-pulse" style={{ background: "var(--card-border)", width: i === 3 ? "60%" : "100%" }} />
        ))}
      </div>
    );
  }
  if (!data) return <p className="text-xs pt-2" style={{ color: "#ef4444" }}>Konnte nicht geladen werden.</p>;

  const bullCase  = data.bull_case  as string[];
  const bearCase  = data.bear_case  as string[];
  const themes    = data.news_themes as string[];
  const positives = data.fundamental_positives as string[];
  const risks     = data.fundamental_risks     as string[];
  const extra     = data.extra_data as Record<string, unknown> | null;
  const priceLevels = extra?.price_levels as { entry: number | null; target: number | null; stop_loss: number | null; entry_rationale?: string; target_rationale?: string } | null;
  const marketIntel = extra?.market_intel as { insider_signal: string; institutional_trend: string; trends_momentum: string; key_observations: string[] } | null;

  const fmt = (n: number | null) => n != null ? `$${n.toFixed(2)}` : "—";
  const sentColor = SENTIMENT_COLOR[data.news_sentiment] ?? "var(--muted)";

  return (
    <div className="pt-3 space-y-3 text-xs" style={{ color: "var(--muted)" }}>

      {/* Zusammenfassung */}
      <p className="leading-relaxed">{data.summary}</p>

      {/* Kursziele */}
      {priceLevels && (
        <div className="rounded-xl p-3 space-y-2"
          style={{ background: "rgba(100,116,139,0.08)", border: "1px solid var(--card-border)" }}>
          <p className="font-semibold text-white text-xs">Kursziele</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="font-bold" style={{ color: "#22c55e" }}>{fmt(priceLevels.entry)}</p>
              <p className="font-medium" style={{ color: "#22c55e" }}>Einstieg</p>
              {priceLevels.entry_rationale && <p className="text-[10px] mt-0.5 leading-tight">{priceLevels.entry_rationale}</p>}
            </div>
            <div>
              <p className="font-bold" style={{ color: "#f59e0b" }}>{fmt(priceLevels.target)}</p>
              <p className="font-medium" style={{ color: "#f59e0b" }}>Kursziel</p>
              {priceLevels.target_rationale && <p className="text-[10px] mt-0.5 leading-tight">{priceLevels.target_rationale}</p>}
            </div>
            <div>
              <p className="font-bold" style={{ color: "#ef4444" }}>{fmt(priceLevels.stop_loss)}</p>
              <p className="font-medium" style={{ color: "#ef4444" }}>Stop-Loss</p>
            </div>
          </div>
        </div>
      )}

      {/* Bull / Bear */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="font-semibold mb-1" style={{ color: "#22c55e" }}>Bull-Case</p>
          <ul className="space-y-1">
            {bullCase.map((item, i) => (
              <li key={i} className="flex gap-1.5">
                <span style={{ color: "#22c55e" }}>✓</span>{item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-semibold mb-1" style={{ color: "#ef4444" }}>Bear-Case</p>
          <ul className="space-y-1">
            {bearCase.map((item, i) => (
              <li key={i} className="flex gap-1.5">
                <span style={{ color: "#ef4444" }}>✗</span>{item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Wachstumsausblick */}
      <div>
        <p className="font-semibold text-white mb-0.5">Wachstumsausblick</p>
        <p className="leading-relaxed">{data.growth_outlook}</p>
      </div>

      {/* Fundamental */}
      <div>
        <p className="font-semibold text-white mb-1">Fundamental · {data.fundamental_rating}/10</p>
        {positives.length > 0 && (
          <ul className="space-y-0.5 mb-1">
            {positives.map((p, i) => <li key={i} className="flex gap-1.5"><span style={{ color: "#22c55e" }}>+</span>{p}</li>)}
          </ul>
        )}
        {risks.length > 0 && (
          <ul className="space-y-0.5 mb-1">
            {risks.map((r, i) => <li key={i} className="flex gap-1.5"><span style={{ color: "#ef4444" }}>−</span>{r}</li>)}
          </ul>
        )}
        {data.valuation_comment && <p className="leading-relaxed italic">{data.valuation_comment}</p>}
      </div>

      {/* Nachrichtenstimmung */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-white mb-0.5">Nachrichtenstimmung</p>
          <p>{themes.slice(0, 4).join(" · ")}</p>
          {data.sentiment_summary && <p className="mt-0.5 leading-relaxed">{data.sentiment_summary}</p>}
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
          style={{ color: sentColor, background: sentColor + "22" }}>
          {SENTIMENT_LABEL[data.news_sentiment] ?? data.news_sentiment}
        </span>
      </div>

      {/* Markt-Signale */}
      {marketIntel && (
        <div>
          <p className="font-semibold text-white mb-1.5">Markt-Signale</p>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {[
              { key: marketIntel.insider_signal,      label: INSIDER_LABEL[marketIntel.insider_signal] },
              { key: marketIntel.institutional_trend,  label: INST_LABEL[marketIntel.institutional_trend] },
              { key: marketIntel.trends_momentum,      label: TREND_LABEL[marketIntel.trends_momentum] },
            ].map(({ key, label }) => label && (
              <span key={key + label} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ color: SIGNAL_COLOR[key] ?? "#6b7280", background: (SIGNAL_COLOR[key] ?? "#6b7280") + "22" }}>
                {label}
              </span>
            ))}
          </div>
          <ul className="space-y-0.5">
            {marketIntel.key_observations.slice(0, 4).map((obs, i) => (
              <li key={i}>· {obs}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Hauptkomponente ──────────────────────────────────────────────────────────

export function AnalysisHistoryCard({ symbol }: { symbol: string }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/ai-analysis/${symbol}/history`)
      .then(r => r.json())
      .then(data => { setHistory(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [symbol]);

  if (loaded && history.length === 0) return null;

  return (
    <div className="rounded-2xl border" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      {/* Header + Sparkline */}
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white">Score-Verlauf</h3>
          {loaded && history.length > 0 && (
            <button className="text-xs flex items-center gap-1" style={{ color: "var(--muted)" }}
              onClick={() => setOpen(v => !v)}>
              Details {open ? "▲" : "▼"}
            </button>
          )}
        </div>

        {!loaded && (
          <div className="h-14 rounded animate-pulse" style={{ background: "var(--card-border)" }} />
        )}
        {loaded && history.length >= 2 && <ScoreTrendChart entries={history} />}
        {loaded && history.length === 1 && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Eine Analyse vorhanden — nach weiteren Analysen erscheint hier ein Trend-Chart.
          </p>
        )}
      </div>

      {/* Aufklappbare Liste */}
      {open && loaded && history.length > 0 && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: "var(--card-border)" }}>
          <div className="pt-3 space-y-2">
            {history.map((entry) => {
              const color   = REC_COLOR[entry.recommendation] ?? "#6b7280";
              const date    = new Date(entry.analyzed_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
              const time    = new Date(entry.analyzed_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
              const isOpen  = expandedId === entry.id;

              return (
                <div key={entry.id} className="rounded-xl overflow-hidden"
                  style={{ background: "rgba(100,116,139,0.1)" }}>

                  {/* Klickbarer Header */}
                  <button
                    className="w-full p-3 text-left"
                    onClick={() => setExpandedId(isOpen ? null : entry.id)}>
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                          style={{ background: color + "22", color }}>
                          {entry.recommendation}
                        </span>
                        <span className="text-xs" style={{ color: "#a78bfa" }}>
                          {entry.conviction}/10
                        </span>
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          Fund. {entry.fundamental_rating}/10
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs" style={{ color: "var(--muted)" }}>{date} {time}</span>
                        <span className="text-xs" style={{ color: "var(--muted)" }}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {!isOpen && (
                      <p className="text-xs mt-1.5 leading-relaxed line-clamp-2 text-left"
                        style={{ color: "var(--muted)" }}>
                        {entry.summary}
                      </p>
                    )}
                  </button>

                  {/* Vollansicht */}
                  {isOpen && (
                    <div className="px-3 pb-3 border-t" style={{ borderColor: "var(--card-border)" }}>
                      <FullAnalysisView id={entry.id} symbol={symbol} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
