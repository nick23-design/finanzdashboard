"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Sunrise, ChevronDown, ChevronUp, Info } from "lucide-react";
import type { MorningBriefing, BriefingProtocol } from "@/app/api/morning-briefing/route";

function ProtocolSection({ protocol }: { protocol: BriefingProtocol }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[10px]"
        style={{ color: "var(--muted)" }}>
        <Info size={10} />
        Wie wurde dieses Briefing erstellt?
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && (
        <div className="mt-2 rounded-xl p-3 space-y-1.5 text-[10px]"
          style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)" }}>
          <div className="flex justify-between">
            <span style={{ color: "var(--muted)" }}>KI-Modell</span>
            <span className="text-white font-medium">Claude Haiku 4.5</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "var(--muted)" }}>Watchlist-Positionen</span>
            <span className="text-white font-medium">{protocol.watchlist_total}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "var(--muted)" }}>Marktindizes</span>
            <span className="text-white font-medium">{protocol.indices_count}</span>
          </div>
          {protocol.notable_symbols.length > 0 && (
            <div>
              <span style={{ color: "var(--muted)" }}>Auffällig (≥ 1,5 %)</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {protocol.notable_symbols.map(s => (
                  <span key={s} className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold"
                    style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c" }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {protocol.upcoming_earnings.length > 0 && (
            <div>
              <span style={{ color: "var(--muted)" }}>Earnings-Termine (14 Tage)</span>
              <ul className="mt-0.5 space-y-0.5">
                {protocol.upcoming_earnings.map((e, i) => (
                  <li key={i} className="text-white">{e}</li>
                ))}
              </ul>
            </div>
          )}
          {protocol.scores_used.length > 0 && (
            <div className="flex justify-between">
              <span style={{ color: "var(--muted)" }}>Scores einbezogen</span>
              <span className="text-white font-medium">{protocol.scores_used.join(", ")}</span>
            </div>
          )}
          {protocol.news_headlines.length > 0 && (
            <div>
              <span style={{ color: "var(--muted)" }}>Verwendete Schlagzeilen</span>
              <ul className="mt-0.5 space-y-0.5">
                {protocol.news_headlines.map((h, i) => (
                  <li key={i} className="leading-relaxed" style={{ color: "var(--muted)" }}>· {h}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MorningBriefingCard() {
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("briefing_collapsed") === "1";
  });

  function toggleCollapse() {
    setCollapsed(v => {
      const next = !v;
      localStorage.setItem("briefing_collapsed", next ? "1" : "0");
      return next;
    });
  }

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
      <div className="flex items-center justify-between cursor-pointer" onClick={toggleCollapse}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Sunrise size={13} style={{ color: "#818cf8" }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#818cf8" }}>
            Morgen-Briefing
          </span>
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>{timeStr}</span>
          {collapsed && (
            <span className="text-xs truncate ml-1" style={{ color: "var(--muted)" }}>
              · {briefing.headline}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!collapsed && (
            <button
              onClick={e => { e.stopPropagation(); load(true); }}
              disabled={refreshing}
              title="Aktualisieren"
              className="p-1 rounded-lg disabled:opacity-40"
              style={{ color: "var(--muted)" }}>
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            </button>
          )}
          {collapsed
            ? <ChevronDown size={14} style={{ color: "var(--muted)" }} />
            : <ChevronUp size={14} style={{ color: "var(--muted)" }} />}
        </div>
      </div>

      {collapsed ? null : <>
      {/* Headline */}
      <p className="text-sm font-semibold text-white leading-snug">{briefing.headline}</p>

      {/* Live Marktindizes */}
      {briefing.indices && briefing.indices.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {briefing.indices.map(idx => {
            const up = idx.change_pct != null && idx.change_pct >= 0;
            const color = idx.change_pct == null ? "var(--muted)"
              : idx.change_pct > 0 ? "#22c55e"
              : idx.change_pct < 0 ? "#ef4444"
              : "var(--muted)";
            return (
              <div key={idx.symbol}
                className="rounded-xl px-2.5 py-2"
                style={{ background: "rgba(99,102,241,0.08)" }}>
                <p className="text-[10px] font-medium" style={{ color: "var(--muted)" }}>{idx.name}</p>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-xs font-bold text-white">
                    {idx.price != null ? idx.price.toLocaleString("de-DE") : "—"}
                  </span>
                  {idx.change_pct != null && (
                    <span className="text-[10px] font-semibold" style={{ color }}>
                      {up ? "▲" : "▼"} {Math.abs(idx.change_pct).toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Market Overview */}
      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        {briefing.market_overview}
      </p>

      {/* Watchlist Highlights */}
      {briefing.watchlist_highlights.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#818cf8" }}>
            Watchlist-Signale
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

      {/* Idee des Tages */}
      {briefing.daily_opportunity && (
        <div
          className="rounded-xl p-3 flex items-center justify-between gap-3"
          style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)" }}>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "#818cf8" }}>
              Idee des Tages
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

      {/* Protokoll */}
      {briefing.protocol && <ProtocolSection protocol={briefing.protocol} />}
      </>}
    </div>
  );
}
