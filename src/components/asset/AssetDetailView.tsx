"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { AssetSnapshot, AnalysisScore } from "@/types/database";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { ScoreBar } from "@/components/ui/ScoreBar";
import { MetricCard } from "@/components/ui/MetricCard";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { PriceChart } from "./PriceChart";
import { AIAnalysisCard } from "./AIAnalysisCard";
import { EarningsCard } from "./EarningsCard";
import { AnalysisHistoryCard } from "./AnalysisHistoryCard";
import { AssetNewsCard } from "./AssetNewsCard";
import { fetchEarningsCalendar } from "@/lib/finance-client";
import type { EarningsCalendar } from "@/lib/finance-client";
import type { SignalType } from "@/types/finance";
import type { AIAnalysisResult } from "@/app/api/ai-analysis/[symbol]/route";
import { formatCountdown, formatRelativeTime } from "@/lib/time";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { Bell } from "lucide-react";

// ── Quick Alert ───────────────────────────────────────────────────────────────

interface QuickAlertProps {
  symbol: string;
  name: string;
  currentPrice: number | null;
}

function QuickAlertSection({ symbol, name, currentPrice }: QuickAlertProps) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"above" | "below">("below");
  const [targetPrice, setTargetPrice] = useState(currentPrice?.toFixed(2) ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!targetPrice) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol, name,
          target_price: parseFloat(targetPrice),
          direction,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehler");
      setSaved(true);
      setTimeout(() => { setSaved(false); setOpen(false); }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  const isBelow = direction === "below";
  const activeColor = isBelow ? "#22c55e" : "#fb923c";
  const activeBg   = isBelow ? "rgba(34,197,94,0.15)" : "rgba(251,146,60,0.15)";

  return (
    <div>
      {/* Trigger button — visible bar below hero */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border font-semibold text-sm transition-all"
        style={{
          background: open ? "rgba(168,85,247,0.12)" : "var(--card)",
          borderColor: open ? "#a855f7" : "var(--card-border)",
          color: open ? "#c084fc" : "var(--primary)",
        }}>
        <Bell size={14} />
        {open ? "Alarm schließen" : "🔔 Kurs-Alarm setzen"}
      </button>

      {/* Expanded form */}
      {open && (
        <div className="mt-2 rounded-2xl border p-4 space-y-3"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          {saved ? (
            <p className="text-sm font-semibold text-center py-2" style={{ color: "#22c55e" }}>
              ✓ Alarm gespeichert
            </p>
          ) : (
            <>
              {error && <p className="text-xs pt-2" style={{ color: "#ef4444" }}>{error}</p>}

              {/* Direction toggle */}
              <div className="flex gap-2 pt-3">
                {(["below", "above"] as const).map(dir => {
                  const active = direction === dir;
                  const color = dir === "below" ? "#22c55e" : "#fb923c";
                  const bg    = dir === "below" ? "rgba(34,197,94,0.15)" : "rgba(251,146,60,0.15)";
                  return (
                    <button key={dir} type="button"
                      onClick={() => setDirection(dir)}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold border transition-all"
                      style={{
                        background: active ? bg : "var(--background)",
                        borderColor: active ? color : "var(--card-border)",
                        color: active ? color : "var(--muted)",
                      }}>
                      {dir === "below" ? "Kauf-Alarm" : "Verkauf-Alarm"}
                      <br />
                      <span className="text-[10px] font-normal opacity-70">
                        {dir === "below" ? "fällt unter" : "steigt über"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Price input */}
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {symbol} {isBelow ? "fällt unter" : "steigt über"}
                </span>
                <div className="flex items-center rounded-xl border px-3 py-1.5 flex-1"
                  style={{ background: "var(--background)", borderColor: activeColor }}>
                  <span className="text-sm font-semibold mr-1" style={{ color: activeColor }}>$</span>
                  <input
                    type="number" step="any" min="0"
                    value={targetPrice}
                    onChange={e => setTargetPrice(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-white outline-none"
                    style={{ caretColor: activeColor }}
                  />
                </div>
              </div>

              <button
                onClick={handleSave}
                disabled={submitting || !targetPrice}
                className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: activeBg, color: activeColor, border: `1px solid ${activeColor}` }}>
                {submitting ? "Speichern…" : "Alarm speichern"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const AI_STEPS = [
  "Marktdaten werden geladen…",
  "Fundamental-Analyse läuft…",
  "Technische Analyse läuft…",
  "Risikobewertung läuft…",
  "Synthese der Ergebnisse…",
];
function aiStep(p: number) {
  if (p < 18) return AI_STEPS[0];
  if (p < 40) return AI_STEPS[1];
  if (p < 62) return AI_STEPS[2];
  if (p < 82) return AI_STEPS[3];
  return AI_STEPS[4];
}

interface AssetDetailViewProps {
  symbol: string;
}

export function AssetDetailView({ symbol }: AssetDetailViewProps) {
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const backHref = from === "nh-select" ? "/dashboard/search" : "/dashboard";
  const backLabel = from === "nh-select" ? "← NH Select" : "← Watchlist";

  const [asset, setAsset] = useState<AssetSnapshot | null>(null);
  const [score, setScore] = useState<AnalysisScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState(0);
  const [earnings, setEarnings] = useState<EarningsCalendar | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [assetRes, scoreRes] = await Promise.all([
          fetch(`/api/assets/${symbol}`),
          fetch(`/api/analyze/${symbol}`, { method: "POST" }),
        ]);

        fetchEarningsCalendar(symbol).then(e => { if (e) setEarnings(e); }).catch(() => null);

        if (cancelled) return;

        if (!assetRes.ok) {
          const body = await assetRes.json().catch(() => ({}));
          throw new Error(body.error ?? "Datenabruf fehlgeschlagen");
        }

        const assetData = await assetRes.json();
        const scoreData = scoreRes.ok ? await scoreRes.json() : null;

        setAsset(assetData);
        setScore(scoreData);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unbekannter Fehler");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [symbol]);

  // Silent price refresh every 60 s (returns from Supabase cache instantly until TTL expires)
  useEffect(() => {
    const id = setInterval(async () => {
      setRefreshing(true);
      try {
        const res = await fetch(`/api/assets/${symbol}`);
        if (res.ok) setAsset(await res.json());
      } catch { /* ignore */ }
      setRefreshing(false);
    }, 60_000);
    return () => clearInterval(id);
  }, [symbol]);

  // Ticker for countdown display (every 10 s is enough for hh:mm precision)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // AI progress animation
  useEffect(() => {
    if (!aiLoading) { setAiProgress(0); return; }
    setAiProgress(0);
    const id = setInterval(() => setAiProgress(p => Math.min(p + 0.45, 90)), 100);
    return () => clearInterval(id);
  }, [aiLoading]);

  async function runAIAnalysis() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/ai-analysis/${symbol}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "KI-Analyse fehlgeschlagen");
      setAiAnalysis(data as AIAnalysisResult);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="w-32" height="h-7" />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-2xl border p-6 text-center"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <p className="text-3xl mb-2">⚠️</p>
        <p className="text-white font-medium">{error}</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm underline"
          style={{ color: "var(--primary)" }}>
          Zurück zur Watchlist
        </Link>
      </div>
    );
  }

  const cacheExpiresAt = asset?.fetched_at
    ? new Date(asset.fetched_at).getTime() + 6 * 3_600_000
    : null;
  const cacheRemainingMs = cacheExpiresAt ? cacheExpiresAt - now : null;

  const formatBigNum = (n: number | null) => {
    if (n === null) return null;
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)} T`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} Mrd.`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)} Mio.`;
    return n.toFixed(0);
  };

  return (
    <div className="space-y-4">
      {/* Back + Alerts */}
      <div className="flex items-center justify-between">
        <Link href={backHref} className="text-sm flex items-center gap-1"
          style={{ color: "var(--muted)" }}>
          {backLabel}
        </Link>
        <Link
          href="/dashboard/alerts"
          className="flex items-center justify-center w-8 h-8 rounded-full transition-colors"
          style={{ background: "var(--card-border)", color: "var(--muted)" }}
          title="Alarm-Übersicht">
          <Bell size={15} />
        </Link>
      </div>

      {/* Hero */}
      <div
        className="rounded-2xl border p-4"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-2xl font-bold text-white">{symbol}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {asset?.currency ?? ""}
              </p>
              {asset?.isin && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-mono"
                  style={{ background: "var(--card-border)", color: "var(--muted)" }}>
                  {asset.isin}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-white">
              {asset?.price != null ? asset.price.toFixed(2) : "—"}
            </p>
            {asset?.fetched_at && (
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                {refreshing
                  ? "Aktualisiere…"
                  : cacheRemainingMs != null && cacheRemainingMs > 0
                  ? `${formatRelativeTime(asset.fetched_at)} · in ${formatCountdown(cacheRemainingMs)}`
                  : formatRelativeTime(asset.fetched_at)}
              </p>
            )}
          </div>
        </div>

        {score && (
          <div className="mt-3">
            <ScoreBadge signal={score.signal as SignalType} score={score.total_score} size="lg" />
          </div>
        )}
      </div>

      {/* Quick Alert */}
      <QuickAlertSection
        symbol={symbol}
        name={(asset as unknown as { name?: string })?.name ?? symbol}
        currentPrice={asset?.price ?? null}
      />

      {/* Score Card */}
      {score && (
        <div
          className="rounded-2xl border p-4 space-y-3"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <h3 className="font-semibold text-white">Analyse-Score</h3>
          <ScoreBar label="Gesamt" score={score.total_score} />
          <ScoreBar label="Fundamental (40%)" score={score.fundamental_score} />
          <ScoreBar label="Technisch (30%)" score={score.technical_score} />
          <ScoreBar label="Risiko (30%)" score={score.risk_score} />
          <details className="text-xs" style={{ color: "var(--muted)" }}>
            <summary className="cursor-pointer font-medium">Erklärung anzeigen</summary>
            <p className="mt-2 leading-relaxed">{score.explanation}</p>
          </details>
        </div>
      )}

      {/* Unternehmensbeschreibung */}
      {asset?.description && (
        <div
          className="rounded-2xl border p-4"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <h3 className="font-semibold text-white mb-2">Über das Unternehmen</h3>
          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            {asset.description}
          </p>
        </div>
      )}

      {/* AI Analysis */}
      {!aiAnalysis && (
        <div
          className="rounded-2xl border p-4"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-semibold text-white">KI-Analyse</h3>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                Tiefgehende Analyse durch mehrere KI-Agenten
              </p>
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(139,92,246,0.2)", color: "#a78bfa" }}>
              Beta
            </span>
          </div>
          {aiError && (
            <p className="text-xs mb-3" style={{ color: "#ef4444" }}>
              {aiError}
            </p>
          )}
          <button
            onClick={runAIAnalysis}
            disabled={aiLoading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-60"
            style={{ background: "var(--primary)", color: "#000" }}>
            {aiLoading ? "Analysiere…" : "KI-Analyse starten"}
          </button>
          {aiLoading && (
            <div className="space-y-2 mt-2">
              {/* Active agents */}
              <div className="flex items-center gap-3 justify-center flex-wrap">
                <AgentAvatar agent="opus" size="sm" showName working />
                <AgentAvatar agent="felix" size="sm" showName working />
                <AgentAvatar agent="nina" size="sm" showName working />
                <AgentAvatar agent="marco" size="sm" showName working />
              </div>
              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card-border)" }}>
                <div
                  className="h-full rounded-full transition-all duration-100"
                  style={{ width: `${aiProgress}%`, background: "var(--primary)" }}
                />
              </div>
              <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
                {aiStep(aiProgress)}
              </p>
            </div>
          )}
        </div>
      )}

      {aiAnalysis && <AIAnalysisCard analysis={aiAnalysis} />}

      {/* Earnings Calendar */}
      {earnings && <EarningsCard earnings={earnings} />}

      {/* News */}
      <AssetNewsCard symbol={symbol} />

      {/* Analysis History */}
      <AnalysisHistoryCard symbol={symbol} />

      {/* Chart */}
      <PriceChart symbol={symbol} />

      {/* Fundamental Metrics */}
      <div
        className="rounded-2xl border p-4"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <h3 className="font-semibold text-white mb-3">Kennzahlen</h3>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            label="KGV (P/E)"
            value={asset?.pe_ratio?.toFixed(1) ?? null}
            highlight={
              asset?.pe_ratio == null ? "neutral"
              : asset.pe_ratio <= 20 ? "good"
              : asset.pe_ratio > 40 ? "bad"
              : "neutral"
            }
          />
          <MetricCard
            label="Marktkapitalisierung"
            value={formatBigNum(asset?.market_cap ?? null)}
          />
          <MetricCard
            label="Free Cashflow"
            value={formatBigNum(asset?.free_cashflow ?? null)}
            highlight={
              asset?.free_cashflow == null ? "neutral"
              : asset.free_cashflow > 0 ? "good" : "bad"
            }
          />
          <MetricCard
            label="Umsatzwachstum"
            value={
              asset?.revenue_growth != null
                ? `${(asset.revenue_growth * 100).toFixed(1)}`
                : null
            }
            unit="%"
            highlight={
              asset?.revenue_growth == null ? "neutral"
              : asset.revenue_growth > 0.1 ? "good"
              : asset.revenue_growth < 0 ? "bad"
              : "neutral"
            }
          />
        </div>
      </div>

      {/* Technical Metrics */}
      <div
        className="rounded-2xl border p-4"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <h3 className="font-semibold text-white mb-3">Technische Daten</h3>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            label="RSI (14)"
            value={asset?.rsi?.toFixed(1) ?? null}
            highlight={
              asset?.rsi == null ? "neutral"
              : asset.rsi < 30 ? "good"
              : asset.rsi > 70 ? "bad"
              : "neutral"
            }
            hint={
              asset?.rsi != null
                ? asset.rsi < 30 ? "Überverkauft"
                : asset.rsi > 70 ? "Überkauft"
                : "Normal"
                : undefined
            }
          />
          <MetricCard
            label="Debt/Equity"
            value={asset?.debt_to_equity?.toFixed(2) ?? null}
            highlight={
              asset?.debt_to_equity == null ? "neutral"
              : asset.debt_to_equity < 0.5 ? "good"
              : asset.debt_to_equity > 2 ? "bad"
              : "neutral"
            }
          />
          <MetricCard
            label="50-Tage-MA"
            value={asset?.moving_average_50?.toFixed(2) ?? null}
          />
          <MetricCard
            label="200-Tage-MA"
            value={asset?.moving_average_200?.toFixed(2) ?? null}
          />
        </div>
      </div>

      {/* Disclaimer */}
      <Disclaimer />

      <p className="text-xs text-center pb-2" style={{ color: "var(--muted)" }}>
        Daten abgerufen: {asset?.fetched_at ? new Date(asset.fetched_at).toLocaleString("de-DE") : "—"}
      </p>
    </div>
  );
}
