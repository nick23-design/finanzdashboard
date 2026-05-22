"use client";

import { useEffect, useState } from "react";

interface HistoryEntry {
  id: string;
  recommendation: string;
  conviction: number;
  summary: string;
  analyzed_at: string;
}

const REC_COLOR: Record<string, string> = {
  "Kaufen": "#16a34a",
  "Leicht kaufen": "#4ade80",
  "Halten": "#ca8a04",
  "Leicht verkaufen": "#f97316",
  "Verkaufen": "#dc2626",
};

export function AnalysisHistoryCard({ symbol }: { symbol: string }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    fetch(`/api/ai-analysis/${symbol}/history`)
      .then(r => r.json())
      .then(data => { setHistory(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [open, symbol, loaded]);

  return (
    <div
      className="rounded-2xl border"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <button
        className="w-full flex items-center justify-between p-4"
        onClick={() => setOpen(v => !v)}>
        <h3 className="font-semibold text-white">Analyse-Verlauf</h3>
        <span style={{ color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {!loaded && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Lädt…
            </p>
          )}
          {loaded && history.length === 0 && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Noch keine Analyse-Geschichte vorhanden.
            </p>
          )}
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
                <div className="flex items-center justify-between">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: color + "22", color }}>
                    {entry.recommendation}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {entry.conviction}/10
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
      )}
    </div>
  );
}
