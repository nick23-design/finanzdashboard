"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Vera-Fakten-Check in der Analyse-Karte: manueller Trigger + Nutzer-Review.
 * Findings werden separat geladen (mit DB-id/review_status), damit der Nutzer
 * jedes Finding bestätigen (→ wirkt als Guardrail) oder ablehnen kann.
 */

interface Finding {
  id: string;
  claim: string;
  correction: string;
  issue_type: string;
  severity: "low" | "medium" | "high";
  confidence: number;
  review_status: string;
}

const SEV_COLOR: Record<string, string> = { low: "#6b7280", medium: "#f59e0b", high: "#ef4444" };

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_factcheck: { label: "Fakten-Check ausstehend", color: "#6b7280" },
  running_factcheck: { label: "Fakten-Check läuft…", color: "#f59e0b" },
  verified: { label: "Verifiziert", color: "#22c55e" },
  verified_with_warnings: { label: "Mit Hinweisen", color: "#f59e0b" },
  needs_revision: { label: "Überarbeitung empfohlen", color: "#f97316" },
  failed_factcheck: { label: "Fakten-Check fehlgeschlagen", color: "#ef4444" },
};

export function VeraFactCheckSection({
  symbol,
  initialStatus,
}: {
  symbol: string;
  initialStatus?: string | null;
}) {
  const [status, setStatus] = useState<string | null>(initialStatus ?? null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadFindings = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai-analysis/${symbol}/factcheck/findings`);
      if (res.ok) {
        const d = (await res.json()) as { findings?: Finding[] };
        setFindings(d.findings ?? []);
      }
    } catch {
      /* ignore */
    }
  }, [symbol]);

  useEffect(() => {
    void loadFindings();
  }, [loadFindings]);

  const runCheck = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-analysis/${symbol}/factcheck`, { method: "POST" });
      const d = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) {
        setError(d.error ?? "Fakten-Check fehlgeschlagen.");
      } else {
        setStatus(d.status ?? status);
        setExpanded(true);
        await loadFindings();
      }
    } catch {
      setError("Netzwerkfehler beim Fakten-Check.");
    } finally {
      setRunning(false);
    }
  };

  const review = async (findingId: string, action: "confirm" | "reject") => {
    const next = action === "confirm" ? "confirmed" : "rejected";
    setFindings(fs => fs.map(f => (f.id === findingId ? { ...f, review_status: next } : f)));
    try {
      await fetch(`/api/ai-analysis/${symbol}/factcheck/findings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, action }),
      });
    } catch {
      /* optimistisch — bei Fehler bleibt der lokale Zustand, Reload korrigiert */
    }
  };

  const cfg = status ? STATUS_LABEL[status] ?? STATUS_LABEL.pending_factcheck : null;
  const hasRun = status != null && status !== "pending_factcheck";

  return (
    <div
      className="rounded-xl p-3 space-y-2"
      style={{ background: "rgba(100,116,139,0.06)", border: "1px solid var(--card-border)" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-white">VERA Fakten-Check</p>
          {cfg && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ color: cfg.color, background: `${cfg.color}22` }}>
              {cfg.label}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={running}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-full disabled:opacity-60"
          style={{ background: "var(--primary)", color: "#000" }}>
          {running ? "Prüft…" : hasRun ? "Erneut prüfen" : "Fakten-Check starten"}
        </button>
      </div>

      {error && <p className="text-[11px]" style={{ color: "#ef4444" }}>{error}</p>}

      {findings.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-between text-left">
            <span className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
              {findings.length} Hinweis(e) · {findings.filter(f => f.review_status === "confirmed").length} übernommen
            </span>
            <span className="text-[10px]" style={{ color: "var(--muted)" }}>
              {expanded ? "▲ Einklappen" : "▼ Details"}
            </span>
          </button>

          {expanded && (
            <div className="space-y-2">
              {findings.map(f => {
                const color = SEV_COLOR[f.severity] ?? "#6b7280";
                return (
                  <div key={f.id} className="rounded-lg p-2.5 space-y-1.5"
                    style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ color, background: `${color}22` }}>
                        {f.severity}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--muted)" }}>{f.claim}</span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{f.correction}</p>
                    <div className="flex items-center justify-end gap-2">
                      {f.review_status === "confirmed" ? (
                        <span className="text-[10px] font-medium" style={{ color: "#22c55e" }}>✓ Übernommen</span>
                      ) : f.review_status === "rejected" ? (
                        <span className="text-[10px] font-medium" style={{ color: "var(--muted)" }}>✗ Abgelehnt</span>
                      ) : (
                        <>
                          <button type="button" onClick={() => review(f.id, "reject")}
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{ color: "var(--muted)", background: "var(--card-border)" }}>
                            Ablehnen
                          </button>
                          <button type="button" onClick={() => review(f.id, "confirm")}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ color: "#000", background: "#22c55e" }}>
                            Übernehmen
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
                Übernommene Hinweise fließen als Guardrails in künftige Analysen dieser Aktie ein.
              </p>
            </div>
          )}
        </>
      )}

      {hasRun && findings.length === 0 && !error && (
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>Keine Beanstandungen.</p>
      )}
    </div>
  );
}
