"use client";

import { useEffect, useState } from "react";
import type { OutcomeStats } from "@/app/api/outcomes/stats/route";

const OUTCOME_STYLE = {
  correct:   { label: "Korrekt",  color: "#22c55e", icon: "✓" },
  neutral:   { label: "Neutral",  color: "#ca8a04", icon: "~" },
  incorrect: { label: "Falsch",   color: "#ef4444", icon: "✗" },
};

const REC_SHORT: Record<string, string> = {
  "Kaufen":           "Kaufen",
  "Leicht kaufen":    "L. Kaufen",
  "Halten":           "Halten",
  "Leicht verkaufen": "L. Verk.",
  "Verkaufen":        "Verkaufen",
};

export function AccuracyCard() {
  const [stats, setStats] = useState<OutcomeStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/outcomes/stats")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div
        className="rounded-2xl border p-4 space-y-3 animate-pulse"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="h-4 w-32 rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-10 w-24 rounded" style={{ background: "var(--card-border)" }} />
      </div>
    );
  }

  const noData = !stats || stats.closed === 0;

  return (
    <div
      className="rounded-2xl border p-4 space-y-4"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">KI-Trefferquote</h3>
        {stats && stats.pending > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(202,138,4,0.12)", color: "#ca8a04" }}>
            {stats.pending} ausstehend
          </span>
        )}
      </div>

      {noData ? (
        <div className="text-center py-4 space-y-1">
          <p className="text-2xl">📊</p>
          <p className="text-sm font-medium text-white">Noch keine Daten</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Nach 30 Tagen werden abgeschlossene KI-Analysen automatisch ausgewertet.
          </p>
        </div>
      ) : (
        <>
          {/* Hauptzahl */}
          <div className="flex items-end gap-3">
            <div>
              <p
                className="text-4xl font-bold"
                style={{
                  color: stats!.accuracy_rate == null ? "var(--muted)"
                    : stats!.accuracy_rate >= 0.6 ? "#22c55e"
                    : stats!.accuracy_rate >= 0.4 ? "#ca8a04"
                    : "#ef4444",
                }}>
                {stats!.accuracy_rate != null
                  ? `${(stats!.accuracy_rate * 100).toFixed(0)}%`
                  : "—"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                Trefferquote ({stats!.correct + stats!.incorrect} bewertet)
              </p>
            </div>
          </div>

          {/* Balken */}
          {stats!.closed > 0 && (
            <div className="space-y-1.5">
              {(["correct", "neutral", "incorrect"] as const).map(k => {
                const count = stats![k];
                const pct = stats!.closed > 0 ? (count / stats!.closed) * 100 : 0;
                const s = OUTCOME_STYLE[k];
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span className="text-xs w-16 font-medium" style={{ color: s.color }}>
                      {s.icon} {s.label}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card-border)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: s.color }}
                      />
                    </div>
                    <span className="text-xs w-6 text-right font-medium text-white">{count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Letzte Ergebnisse */}
          {stats!.recent.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-white mb-2">Letzte Auswertungen</p>
              <div className="space-y-1.5">
                {stats!.recent.slice(0, 5).map((r, i) => {
                  const s = OUTCOME_STYLE[r.outcome as keyof typeof OUTCOME_STYLE];
                  const sign = r.return_pct >= 0 ? "+" : "";
                  return (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white w-12">{r.symbol}</span>
                        <span style={{ color: "var(--muted)" }}>{REC_SHORT[r.recommendation] ?? r.recommendation}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span style={{ color: r.return_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                          {sign}{r.return_pct.toFixed(1)}%
                        </span>
                        <span className="font-semibold" style={{ color: s?.color }}>
                          {s?.icon}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
