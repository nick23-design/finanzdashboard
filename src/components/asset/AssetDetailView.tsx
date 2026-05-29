"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import type { EarningsCalendar } from "@/lib/finance-client";
import type { SignalType } from "@/types/finance";
import type { AIAnalysisResult, AnalysisTraceEntry } from "@/app/api/ai-analysis/[symbol]/route";
import { formatCountdown, formatRelativeTime } from "@/lib/time";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { Bell, TrendingUp, RotateCw, Newspaper, Info } from "lucide-react";
import type { PortfolioGroup } from "@/app/api/portfolio/route";
import { PeersSection } from "./PeersSection";

// ── Portfolio Position ────────────────────────────────────────────────────────

type PosPeriod = "all" | "1mo" | "3mo" | "6mo" | "1y";
const POS_PERIODS: { id: PosPeriod; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "1mo", label: "1M" },
  { id: "3mo", label: "3M" },
  { id: "6mo", label: "6M" },
  { id: "1y",  label: "1J" },
];

function PortfolioPositionSection({ symbol }: { symbol: string }) {
  const [group, setGroup] = useState<PortfolioGroup | null>(null);
  const [period, setPeriod] = useState<PosPeriod>("all");
  const [startPrice, setStartPrice] = useState<number | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  useEffect(() => {
    fetch("/api/portfolio")
      .then(r => r.ok ? r.json() : null)
      .then((data: { groups: PortfolioGroup[] } | null) => {
        if (!data) return;
        setGroup(data.groups.find(g => g.symbol === symbol) ?? null);
      })
      .catch(() => {});
  }, [symbol]);

  useEffect(() => {
    if (period === "all") { setStartPrice(null); return; }
    setHistLoading(true);
    fetch(`/api/assets/${symbol}/history?period=${period}`)
      .then(r => r.ok ? r.json() : [])
      .then((pts: { time: string; value: number }[]) => setStartPrice(pts[0]?.value ?? null))
      .catch(() => setStartPrice(null))
      .finally(() => setHistLoading(false));
  }, [period, symbol]);

  if (!group) return null;

  const isAll = period === "all";
  let displayPnl: number | null = null;
  let displayPct: number | null = null;
  if (isAll) {
    displayPnl = group.pnl;
    displayPct = group.pnl_pct;
  } else if (startPrice != null && group.current_price != null) {
    displayPct = (group.current_price - startPrice) / startPrice * 100;
    displayPnl = group.total_shares * (group.current_price - startPrice);
  }

  const pnlColor = displayPnl == null ? "var(--muted)" : displayPnl >= 0 ? "#22c55e" : "#ef4444";
  const dayColor = group.day_change_pct == null ? "var(--muted)" : group.day_change_pct >= 0 ? "#22c55e" : "#ef4444";

  return (
    <div className="rounded-2xl border p-4"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} style={{ color: "var(--primary)" }} />
          <h3 className="font-semibold text-white text-sm">Meine Position</h3>
        </div>
        <Link href="/dashboard/portfolio" className="text-xs" style={{ color: "var(--muted)" }}>
          Portfolio →
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs mb-3">
        <div>
          <p style={{ color: "var(--muted)" }}>Aktien</p>
          <p className="font-semibold text-white mt-0.5">{group.total_shares}</p>
        </div>
        <div>
          <p style={{ color: "var(--muted)" }}>Ø Kauf</p>
          <p className="font-semibold text-white mt-0.5">${group.avg_purchase_price.toFixed(2)}</p>
        </div>
        <div>
          <p style={{ color: "var(--muted)" }}>Wert</p>
          <p className="font-semibold text-white mt-0.5">
            {group.current_value != null ? `$${group.current_value.toFixed(2)}` : "—"}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--muted)" }}>Heute</p>
          <p className="font-semibold mt-0.5" style={{ color: dayColor }}>
            {group.day_change_pct != null ? `${group.day_change_pct >= 0 ? "+" : ""}${group.day_change_pct.toFixed(1)}%` : "—"}
          </p>
        </div>
      </div>

      {/* Period picker */}
      <div className="flex gap-1 p-0.5 rounded-lg border mb-3"
        style={{ background: "var(--background)", borderColor: "var(--card-border)" }}>
        {POS_PERIODS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className="flex-1 py-1 text-[11px] font-semibold rounded-md transition-all"
            style={{
              background: period === p.id ? "var(--primary)" : "transparent",
              color: period === p.id ? "#000" : "var(--muted)",
            }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* P&L for selected period */}
      <div className="pt-2 border-t flex items-center justify-between"
        style={{ borderColor: "var(--card-border)" }}>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          P&L {isAll ? "gesamt" : POS_PERIODS.find(p => p.id === period)?.label}
        </span>
        {histLoading ? (
          <div className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
        ) : displayPnl != null ? (
          <span className="text-sm font-bold" style={{ color: pnlColor }}>
            {displayPnl >= 0 ? "+" : ""}{displayPnl.toFixed(2)}$
            {displayPct != null && (
              <span className="text-xs font-normal ml-1">
                ({displayPct >= 0 ? "+" : ""}{displayPct.toFixed(1)}%)
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>
        )}
      </div>
    </div>
  );
}

const JOB_STEP_LABELS: Record<string, string> = {
  queued:       "Analyse wird gestartet…",
  fetch_data:   "Marktdaten werden geladen…",
  enrich_news:  "Nachrichten werden angereichert…",
  peer_context: "Vergleichsunternehmen werden geladen…",
  data_diagnostics: "Datenkanäle werden geprüft…",
  diana_check:  "Datenqualität wird bewertet…",
  load_guardrails: "Historische Guardrails werden geladen…",
  run_agents:   "Felix, Nina & Marco analysieren…",
  run_synthesis:"Synthese wird erstellt…",
  fast_synthesis:"Schnell-Synthese wird erstellt…",
  research_guardrails:"Research-Guardrails werden angewendet…",
  vera_fact_check:"Vera prüft Fakten im Nachgang…",
  run_vera:     "Vera prüft Fakten im Nachgang…",
  vera_pending: "Analyse bereit, Vera prüft nach…",
  save_result:  "Ergebnis wird gespeichert…",
  completed:    "Analyse abgeschlossen",
};

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

function AnalysisTracePanel({
  trace,
  defaultOpen = false,
}: {
  trace: AnalysisTraceEntry[];
  defaultOpen?: boolean;
}) {
  if (!trace.length) return null;

  return (
    <details
      className="rounded-xl overflow-hidden border"
      style={{ borderColor: "var(--card-border)", background: "rgba(100,116,139,0.05)" }}
      {...(defaultOpen ? { open: true } : {})}>
      <summary
        className="px-3 py-2 text-xs font-semibold cursor-pointer"
        style={{ color: "var(--muted)" }}>
        Technisches Protokoll
      </summary>
      <ul className="px-3 pb-3 space-y-1.5">
        {trace.map((entry, index) => {
          const style = TRACE_STATUS_STYLES[entry.status] ?? TRACE_STATUS_STYLES.warning;
          return (
            <li key={`${entry.step}-${index}`} className="flex items-start gap-2 text-xs">
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
    </details>
  );
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
  const [aiPolling, setAiPolling] = useState(false);
  const [aiCurrentStep, setAiCurrentStep] = useState<string>("");
  const [aiTrace, setAiTrace] = useState<AnalysisTraceEntry[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startTransition] = useTransition();
  const [earnings, setEarnings] = useState<EarningsCalendar | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [triggeredCount, setTriggeredCount] = useState(0);

  // Price currency toggle (USD ↔ EUR), mirroring the AI analysis card.
  const [priceCurrency, setPriceCurrency] = useState<"USD" | "EUR">("USD");
  const [eurUsd, setEurUsd] = useState<number | null>(null);

  // Top-bar toggles for news and the German company description.
  const [showNews, setShowNews] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [descDe, setDescDe] = useState<string | null>(null);
  const [descUpdatedAt, setDescUpdatedAt] = useState<string | null>(null);
  const [descLoading, setDescLoading] = useState(false);

  useEffect(() => {
    fetch("/api/alerts")
      .then(r => r.ok ? r.json() : [])
      .then((data: { triggered: boolean }[]) =>
        setTriggeredCount(data.filter(a => a.triggered).length)
      )
      .catch(() => {});
  }, []);

  // EUR/USD rate for the price toggle.
  useEffect(() => {
    fetch("/api/fx")
      .then(r => r.ok ? r.json() : null)
      .then((d: { eurUsd?: number } | null) => { if (d?.eurUsd) setEurUsd(d.eurUsd); })
      .catch(() => {});
  }, []);

  // Default the price toggle to the asset's native currency once known.
  useEffect(() => {
    if (asset?.currency === "EUR") setPriceCurrency("EUR");
  }, [asset?.currency]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        // Assets first — saves snapshot to Supabase cache
        const assetRes = await fetch(`/api/assets/${symbol}`);

        fetch(`/api/assets/${symbol}/calendar`).then(r => r.ok ? r.json() : null).then(e => { if (e) setEarnings(e); }).catch(() => null);

        if (cancelled) return;

        if (!assetRes.ok) {
          const body = await assetRes.json().catch(() => ({}));
          throw new Error(body.error ?? "Datenabruf fehlgeschlagen");
        }

        const assetData = await assetRes.json();
        setAsset(assetData);
        setLoading(false);

        // Score after — snapshot is now cached, avoids hitting sleeping Render
        const scoreRes = await fetch(`/api/analyze/${symbol}`, { method: "POST" });
        if (cancelled) return;
        const scoreData = scoreRes.ok ? await scoreRes.json() : null;
        setScore(scoreData);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unbekannter Fehler");
          setLoading(false);
        }
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

  // Progress kommt vom Server (analysis_jobs.progress) — keine Animation nötig
  useEffect(() => { if (!aiLoading) setAiProgress(0); }, [aiLoading]);

  // Cleanup polling on unmount
  useEffect(() => () => stopPolling(), []);

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/assets/${symbol}?refresh=true`);
      if (res.ok) {
        const data = await res.json();
        setAsset(data);
        const scoreRes = await fetch(`/api/analyze/${symbol}`, { method: "POST" });
        if (scoreRes.ok) setScore(await scoreRes.json());
      }
    } catch { /* ignore */ }
    setRefreshing(false);
  }

  function loadDescription(force = false) {
    if (descLoading) return;
    setDescLoading(true);
    fetch(`/api/assets/${symbol}/description${force ? "?refresh=true" : ""}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { de?: string; updatedAt?: string | null } | null) => {
        setDescDe(d?.de ?? "");
        setDescUpdatedAt(d?.updatedAt ?? null);
      })
      .catch(() => setDescDe(""))
      .finally(() => setDescLoading(false));
  }

  function toggleInfo() {
    setShowInfo(v => !v);
    // Lazy-load the German description only the first time the panel is opened.
    if (descDe == null && !descLoading) loadDescription(false);
  }

  function stopPolling() {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (pollingTimeoutRef.current) { clearTimeout(pollingTimeoutRef.current); pollingTimeoutRef.current = null; }
    setAiPolling(false);
  }

  function startJobPolling(jobId: string) {
    setAiPolling(true);
    setAiCurrentStep("queued");

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/ai-analysis/jobs/${jobId}`);
        const text = await res.text();
        let job: Record<string, unknown>;
        try { job = JSON.parse(text) as Record<string, unknown>; } catch { return; }

        if (!res.ok) {
          stopPolling();
          setAiError("Analyse konnte nicht geladen werden.");
          setAiLoading(false);
          return;
        }

        const progress = typeof job.progress === "number" ? job.progress : 0;
        const step = typeof job.current_step === "string" ? job.current_step : "";
        const trace = Array.isArray(job.trace)
          ? job.trace as unknown as AnalysisTraceEntry[]
          : [];
        setAiProgress(progress);
        setAiCurrentStep(step);
        setAiTrace(trace);

        if (job.result) {
          const result = job.result as Record<string, unknown>;
          if (typeof result.recommendation === "string") {
            setAiAnalysis({
              ...result,
              trace: Array.isArray(result.trace) ? result.trace : trace,
            } as unknown as AIAnalysisResult);
          }
          setAiLoading(false);
          if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
            pollingTimeoutRef.current = null;
          }
        }

        if (job.status === "completed") {
          stopPolling();
        } else if (job.status === "failed") {
          stopPolling();
          setAiError(typeof job.error === "string" ? job.error : "Analyse fehlgeschlagen.");
          setAiLoading(false);
        } else if (job.status === "running" && typeof job.updated_at === "string") {
          const staleMs = Date.now() - new Date(job.updated_at).getTime();
          if (staleMs > 90_000) {
            stopPolling();
            setAiError("Analyse hat sich aufgehängt. Bitte erneut versuchen.");
            setAiLoading(false);
          }
        } else if (job.status === "reviewing" && job.result && typeof job.updated_at === "string") {
          const staleMs = Date.now() - new Date(job.updated_at).getTime();
          if (staleMs > 90_000) {
            stopPolling();
          }
        }
      } catch { /* Netzwerkfehler → weiter pollen */ }
    }, 3000);

    pollingTimeoutRef.current = setTimeout(() => {
      stopPolling();
      setAiLoading(false);
      setAiError("Analyse dauerte zu lange. Bitte erneut versuchen.");
    }, 300_000);
  }

  async function runAIAnalysis() {
    // setAiLoading sofort — deaktiviert den Button unmittelbar (kein Doppelklick)
    setAiLoading(true);
    // Rest der Resets als nicht-dringende Transition — gibt Browser Zeit zum Rendern
    startTransition(() => {
      setAiError(null);
      setAiProgress(0);
      setAiCurrentStep("queued");
      setAiTrace([]);
    });

    try {
      const res = await fetch(`/api/ai-analysis/${symbol}`, { method: "POST" });
      const rawText = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(rawText) as Record<string, unknown>; }
      catch { throw new Error(`Server-Fehler ${res.status} – Analyse konnte nicht gestartet werden`); }

      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "KI-Analyse fehlgeschlagen");
      }

      // Cache-Treffer: direkt anzeigen
      if ("recommendation" in data) {
        setAiTrace(Array.isArray(data.trace) ? data.trace as unknown as AnalysisTraceEntry[] : []);
        setAiAnalysis(data as unknown as AIAnalysisResult);
        setAiLoading(false);
        return;
      }

      // Job gestartet: Run-Endpoint feuern (fire & forget), dann pollen
      if (data.status === "queued" && typeof data.job_id === "string") {
        void fetch(`/api/ai-analysis/jobs/${data.job_id}/run`, { method: "POST" }).catch(() => {});
        startJobPolling(data.job_id);
        return;
      }

      throw new Error("Unerwartete Server-Antwort");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Unbekannter Fehler");
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

  // ── Price currency conversion ──────────────────────────────────────────────
  const baseCurrency =
    asset?.currency === "EUR" ? "EUR"
    : asset?.currency == null || asset.currency === "USD" ? "USD"
    : asset.currency;
  const canToggleCurrency =
    (baseCurrency === "USD" || baseCurrency === "EUR") && eurUsd != null && eurUsd > 0;
  const effectiveCurrency = canToggleCurrency ? priceCurrency : baseCurrency;

  const convertPrice = (value: number | null): number | null => {
    if (value == null) return null;
    if (!canToggleCurrency || effectiveCurrency === baseCurrency) return value;
    if (baseCurrency === "USD" && effectiveCurrency === "EUR") return value / (eurUsd as number);
    if (baseCurrency === "EUR" && effectiveCurrency === "USD") return value * (eurUsd as number);
    return value;
  };

  const currencySymbol = (c: string) => (c === "USD" ? "$" : c === "EUR" ? "€" : "");
  const formatPrice = (value: number | null): string => {
    const converted = convertPrice(value);
    if (converted == null) return "—";
    const sym = currencySymbol(effectiveCurrency);
    return sym
      ? `${sym}${converted.toFixed(2)}`
      : `${converted.toFixed(2)} ${effectiveCurrency}`;
  };

  return (
    <div className="space-y-4">
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <Link href={backHref} className="text-sm flex items-center gap-1"
          style={{ color: "var(--muted)" }}>
          {backLabel}
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/compare?a=${symbol}`}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full font-medium"
            style={{ background: "var(--card-border)", color: "var(--muted)" }}
            title="Aktie vergleichen">
            Vergleichen
          </Link>
          <button
            onClick={toggleInfo}
            aria-expanded={showInfo}
            title="Unternehmensbeschreibung"
            className="flex items-center justify-center w-8 h-8 rounded-full transition-colors"
            style={{
              background: showInfo ? "rgba(168,85,247,0.15)" : "var(--card-border)",
              color: showInfo ? "#c084fc" : "var(--muted)",
            }}>
            <Info size={15} />
          </button>
          <Link
            href={`/dashboard/alerts?symbol=${symbol}`}
            className="relative flex items-center justify-center w-8 h-8 rounded-full transition-colors"
            style={{ background: "var(--card-border)", color: "var(--muted)" }}
            title="Alarm-Übersicht">
            <Bell size={15} />
            {triggeredCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                style={{ background: "#ef4444", borderColor: "var(--background)" }} />
            )}
          </Link>
          <button
            onClick={() => setShowNews(v => !v)}
            aria-expanded={showNews}
            title="Aktuelle News"
            className="flex items-center justify-center w-8 h-8 rounded-full transition-colors"
            style={{
              background: showNews ? "rgba(59,130,246,0.18)" : "var(--card-border)",
              color: showNews ? "#60a5fa" : "var(--muted)",
            }}>
            <Newspaper size={15} />
          </button>
        </div>
      </div>

      {/* Hero — Aktienkennung */}
      <div
        className="rounded-2xl border p-4"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-2xl font-bold text-white">{symbol}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
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
            <div className="flex items-center justify-end gap-2">
              <p className="text-2xl font-bold text-white">{formatPrice(asset?.price ?? null)}</p>
              {canToggleCurrency && (
                <div className="flex rounded-full p-0.5" style={{ background: "var(--card-border)" }}>
                  {(["USD", "EUR"] as const).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPriceCurrency(c)}
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all"
                      style={{
                        background: priceCurrency === c ? "var(--primary)" : "transparent",
                        color: priceCurrency === c ? "#000" : "var(--muted)",
                      }}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-0.5">
              {asset?.fetched_at && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {refreshing
                    ? "Aktualisiere…"
                    : cacheRemainingMs != null && cacheRemainingMs > 0
                    ? `${formatRelativeTime(asset.fetched_at)} · in ${formatCountdown(cacheRemainingMs)}`
                    : formatRelativeTime(asset.fetched_at)}
                </p>
              )}
              <button
                onClick={handleManualRefresh}
                disabled={refreshing}
                title="Daten neu laden"
                className="flex items-center justify-center w-5 h-5 rounded-full disabled:opacity-40"
                style={{ color: "var(--muted)" }}>
                <RotateCw size={11} className={refreshing ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
        </div>

        {score && (
          <div className="mt-3">
            <ScoreBadge signal={score.signal as SignalType} score={score.total_score} size="lg" />
          </div>
        )}
      </div>

      {/* Info panel — German company description (lazy, persisted, toggled via "i") */}
      {showInfo && (
        <div
          className="rounded-2xl border p-4"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Info size={14} style={{ color: "#c084fc" }} />
              <h3 className="font-semibold text-white text-sm">Über das Unternehmen</h3>
            </div>
            {descDe && (
              <button
                onClick={() => loadDescription(true)}
                disabled={descLoading}
                title="Beschreibung neu übersetzen"
                className="flex items-center justify-center w-6 h-6 rounded-full disabled:opacity-40"
                style={{ color: "var(--muted)", background: "var(--card-border)" }}>
                <RotateCw size={11} className={descLoading ? "animate-spin" : ""} />
              </button>
            )}
          </div>
          {descLoading ? (
            <div className="space-y-1.5">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-3 rounded animate-pulse" style={{ background: "var(--card-border)" }} />
              ))}
            </div>
          ) : descDe ? (
            <>
              <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                {descDe}
              </p>
              {descUpdatedAt && (
                <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
                  Stand: {new Date(descUpdatedAt).toLocaleDateString("de-DE")}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Keine Beschreibung verfügbar.
            </p>
          )}
        </div>
      )}

      {/* News panel — toggled via newspaper icon */}
      {showNews && <AssetNewsCard symbol={symbol} />}

      {/* Chart — directly under the stock header */}
      <PriceChart symbol={symbol} />

      {/* Quartalszahlen — directly under the chart */}
      {earnings && <EarningsCard earnings={earnings} />}

      {/* Analyse-Score */}
      {score && (
        <div
          className="rounded-2xl border p-4 space-y-3"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <h3 className="font-semibold text-white">Analyse-Score</h3>
          <ScoreBar label="Gesamt" score={score.total_score} />
          <ScoreBar label="Fundamental (40%)" score={score.fundamental_score} />
          <ScoreBar label="Technisch (30%)" score={score.technical_score} />
          <ScoreBar label="Risiko inv. (30%)" score={score.risk_score} />
          <details className="text-xs" style={{ color: "var(--muted)" }}>
            <summary className="cursor-pointer font-medium">Erklärung anzeigen</summary>
            <p className="mt-2 leading-relaxed">{score.explanation}</p>
          </details>
        </div>
      )}

      {/* Portfolio Position (nur wenn im Depot) */}
      <PortfolioPositionSection symbol={symbol} />

      {/* Kennzahlen (kompakt) */}
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
            label="Marktkap."
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

      {/* KI-Aktienanalyse */}
      {!aiAnalysis && (
        <div
          className="rounded-2xl border p-4"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-semibold text-white">KI-Aktienanalyse</h3>
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
            {aiLoading ? (JOB_STEP_LABELS[aiCurrentStep] ?? "Analyse läuft…") : "KI-Analyse starten"}
          </button>
          {aiLoading && (
            <div className="space-y-2 mt-2">
              {/* Agenten mit Aktivitätsstatus */}
              <div className="flex items-center gap-3 justify-center flex-wrap">
                {(["diana","felix","nina","marco","opus"] as const).map(agent => {
                  const active =
                    (agent === "diana" && ["diana_check","run_agents","queued","fetch_data","enrich_news"].includes(aiCurrentStep)) ||
                    (agent === "felix" && ["run_agents","run_synthesis","fast_synthesis"].includes(aiCurrentStep)) ||
                    (agent === "nina"  && ["run_agents","run_synthesis","fast_synthesis"].includes(aiCurrentStep)) ||
                    (agent === "marco" && ["run_agents","run_synthesis","fast_synthesis"].includes(aiCurrentStep)) ||
                    (agent === "opus"  && ["run_synthesis","fast_synthesis","research_guardrails"].includes(aiCurrentStep));
                  return <AgentAvatar key={agent} agent={agent} size="sm" showName working={active} />;
                })}
              </div>
              {/* Echter Fortschrittsbalken vom Server */}
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card-border)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${aiProgress}%`, background: "var(--primary)" }}
                />
              </div>
              <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
                {JOB_STEP_LABELS[aiCurrentStep] ?? "Analyse läuft…"}
              </p>
            </div>
          )}
          {aiTrace.length > 0 && (
            <div className="mt-3">
              <AnalysisTracePanel trace={aiTrace} defaultOpen={Boolean(aiError) || aiLoading} />
            </div>
          )}
        </div>
      )}

      {aiAnalysis && <AIAnalysisCard analysis={aiAnalysis} />}

      {/* Analyse-Scoreverlauf (falls vorhanden) */}
      <AnalysisHistoryCard symbol={symbol} />

      {/* Vergleichbare Unternehmen */}
      <PeersSection symbol={symbol} />

      {/* Disclaimer */}
      <Disclaimer />

      <p className="text-xs text-center pb-2" style={{ color: "var(--muted)" }}>
        Daten abgerufen: {asset?.fetched_at ? new Date(asset.fetched_at).toLocaleString("de-DE") : "—"}
      </p>
    </div>
  );
}
