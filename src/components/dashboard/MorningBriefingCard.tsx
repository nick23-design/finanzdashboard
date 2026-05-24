"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Sunrise } from "lucide-react";
import type { MorningBriefing } from "@/app/api/morning-briefing/route";

export function MorningBriefingCard() {
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function load(force = false) {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const url = force ? "/api/morning-briefing?refresh=1" : "/api/morning-briefing";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        // No watchlist → hide the card silently
        if (res.status === 404) { setLoading(false); setRefreshing(false); return; }
        setError(data.error ?? "Fehler beim Laden");
      } else {
        setBriefing(data as MorningBriefing);
      }
    } catch {
      setError("Verbindungsfehler");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Don't render at all if no watchlist
  if (!loading && !briefing && !error) return null;

  if (loading) {
    return (
      <div
        className="rounded-2xl border p-4 space-y-3 animate-pulse"
        style={{ background: "var(--card)", borderColor: "rgba(99,102,241,0.3)" }}>
        <div className="h-3 w-28 rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-5 w-4/5 rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-3 w-full rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-3 w-3/4 rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-3 w-2/3 rounded" style={{ background: "var(--card-border)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-2xl border p-4 text-center"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <p className="text-xs" style={{ color: "#ef4444" }}>{error}</p>
        <button
          onClick={() => load(true)}
          className="mt-2 text-xs underline"
          style={{ color: "var(--primary)" }}>
          Nochmal versuchen
        </button>
      </div>
    );
  }

  if (!briefing) return null;

  const timeStr = new Date(briefing.generated_at).toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{
        background: "linear-gradient(135deg, rgba(99,102,241,0.07) 0%, var(--card) 70%)",
        borderColor: "rgba(99,102,241,0.35)",
      }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sunrise size={13} style={{ color: "#818cf8" }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#818cf8" }}>
            Morgen-Briefing
          </span>
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>{timeStr}</span>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          title="Aktualisieren"
          className="p-1 rounded-lg disabled:opacity-40"
          style={{ color: "var(--muted)" }}>
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Headline */}
      <p className="text-sm font-semibold text-white leading-snug">{briefing.headline}</p>

      {/* Market Overview */}
      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        {briefing.market_overview}
      </p>

      {/* Watchlist Highlights */}
      {briefing.watchlist_highlights.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#818cf8" }}>
            Deine Watchlist
          </p>
          <ul className="space-y-1">
            {briefing.watchlist_highlights.map((h, i) => (
              <li key={i} className="text-xs flex gap-1.5" style={{ color: "var(--muted)" }}>
                <span style={{ color: "#818cf8" }}>·</span>
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tages-Chance */}
      {briefing.daily_opportunity && (
        <div
          className="rounded-xl p-3 flex items-center justify-between gap-3"
          style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)" }}>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "#818cf8" }}>
              Tages-Chance
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-bold text-white">{briefing.daily_opportunity.symbol}</span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>{briefing.daily_opportunity.name}</span>
            </div>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
              {briefing.daily_opportunity.reason}
            </p>
          </div>
          <Link
            href={`/dashboard/asset/${briefing.daily_opportunity.symbol}`}
            className="flex-shrink-0 text-xs px-3 py-2 rounded-xl font-semibold"
            style={{ background: "#6366f1", color: "#fff" }}>
            Details
          </Link>
        </div>
      )}
    </div>
  );
}
