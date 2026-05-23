"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Diamond, TrendingUp, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

interface NHSource {
  agent: "US-Scout" | "DE-Scout" | "Podcast-Scout";
  name: string;
  title: string;
  url?: string;
  summary: string;
}

interface NHSelect {
  symbol: string;
  name: string;
  price: number | null;
  signal: string;
  score: number;
  theme: string;
  reason: string;
  sources: NHSource[];
  created_at: string;
}

const AGENT_LABEL: Record<NHSource["agent"], { flag: string; label: string }> = {
  "US-Scout":      { flag: "🇺🇸", label: "US-Scout" },
  "DE-Scout":      { flag: "🇩🇪", label: "DE-Scout" },
  "Podcast-Scout": { flag: "🎙", label: "Podcast-Scout" },
};

const AGENT_ORDER: NHSource["agent"][] = ["US-Scout", "DE-Scout", "Podcast-Scout"];

export function NHSelectCard() {
  const [pick, setPick] = useState<NHSelect | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    fetch("/api/nh-select")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.symbol) setPick(data); })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div
        className="rounded-2xl border p-4 space-y-3 animate-pulse"
        style={{ background: "var(--card)", borderColor: "rgba(99,102,241,0.3)" }}>
        <div className="h-3 w-20 rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-5 w-48 rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-4 w-full rounded" style={{ background: "var(--card-border)" }} />
      </div>
    );
  }

  if (!pick) {
    return (
      <div
        className="rounded-2xl border p-4 text-center"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <Diamond size={18} className="mx-auto mb-2" style={{ color: "var(--muted)" }} />
        <p className="text-sm font-medium text-white">NH Select noch nicht verfügbar</p>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          Startet täglich automatisch um 8:30 Uhr.
        </p>
      </div>
    );
  }

  const sourcesByAgent = AGENT_ORDER.map((agent) => ({
    agent,
    ...AGENT_LABEL[agent],
    sources: pick.sources.filter((s) => s.agent === agent),
  })).filter((g) => g.sources.length > 0);

  const totalSources = pick.sources.length;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(99,102,241,0.07) 0%, var(--card) 70%)",
        borderColor: "rgba(99,102,241,0.3)",
      }}>

      {/* Hauptkarte */}
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Diamond size={12} style={{ color: "#818cf8" }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#818cf8" }}>
            NH Select
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: "rgba(99,102,241,0.12)", color: "#a5b4fc" }}>
            {pick.theme}
          </span>
        </div>

        {/* Aktie */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xl font-bold text-white">{pick.symbol}</h3>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>
                {pick.signal}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                Score {pick.score}/100
              </span>
            </div>
            <p className="text-xs mt-0.5 truncate" style={{ color: "var(--muted)" }}>{pick.name}</p>
            {pick.price != null && (
              <p className="text-sm font-semibold text-white mt-1">${pick.price.toFixed(2)}</p>
            )}
          </div>
          <div
            className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: "rgba(99,102,241,0.12)" }}>
            <TrendingUp size={18} style={{ color: "#818cf8" }} />
          </div>
        </div>

        {/* Begründung */}
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
          {pick.reason}
        </p>

        {/* CTA */}
        <Link
          href={`/dashboard/asset/${pick.symbol}`}
          className="block w-full rounded-xl py-2 text-center text-sm font-semibold"
          style={{ background: "#6366f1", color: "#fff" }}>
          Details ansehen
        </Link>
      </div>

      {/* Quellen-Aufklapper */}
      <button
        onClick={() => setSourcesOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium transition-colors"
        style={{
          borderTop: "1px solid rgba(99,102,241,0.2)",
          color: sourcesOpen ? "#818cf8" : "var(--muted)",
          background: sourcesOpen ? "rgba(99,102,241,0.05)" : "transparent",
        }}>
        <span>{totalSources} Quellen analysiert</span>
        {sourcesOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {sourcesOpen && (
        <div
          className="px-4 pb-4 space-y-4"
          style={{ borderTop: "1px solid rgba(99,102,241,0.1)" }}>
          {sourcesByAgent.map((group) => (
            <div key={group.agent}>
              <p className="text-xs font-semibold mt-3 mb-2" style={{ color: "#a5b4fc" }}>
                {group.flag} {group.label} ({group.sources.length})
              </p>
              <div className="space-y-3">
                {group.sources.map((source, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-3 space-y-1"
                    style={{ background: "rgba(99,102,241,0.06)" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white">{source.name}</p>
                        <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--muted)" }}>
                          {source.title}
                        </p>
                      </div>
                      {source.url && (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 mt-0.5"
                          style={{ color: "#818cf8" }}>
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed pt-1" style={{ color: "var(--muted)", borderTop: "1px solid rgba(99,102,241,0.1)" }}>
                      {source.summary}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
