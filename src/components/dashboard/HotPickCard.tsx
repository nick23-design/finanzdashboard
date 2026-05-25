"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, RefreshCw, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { getNextWeekdayCron, formatCountdown } from "@/lib/time";

interface HotPick {
  symbol: string;
  name: string;
  price: number | null;
  signal: string;
  score: number;
  reason: string;
  created_at: string;
  is_agent_pick?: boolean;
}

export function HotPickCard() {
  const [pick, setPick] = useState<HotPick | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [noData, setNoData] = useState(false);
  const [finnCountdown, setFinnCountdown] = useState(() =>
    formatCountdown(getNextWeekdayCron(7, 0).getTime() - Date.now())
  );
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("hotpick_collapsed") === "1";
  });

  function toggleCollapse() {
    setCollapsed(v => {
      const next = !v;
      localStorage.setItem("hotpick_collapsed", next ? "1" : "0");
      return next;
    });
  }

  useEffect(() => {
    const id = setInterval(
      () => setFinnCountdown(formatCountdown(getNextWeekdayCron(7, 0).getTime() - Date.now())),
      10_000
    );
    return () => clearInterval(id);
  }, []);

  async function loadPick(force = false) {
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const url = force ? "/api/hot-pick?refresh=1" : "/api/hot-pick";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data?.symbol) {
          setPick(data);
          setNoData(false);
        } else {
          setNoData(true);
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { loadPick(); }, []);

  if (loading) {
    return (
      <div
        className="rounded-2xl border p-4 space-y-3 animate-pulse"
        style={{ background: "var(--card)", borderColor: "rgba(245,158,11,0.3)" }}>
        <div className="h-4 w-24 rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-7 w-36 rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-4 w-full rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-4 w-3/4 rounded" style={{ background: "var(--card-border)" }} />
      </div>
    );
  }

  if (noData) {
    return (
      <div
        className="rounded-2xl border p-4 text-center"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="flex justify-center mb-2">
          <AgentAvatar agent="finn" size="md" />
        </div>
        <p className="text-sm font-medium text-white">Finn recherchiert noch</p>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          Nächste autonome Analyse {finnCountdown ? `in ${finnCountdown}` : "täglich automatisch"} (Mo–Fr, 09:00 Uhr)
        </p>
      </div>
    );
  }

  if (!pick) return null;

  const isOld = Date.now() - new Date(pick.created_at).getTime() > 24 * 3600 * 1000;

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{
        background: "linear-gradient(135deg, rgba(245,158,11,0.07) 0%, var(--card) 70%)",
        borderColor: "rgba(245,158,11,0.35)",
      }}>
      {/* Header */}
      <div className="flex items-center justify-between cursor-pointer" onClick={toggleCollapse}>
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <AgentAvatar agent="finn" size="xs" />
          <Sparkles size={13} style={{ color: "#f59e0b" }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#f59e0b" }}>
            Hot Pick · Finn
          </span>
          {pick.is_agent_pick && !collapsed && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
              Autonome Analyse
            </span>
          )}
          {collapsed && (
            <span className="text-xs font-bold" style={{ color: "#f59e0b" }}>
              {pick.symbol} · Score {pick.score}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!collapsed && (
            <button
              onClick={e => { e.stopPropagation(); loadPick(true); }}
              disabled={refreshing}
              title="Neu berechnen"
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
      {/* Main content */}
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
              style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
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
          style={{ background: "rgba(245,158,11,0.12)" }}>
          <TrendingUp size={18} style={{ color: "#f59e0b" }} />
        </div>
      </div>

      {/* Reason */}
      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        {pick.reason}
      </p>

      {/* Actions */}
      <div className="flex gap-2">
        <Link
          href={`/dashboard/asset/${pick.symbol}`}
          className="flex-1 rounded-xl py-2 text-center text-sm font-semibold"
          style={{ background: "#f59e0b", color: "#000" }}>
          Details ansehen
        </Link>
      </div>

      {isOld && (
        <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
          Empfehlung vom {new Date(pick.created_at).toLocaleDateString("de-DE")} ·{" "}
          <button onClick={() => loadPick(true)} className="underline" style={{ color: "var(--primary)" }}>
            Aktualisieren
          </button>
        </p>
      )}
      {!isOld && finnCountdown && (
        <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
          Nächste Analyse in {finnCountdown}
        </p>
      )}
      </>}
    </div>
  );
}
