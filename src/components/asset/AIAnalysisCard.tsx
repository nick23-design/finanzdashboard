"use client";

import { useState } from "react";
import type { AIAnalysisResult, DianaQualityReport, PriceLevels, ProtocolEntry, AnalysisTraceEntry } from "@/app/api/ai-analysis/[symbol]/route";
import { AgentAvatar, AgentAvatarGroup } from "@/components/ui/AgentAvatar";

interface Props {
  analysis: AIAnalysisResult;
}

const RECOMMENDATION_STYLES: Record<string, { bg: string; text: string }> = {
  "Kaufen":          { bg: "#16a34a", text: "#ffffff" },
  "Leicht kaufen":   { bg: "#4ade80", text: "#14532d" },
  "Halten":          { bg: "#ca8a04", text: "#ffffff" },
  "Leicht verkaufen":{ bg: "#f97316", text: "#ffffff" },
  "Verkaufen":       { bg: "#dc2626", text: "#ffffff" },
};

const SENTIMENT_STYLES: Record<string, { label: string; color: string }> = {
  bullish:  { label: "Positiv",  color: "#22c55e" },
  neutral:  { label: "Neutral",  color: "#ca8a04" },
  bearish:  { label: "Negativ",  color: "#ef4444" },
};

const INSIDER_STYLES: Record<string, { label: string; color: string }> = {
  bullish: { label: "Insider kaufen", color: "#22c55e" },
  neutral: { label: "Insider neutral", color: "#ca8a04" },
  bearish: { label: "Insider verkaufen", color: "#ef4444" },
};

const INST_STYLES: Record<string, { label: string; color: string }> = {
  accumulating: { label: "Institutionen kaufen", color: "#22c55e" },
  stable:        { label: "Institutionen stabil", color: "#ca8a04" },
  reducing:      { label: "Institutionen reduzieren", color: "#ef4444" },
};

const TREND_STYLES: Record<string, { label: string; color: string }> = {
  rising:   { label: "Trends steigen", color: "#22c55e" },
  stable:   { label: "Trends stabil",  color: "#ca8a04" },
  declining:{ label: "Trends fallen",  color: "#ef4444" },
};

const ENTRY_QUALITY_STYLES: Record<string, { color: string }> = {
  attraktiv: { color: "#22c55e" },
  fair: { color: "#38bdf8" },
  überhitzt: { color: "#f97316" },
  "Rücksetzer abwarten": { color: "#f59e0b" },
  "nicht hinterherrennen": { color: "#ef4444" },
  "nur spekulativ": { color: "#ef4444" },
};

const VALUATION_CONFIDENCE_LABELS: Record<string, { label: string; color: string }> = {
  high: { label: "hoch", color: "#22c55e" },
  medium: { label: "mittel", color: "#f59e0b" },
  low: { label: "niedrig", color: "#ef4444" },
};

function currencySymbol(currency: string) {
  if (currency === "EUR") return "€";
  if (currency === "USD") return "$";
  return `${currency} `;
}

function formatMoney(value: number | null | undefined, currency: string) {
  if (value == null) return "—";
  return `${currencySymbol(currency)}${value.toFixed(2)}`;
}

const TRACE_STATUS_STYLES: Record<AnalysisTraceEntry["status"], { label: string; color: string }> = {
  running: { label: "läuft", color: "#f59e0b" },
  ok: { label: "ok", color: "#22c55e" },
  warning: { label: "Hinweis", color: "#f97316" },
  error: { label: "Fehler", color: "#ef4444" },
  timeout: { label: "Timeout", color: "#ef4444" },
};

function formatTraceDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function PriceLevelSection({ levels }: { levels: PriceLevels }) {
  const fmt = (n: number | null) => n != null ? `$${n.toFixed(2)}` : "—";
  return (
    <div
      className="rounded-xl p-3 space-y-2"
      style={{ background: "rgba(100,116,139,0.08)", border: "1px solid var(--card-border)" }}>
      <p className="text-xs font-semibold text-white">Kursziele</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-sm font-bold" style={{ color: "#22c55e" }}>{fmt(levels.entry)}</p>
          <p className="text-xs font-medium" style={{ color: "#22c55e" }}>Einstieg</p>
          {levels.entry_rationale && (
            <p className="text-[10px] mt-0.5 leading-tight" style={{ color: "var(--muted)" }}>
              {levels.entry_rationale}
            </p>
          )}
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: "#f59e0b" }}>{fmt(levels.target)}</p>
          <p className="text-xs font-medium" style={{ color: "#f59e0b" }}>Kursziel</p>
          {levels.target_rationale && (
            <p className="text-[10px] mt-0.5 leading-tight" style={{ color: "var(--muted)" }}>
              {levels.target_rationale}
            </p>
          )}
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: "#ef4444" }}>{fmt(levels.stop_loss)}</p>
          <p className="text-xs font-medium" style={{ color: "#ef4444" }}>Stop-Loss</p>
          <p className="text-[10px] mt-0.5 leading-tight" style={{ color: "var(--muted)" }}>
            Risikobegrenzung
          </p>
        </div>
      </div>
    </div>
  );
}

function ResearchStructureSection({ analysis }: { analysis: AIAnalysisResult }) {
  const entry = analysis.entry_quality;
  const entryStyle = entry ? ENTRY_QUALITY_STYLES[entry.label] ?? ENTRY_QUALITY_STYLES.fair : null;
  const valuation = analysis.valuation_confidence
    ? VALUATION_CONFIDENCE_LABELS[analysis.valuation_confidence] ?? VALUATION_CONFIDENCE_LABELS.low
    : null;

  if (!analysis.thesis_type && !entry && !valuation) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {analysis.thesis_type && (
        <div className="rounded-xl p-3" style={{ background: "rgba(100,116,139,0.08)", border: "1px solid var(--card-border)" }}>
          <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--muted)" }}>These</p>
          <p className="text-sm font-semibold text-white mt-1">{analysis.thesis_type}</p>
        </div>
      )}
      {entry && entryStyle && (
        <div className="rounded-xl p-3" style={{ background: `${entryStyle.color}12`, border: `1px solid ${entryStyle.color}35` }}>
          <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--muted)" }}>Entry Quality</p>
          <p className="text-sm font-semibold mt-1" style={{ color: entryStyle.color }}>{entry.label}</p>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>{entry.rationale}</p>
        </div>
      )}
      {valuation && (
        <div className="rounded-xl p-3" style={{ background: `${valuation.color}12`, border: `1px solid ${valuation.color}35` }}>
          <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--muted)" }}>Bewertung</p>
          <p className="text-sm font-semibold mt-1" style={{ color: valuation.color }}>Konfidenz {valuation.label}</p>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
            Szenario-Spanne statt punktgenauem Ziel.
          </p>
        </div>
      )}
    </div>
  );
}

function TimeHorizonSection({ view }: { view: NonNullable<AIAnalysisResult["time_horizon_view"]> }) {
  return (
    <div>
      <p className="text-xs font-semibold text-white mb-2">Zeithorizont</p>
      <div className="space-y-2">
        {[
          ["Kurzfristig", view.short_term],
          ["Mittelfristig", view.medium_term],
          ["Langfristig", view.long_term],
        ].map(([label, text]) => (
          <div key={label} className="rounded-xl p-3" style={{ background: "rgba(100,116,139,0.06)", border: "1px solid var(--card-border)" }}>
            <p className="text-[10px] uppercase font-semibold" style={{ color: "var(--muted)" }}>{label}</p>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValuationRangeSection({
  range,
  levels,
}: {
  range: NonNullable<AIAnalysisResult["valuation_range"]>;
  levels?: PriceLevels | null;
}) {
  const [currency, setCurrency] = useState<"USD" | "EUR">("USD");
  const selected = currency === "USD" ? range.usd : range.eur;
  const display = selected ?? (currency === range.currency ? range : null);
  const fxNote = range.fx_rate_source === "fallback"
    ? "FX-Fallback genutzt"
    : range.fx_rate_eur_usd
    ? `FX EUR/USD ${range.fx_rate_eur_usd.toFixed(4)}`
    : null;

  return (
    <div
      className="rounded-xl p-3 space-y-3"
      style={{ background: "rgba(100,116,139,0.08)", border: "1px solid var(--card-border)" }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-white">Bewertungsspanne</p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
            Bear / Base / Bull Case
          </p>
        </div>
        <div className="flex rounded-full p-0.5" style={{ background: "var(--card-border)" }}>
          {(["USD", "EUR"] as const).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setCurrency(c)}
              className="px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{
                background: currency === c ? "var(--primary)" : "transparent",
                color: currency === c ? "#000" : "var(--muted)",
              }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Bear", display?.bear ?? null, "#ef4444"],
          ["Base", display?.base ?? null, "#f59e0b"],
          ["Bull", display?.bull ?? null, "#22c55e"],
        ].map(([label, value, color]) => (
          <div key={label}>
            <p className="text-sm font-bold" style={{ color: String(color) }}>
              {formatMoney(value as number | null, currency)}
            </p>
            <p className="text-xs font-medium" style={{ color: String(color) }}>{label}</p>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {range.rationale}
      </p>

      {levels && (levels.entry != null || levels.stop_loss != null) && (
        <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t" style={{ borderColor: "var(--card-border)" }}>
          <div>
            <p style={{ color: "var(--muted)" }}>Timing-Einstieg</p>
            <p className="font-semibold text-white">{levels.entry != null ? levels.entry.toFixed(2) : "—"} {range.currency}</p>
          </div>
          <div>
            <p style={{ color: "var(--muted)" }}>Stop-Loss</p>
            <p className="font-semibold text-white">{levels.stop_loss != null ? levels.stop_loss.toFixed(2) : "—"} {range.currency}</p>
          </div>
        </div>
      )}

      {fxNote && (
        <p className="text-[10px]" style={{ color: "var(--muted)" }}>
          {fxNote}. Umrechnung ist nur Orientierung, kein Börsenkurs in dieser Währung.
        </p>
      )}
    </div>
  );
}

function ConvictionBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, (value / 10) * 100));
  const color = value >= 7 ? "#22c55e" : value >= 5 ? "#ca8a04" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 rounded-full h-2 overflow-hidden"
        style={{ background: "var(--card-border)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-xs font-semibold text-white">{value}/10</span>
    </div>
  );
}

function DataQualityBar({ dq }: { dq: DianaQualityReport }) {
  const pct = dq.completeness_score;
  const color = pct >= 70 ? "#22c55e" : pct >= 45 ? "#f59e0b" : "#ef4444";
  const label = pct >= 70 ? "Gut" : pct >= 45 ? "Lückenhaft" : "Schwach";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span style={{ color: "var(--muted)" }}>Datenbasis</span>
      <div className="flex-1 rounded-full h-1.5 overflow-hidden" style={{ background: "var(--card-border)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-semibold" style={{ color }}>{pct}/100</span>
      <span className="text-[10px]" style={{ color: "var(--muted)" }}>{label}</span>
      {dq.analysis_confidence_cap < 10 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ background: color + "22", color }}>
          Cap {dq.analysis_confidence_cap}/10
        </span>
      )}
    </div>
  );
}

function DataQualityGuardrails({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl p-3" style={{ background: "#f59e0b12", border: "1px solid #f59e0b35" }}>
      <p className="text-xs font-semibold mb-1.5" style={{ color: "#f59e0b" }}>Daten-Guardrails</p>
      <ul className="space-y-1">
        {items.slice(0, 4).map((item, i) => (
          <li key={i} className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            · {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

const PROTOCOL_STATUS: Record<ProtocolEntry["status"], { icon: string; color: string }> = {
  ok:      { icon: "✓", color: "#22c55e" },
  warning: { icon: "⚠", color: "#f59e0b" },
  skipped: { icon: "⊘", color: "#6b7280" },
};

function AnalysisProtocol({ entries }: { entries: ProtocolEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!entries.length) return null;
  const hasWarning = entries.some(e => e.status === "warning");
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--card-border)" }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        style={{ background: "rgba(100,116,139,0.06)" }}>
        <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
          Analyse-Protokoll
          {hasWarning && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "#f59e0b22", color: "#f59e0b" }}>
              Korrekturen
            </span>
          )}
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="px-3 py-2 space-y-1.5">
          {entries.map((e, i) => {
            const s = PROTOCOL_STATUS[e.status] ?? PROTOCOL_STATUS.skipped;
            return (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="font-bold mt-0.5 shrink-0" style={{ color: s.color }}>{s.icon}</span>
                <span className="font-semibold text-white shrink-0 w-12">{e.agent}</span>
                <span style={{ color: "var(--muted)" }}>{e.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AnalysisTrace({ trace }: { trace?: AnalysisTraceEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!trace?.length) return null;

  const hasProblem = trace.some(entry => ["warning", "error", "timeout"].includes(entry.status));

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--card-border)" }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        style={{ background: "rgba(100,116,139,0.06)" }}>
        <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
          Technisches Protokoll
          {hasProblem && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "#f59e0b22", color: "#f59e0b" }}>
              prüfen
            </span>
          )}
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="px-3 py-2 space-y-1.5">
          {trace.map((entry, i) => {
            const style = TRACE_STATUS_STYLES[entry.status] ?? TRACE_STATUS_STYLES.warning;
            return (
              <li key={`${entry.step}-${i}`} className="flex items-start gap-2 text-xs">
                <span
                  className="mt-1 h-2 w-2 rounded-full shrink-0"
                  style={{ background: style.color }}
                  aria-label={style.label}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-white truncate">{entry.label}</span>
                    <span className="shrink-0" style={{ color: style.color }}>
                      {entry.status === "running" ? style.label : formatTraceDuration(entry.duration_ms)}
                    </span>
                  </div>
                  {(entry.detail || entry.error) && (
                    <p className="mt-0.5 leading-relaxed" style={{ color: "var(--muted)" }}>
                      {entry.error ?? entry.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ClaimsSection({ claims }: { claims: NonNullable<AIAnalysisResult["claims"]> }) {
  const [open, setOpen] = useState(false);
  if (!claims.length) return null;
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--card-border)" }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        style={{ background: "rgba(100,116,139,0.06)" }}>
        <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
          Geprüfte Claims
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="px-3 py-2 space-y-2">
          {claims.slice(0, 6).map((claim, i) => (
            <li key={i} className="text-xs leading-relaxed">
              <p className="font-semibold text-white">{claim.claim}</p>
              <p style={{ color: "var(--muted)" }}>{claim.evidence}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                {claim.source_type} · Confidence {claim.confidence}/10
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type VeraReviewStatus = "running" | "failed" | "changed" | "verified";

const VERA_REVIEW_STATUS: Record<VeraReviewStatus, { label: string; detail: string; color: string }> = {
  running: {
    label: "Faktencheck läuft",
    detail: "Vera prüft die Analyse im Nachgang.",
    color: "#f59e0b",
  },
  failed: {
    label: "Faktencheck fehlgeschlagen",
    detail: "Die Hauptanalyse bleibt sichtbar; Vera konnte den Check nicht abschließen.",
    color: "#ef4444",
  },
  changed: {
    label: "Faktencheck durchgeführt",
    detail: "Vera hat Änderungen vorgenommen oder Fehler gefunden.",
    color: "#f97316",
  },
  verified: {
    label: "Faktencheck durchgeführt",
    detail: "Vera hat keine belegten Fehler gefunden.",
    color: "#22c55e",
  },
};

function getVeraReview(entries: ProtocolEntry[]): { status: VeraReviewStatus; entry: ProtocolEntry | null } {
  const entry = [...entries].reverse().find(e => e.agent === "Vera") ?? null;
  const detail = entry?.detail.toLowerCase() ?? "";

  if (!entry) {
    return { status: "failed", entry };
  }

  if (detail.includes("nachgelagert") || detail.includes("läuft")) {
    return { status: "running", entry };
  }

  if (
    entry.status === "ok" ||
    detail.includes("keine korrektur") ||
    detail.includes("keine belegten fehler") ||
    detail.includes("keine fehler")
  ) {
    return { status: "verified", entry };
  }

  if (entry.status === "warning" || detail.includes("korrektur") || detail.includes("fehler")) {
    return { status: "changed", entry };
  }

  return { status: "failed", entry };
}

function VeraReviewCard({ entries }: { entries: ProtocolEntry[] }) {
  const review = getVeraReview(entries);
  const cfg = VERA_REVIEW_STATUS[review.status];
  const isRunning = review.status === "running";

  return (
    <div
      className="rounded-xl p-3 flex items-start gap-3"
      style={{ background: `${cfg.color}12`, border: `1px solid ${cfg.color}40` }}>
      <div className="relative shrink-0">
        <AgentAvatar agent="vera" size="sm" working={isRunning} />
        <span
          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full"
          style={{ background: cfg.color, border: "2px solid var(--card)" }}
          aria-label={cfg.label}
        />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold text-white">Vera-Faktencheck</p>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{ color: cfg.color, background: `${cfg.color}22` }}>
            {cfg.label}
          </span>
        </div>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
          {review.entry?.detail ?? cfg.detail}
        </p>
      </div>
    </div>
  );
}

export function AIAnalysisCard({ analysis }: Props) {
  const recStyle = RECOMMENDATION_STYLES[analysis.recommendation] ?? {
    bg: "#6b7280",
    text: "#ffffff",
  };
  const sentStyle =
    SENTIMENT_STYLES[analysis.sentiment.sentiment] ?? SENTIMENT_STYLES.neutral;
  const dateStr = new Date(analysis.analyzed_at).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className="rounded-2xl border p-4 space-y-4"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">KI-Analyse</h3>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: "rgba(139,92,246,0.2)", color: "#a78bfa" }}>
          Beta
        </span>
      </div>

      {/* Recommendation + Conviction */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span
            className="px-3 py-1 rounded-full text-sm font-bold"
            style={{ background: recStyle.bg, color: recStyle.text }}>
            {analysis.recommendation}
          </span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Überzeugung
          </span>
        </div>
        <ConvictionBar value={analysis.conviction} />
        {analysis.data_quality && <DataQualityBar dq={analysis.data_quality} />}
      </div>

      <ResearchStructureSection analysis={analysis} />

      {analysis.data_quality_guardrails && (
        <DataQualityGuardrails items={analysis.data_quality_guardrails} />
      )}

      {/* Valuation */}
      {analysis.valuation_range ? (
        <ValuationRangeSection range={analysis.valuation_range} levels={analysis.price_levels} />
      ) : analysis.price_levels ? (
        <PriceLevelSection levels={analysis.price_levels} />
      ) : null}

      {/* Summary */}
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        {analysis.summary}
      </p>

      {analysis.time_horizon_view && (
        <TimeHorizonSection view={analysis.time_horizon_view} />
      )}

      {/* Bull / Bear */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold mb-1.5" style={{ color: "#22c55e" }}>
            Bull-Case
          </p>
          <ul className="space-y-1">
            {analysis.bull_case.map((item, i) => (
              <li key={i} className="text-xs flex gap-1.5" style={{ color: "var(--muted)" }}>
                <span style={{ color: "#22c55e" }}>✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold mb-1.5" style={{ color: "#ef4444" }}>
            Bear-Case
          </p>
          <ul className="space-y-1">
            {analysis.bear_case.map((item, i) => (
              <li key={i} className="text-xs flex gap-1.5" style={{ color: "var(--muted)" }}>
                <span style={{ color: "#ef4444" }}>✗</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Growth Outlook */}
      <div>
        <p className="text-xs font-semibold text-white mb-1">Wachstumsausblick</p>
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
          {analysis.growth_outlook}
        </p>
      </div>

      {/* News Sentiment */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-white mb-0.5">Nachrichtenstimmung</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {analysis.sentiment.key_themes.slice(0, 3).join(" · ")}
          </p>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{
            color: sentStyle.color,
            background: sentStyle.color + "22",
          }}>
          {sentStyle.label}
        </span>
      </div>

      {/* Market Intelligence */}
      {analysis.market_intel && (
        <div>
          <p className="text-xs font-semibold text-white mb-2">Markt-Signale</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {[
              INSIDER_STYLES[analysis.market_intel.insider_signal],
              INST_STYLES[analysis.market_intel.institutional_trend],
              TREND_STYLES[analysis.market_intel.trends_momentum],
            ].map((style, i) => style && (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ color: style.color, background: style.color + "22" }}>
                {style.label}
              </span>
            ))}
          </div>
          <ul className="space-y-0.5">
            {analysis.market_intel.key_observations.slice(0, 4).map((obs, i) => (
              <li key={i} className="text-xs" style={{ color: "var(--muted)" }}>
                · {obs}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Protocol */}
      {analysis.protocol?.length > 0 && (
        <AnalysisProtocol entries={analysis.protocol} />
      )}

      <AnalysisTrace trace={analysis.trace} />

      {analysis.claims && <ClaimsSection claims={analysis.claims} />}

      <VeraReviewCard entries={analysis.protocol ?? []} />

      {/* Footer – KI-Team */}
      <div className="pt-2 border-t" style={{ borderColor: "var(--card-border)" }}>
        <AgentAvatarGroup
          agents={["diana", "opus", "felix", "nina", "marco"]}
          size="xs"
          label={`Analysiert von Opus & Team · ${dateStr}${analysis.from_cache ? " · Gecacht" : ""}`}
        />
      </div>
    </div>
  );
}
