"use client";

import { useEffect, useState } from "react";
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
import { fetchEarningsCalendar } from "@/lib/finance-client";
import type { EarningsCalendar } from "@/lib/finance-client";
import type { SignalType } from "@/types/finance";
import type { AIAnalysisResult } from "@/app/api/ai-analysis/[symbol]/route";

interface AssetDetailViewProps {
  symbol: string;
}

export function AssetDetailView({ symbol }: AssetDetailViewProps) {
  const [asset, setAsset] = useState<AssetSnapshot | null>(null);
  const [score, setScore] = useState<AnalysisScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<EarningsCalendar | null>(null);

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

  const formatBigNum = (n: number | null) => {
    if (n === null) return null;
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)} T`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} Mrd.`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)} Mio.`;
    return n.toFixed(0);
  };

  return (
    <div className="space-y-4">
      {/* Back */}
      <Link href="/dashboard" className="text-sm flex items-center gap-1"
        style={{ color: "var(--muted)" }}>
        ← Watchlist
      </Link>

      {/* Hero */}
      <div
        className="rounded-2xl border p-4"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-2xl font-bold text-white">{symbol}</h2>
            <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>
              {asset?.currency ?? ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-white">
              {asset?.price != null ? asset.price.toFixed(2) : "—"}
            </p>
          </div>
        </div>

        {score && (
          <div className="mt-3">
            <ScoreBadge signal={score.signal as SignalType} score={score.total_score} size="lg" />
          </div>
        )}
      </div>

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
            {aiLoading ? "Analysiere… (ca. 20 Sek.)" : "KI-Analyse starten"}
          </button>
        </div>
      )}

      {aiAnalysis && <AIAnalysisCard analysis={aiAnalysis} />}

      {/* Earnings Calendar */}
      {earnings && <EarningsCard earnings={earnings} />}

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
