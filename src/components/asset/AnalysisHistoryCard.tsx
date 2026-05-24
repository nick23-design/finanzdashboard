"use client";

import { useEffect, useState } from "react";

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

function ScoreTrendChart({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length < 2) return null;

  // Chronological order for the chart
  const sorted = [...entries].reverse();

  const W = 300;
  const H = 60;
  const PAD = 10;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const xOf = (i: number) => PAD + (i / (sorted.length - 1)) * innerW;
  const yConviction = (v: number) => PAD + innerH - ((v - 1) / 9) * innerH;
  const yFundamental = (v: number) => PAD + innerH - ((v - 1) / 9) * innerH;

  // Conviction polyline
  const convPoints = sorted.map((e, i) => `${xOf(i)},${yConviction(e.conviction)}`).join(" ");
  // Fundamental polyline
  const fundPoints = sorted.map((e, i) => `${xOf(i)},${yFundamental(e.fundamental_rating)}`).join(" ");

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstDate = new Date(first.analyzed_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const lastDate = new Date(last.analyzed_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

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
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          {/* Grid lines at 3, 5, 7 */}
          {[3, 5, 7].map(v => (
            <line
              key={v}
              x1={PAD} y1={yConviction(v)} x2={W - PAD} y2={yConviction(v)}
              stroke="rgba(100,116,139,0.15)" strokeWidth="0.5"
            />
          ))}

          {/* Fundamental line */}
          <polyline
            points={fundPoints}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1.2"
            strokeOpacity="0.45"
            strokeDasharray="3 2"
          />

          {/* Conviction line */}
          <polyline
            points={convPoints}
            fill="none"
            stroke="#a78bfa"
            strokeWidth="1.8"
          />

          {/* Dots — colored by recommendation */}
          {sorted.map((e, i) => {
            const cx = xOf(i);
            const cy = yConviction(e.conviction);
            const color = REC_COLOR[e.recommendation] ?? "#6b7280";
            const isLast = i === sorted.length - 1;
            return (
              <g key={e.id}>
                {isLast && (
                  <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity="0.2" />
                )}
                <circle
                  cx={cx} cy={cy}
                  r={isLast ? 3.5 : 2.5}
                  fill={color}
                  stroke={isLast ? "white" : "transparent"}
                  strokeWidth={isLast ? 1 : 0}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Date labels */}
      <div className="flex justify-between px-0.5">
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>{firstDate}</span>
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>{lastDate}</span>
      </div>

      {/* Latest conviction value */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
          Letzte {sorted.length} Analysen
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              color: REC_COLOR[last.recommendation] ?? "#6b7280",
              background: (REC_COLOR[last.recommendation] ?? "#6b7280") + "22",
            }}>
            {last.recommendation}
          </span>
          <span className="text-[10px] font-semibold" style={{ color: "#a78bfa" }}>
            {last.conviction}/10
          </span>
          <span
            className="text-[10px]"
            style={{ color: SENTIMENT_COLOR[last.news_sentiment] ?? "var(--muted)" }}>
            {last.news_sentiment === "bullish" ? "↑ Positiv" : last.news_sentiment === "bearish" ? "↓ Negativ" : "= Neutral"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AnalysisHistoryCard({ symbol }: { symbol: string }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load eagerly so the chart is always visible
  useEffect(() => {
    fetch(`/api/ai-analysis/${symbol}/history`)
      .then(r => r.json())
      .then(data => { setHistory(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [symbol]);

  if (loaded && history.length === 0) return null;

  return (
    <div
      className="rounded-2xl border"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      {/* Always-visible header + chart */}
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white">Score-Verlauf</h3>
          {loaded && history.length > 0 && (
            <button
              className="text-xs flex items-center gap-1"
              style={{ color: "var(--muted)" }}
              onClick={() => setOpen(v => !v)}>
              Details {open ? "▲" : "▼"}
            </button>
          )}
        </div>

        {!loaded && (
          <div className="h-14 rounded animate-pulse" style={{ background: "var(--card-border)" }} />
        )}

        {loaded && history.length >= 2 && (
          <ScoreTrendChart entries={history} />
        )}

        {loaded && history.length === 1 && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Eine Analyse vorhanden — nach weiteren Analysen erscheint hier ein Trend-Chart.
          </p>
        )}
      </div>

      {/* Expandable list */}
      {open && loaded && history.length > 0 && (
        <div className="px-4 pb-4 space-y-2 border-t" style={{ borderColor: "var(--card-border)" }}>
          <div className="pt-3 space-y-2">
            {history.map((entry) => {
              const color = REC_COLOR[entry.recommendation] ?? "#6b7280";
              const date = new Date(entry.analyzed_at).toLocaleDateString("de-DE", {
                day: "2-digit", month: "2-digit", year: "2-digit",
              });
              return (
                <div
                  key={entry.id}
                  className="rounded-xl p-3 space-y-1.5"
                  style={{ background: "rgba(100,116,139,0.1)" }}>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ background: color + "22", color }}>
                      {entry.recommendation}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: "#a78bfa" }}>
                        Überzeugung {entry.conviction}/10
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>·</span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        Fundamental {entry.fundamental_rating}/10
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        {date}
                      </span>
                    </div>
                  </div>
                  <p
                    className="text-xs leading-relaxed line-clamp-2"
                    style={{ color: "var(--muted)" }}>
                    {entry.summary}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
