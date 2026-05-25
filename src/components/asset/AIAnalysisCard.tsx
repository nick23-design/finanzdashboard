"use client";

import { useState } from "react";
import type { AIAnalysisResult, PriceLevels, ProtocolEntry } from "@/app/api/ai-analysis/[symbol]/route";
import { AgentAvatarGroup } from "@/components/ui/AgentAvatar";

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
      </div>

      {/* Price Levels */}
      {analysis.price_levels && (
        <PriceLevelSection levels={analysis.price_levels} />
      )}

      {/* Summary */}
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        {analysis.summary}
      </p>

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

      {/* Footer – KI-Team */}
      <div className="pt-2 border-t" style={{ borderColor: "var(--card-border)" }}>
        <AgentAvatarGroup
          agents={["opus", "felix", "nina", "marco"]}
          size="xs"
          label={`Analysiert von Opus & Team · ${dateStr}${analysis.from_cache ? " · Gecacht" : ""}`}
        />
      </div>
    </div>
  );
}
