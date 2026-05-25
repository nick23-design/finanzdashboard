"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Search, RefreshCw, Globe } from "lucide-react";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { ScoreBar } from "@/components/ui/ScoreBar";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { searchStocks, type StockEntry } from "@/lib/stocks-list";
import type { SignalType } from "@/types/finance";
import type { CompareResult } from "@/app/api/ai-analysis/compare/route";

interface LiveResult { symbol: string; name: string; exchange: string | null; type: string | null }

const REGION_LABEL: Record<StockEntry["region"], string> = {
  US: "🇺🇸", DE: "🇩🇪", EU: "🇪🇺", CH: "🇨🇭", ETF: "📦",
};

type Period = "1W" | "1M" | "3M" | "6M" | "1J";

const PERIOD_MAP: Record<Period, string> = {
  "1W": "5d", "1M": "1mo", "3M": "3mo", "6M": "6mo", "1J": "1y",
};

interface AssetData {
  symbol: string;
  name: string | null;
  price: number | null;
  currency: string | null;
  priceChangePct: number | null;
  pe_ratio: number | null;
  market_cap: number | null;
  revenue_growth: number | null;
  free_cashflow: number | null;
  debt_to_equity: number | null;
  rsi: number | null;
  moving_average_50: number | null;
  moving_average_200: number | null;
}

interface ScoreData {
  total_score: number;
  fundamental_score: number;
  technical_score: number;
  risk_score: number;
  signal: SignalType;
}

interface HistoryPoint { date: string; value: number }

function fmtBig(n: number | null): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)} T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} Mrd.`;
  return `${(n / 1e6).toFixed(2)} Mio.`;
}

function MetricRow({
  label, a, b, aRaw, bRaw, higherIsBetter = true,
}: {
  label: string;
  a: string; b: string;
  aRaw: number | null; bRaw: number | null;
  higherIsBetter?: boolean;
}) {
  const bothExist = aRaw != null && bRaw != null;
  const aWins = bothExist && (higherIsBetter ? aRaw > bRaw : aRaw < bRaw);
  const bWins = bothExist && (higherIsBetter ? bRaw > aRaw : bRaw < aRaw);

  return (
    <div className="grid grid-cols-3 items-center gap-2 py-2 border-b" style={{ borderColor: "var(--card-border)" }}>
      <span
        className="text-right text-sm font-medium pr-1 rounded-md px-1"
        style={{ color: aWins ? "#22c55e" : "var(--muted)", background: aWins ? "rgba(34,197,94,0.1)" : "transparent" }}>
        {a}
      </span>
      <span className="text-center text-xs" style={{ color: "var(--muted)" }}>{label}</span>
      <span
        className="text-left text-sm font-medium pl-1 rounded-md px-1"
        style={{ color: bWins ? "#22c55e" : "var(--muted)", background: bWins ? "rgba(34,197,94,0.1)" : "transparent" }}>
        {b}
      </span>
    </div>
  );
}

function CompareChart({
  histA, histB, symbolA, symbolB, period, onPeriod,
}: {
  histA: HistoryPoint[]; histB: HistoryPoint[];
  symbolA: string; symbolB: string;
  period: Period; onPeriod: (p: Period) => void;
}) {
  if (histA.length < 2 || histB.length < 2) return null;

  const normalise = (pts: HistoryPoint[]) => {
    const base = pts[0].value;
    return pts.map(p => ((p.value - base) / base) * 100);
  };

  const normA = normalise(histA);
  const normB = normalise(histB);
  const allVals = [...normA, ...normB];
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  const W = 300; const H = 80;
  const toX = (i: number, len: number) => (i / (len - 1)) * W;
  const toY = (v: number) => H - ((v - minV) / range) * (H - 8) - 4;

  const pathOf = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i, vals.length).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");

  const lastA = normA.at(-1) ?? 0;
  const lastB = normB.at(-1) ?? 0;

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{ background: "#3b82f6" }} />{symbolA} {lastA >= 0 ? "+" : ""}{lastA.toFixed(2)}%</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{ background: "#f59e0b" }} />{symbolB} {lastB >= 0 ? "+" : ""}{lastB.toFixed(2)}%</span>
        </div>
        <div className="flex gap-1">
          {(["1W", "1M", "3M", "6M", "1J"] as Period[]).map(p => (
            <button key={p} onClick={() => onPeriod(p)}
              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{
                background: period === p ? "var(--primary)" : "var(--card-border)",
                color: period === p ? "#000" : "var(--muted)",
              }}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
        <line x1="0" y1={toY(0).toFixed(1)} x2={W} y2={toY(0).toFixed(1)}
          stroke="rgba(148,163,184,0.2)" strokeWidth="1" strokeDasharray="4,4" />
        <path d={pathOf(normA)} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathOf(normB)} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function AICompareCard({ symbolA, symbolB, assetA, assetB, snapshotLoaded }: { symbolA: string; symbolB: string; assetA: AssetData | null; assetB: AssetData | null; snapshotLoaded: boolean }) {
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/ai-analysis/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbolA,
          symbolB,
          dataA: assetA,
          dataB: assetB,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Fehler"); return; }
      setResult(data as CompareResult);
    } catch {
      setError("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  }, [symbolA, symbolB]);

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(99,102,241,0.2)", background: "rgba(99,102,241,0.05)" }}>
        <AgentAvatar agent="kai" size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-sm">Kai · KI-Vergleichsanalyse</p>
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>Vergleichs-Analyst · Claude Haiku 4.5</p>
        </div>
        {!loading && (
          <button
            onClick={run}
            disabled={!snapshotLoaded}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold disabled:opacity-40"
            style={{ background: "var(--primary)", color: "#000" }}>
            {result ? <RefreshCw size={11} /> : null}
            {result ? "Neu" : "Analysieren"}
          </button>
        )}
      </div>

      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2 py-4">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#6366f1", borderTopColor: "transparent" }} />
            <span className="text-sm" style={{ color: "var(--muted)" }}>Kai analysiert den Vergleich…</span>
          </div>
        )}
        {error && <p className="text-sm" style={{ color: "#ef4444" }}>{error}</p>}
        {!loading && !result && !error && (
          <p className="text-sm text-center py-4" style={{ color: "var(--muted)" }}>
            {snapshotLoaded ? "Kai kann beide Aktien direkt vergleichen und eine Empfehlung geben." : "Lade zuerst beide Aktien…"}
          </p>
        )}
        {result && (
          <div className="space-y-4">
            {result.winner && (
              <div className="rounded-xl p-3 text-center" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>Kais Empfehlung</p>
                <p className="text-lg font-bold" style={{ color: "#6366f1" }}>{result.winner}</p>
                <p className="text-sm mt-1 text-white">{result.recommendation}</p>
              </div>
            )}
            <p className="text-sm leading-relaxed text-white">{result.summary}</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "#3b82f6" }}>{symbolA} — Stärken</p>
                {result.a_strengths.map((s, i) => (
                  <p key={i} className="text-xs flex gap-1" style={{ color: "var(--muted)" }}><span style={{ color: "#22c55e" }}>›</span>{s}</p>
                ))}
                {result.a_weaknesses.length > 0 && <>
                  <p className="text-xs font-semibold mt-2" style={{ color: "#ef4444" }}>Schwächen</p>
                  {result.a_weaknesses.map((s, i) => (
                    <p key={i} className="text-xs flex gap-1" style={{ color: "var(--muted)" }}><span style={{ color: "#ef4444" }}>›</span>{s}</p>
                  ))}
                </>}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "#f59e0b" }}>{symbolB} — Stärken</p>
                {result.b_strengths.map((s, i) => (
                  <p key={i} className="text-xs flex gap-1" style={{ color: "var(--muted)" }}><span style={{ color: "#22c55e" }}>›</span>{s}</p>
                ))}
                {result.b_weaknesses.length > 0 && <>
                  <p className="text-xs font-semibold mt-2" style={{ color: "#ef4444" }}>Schwächen</p>
                  {result.b_weaknesses.map((s, i) => (
                    <p key={i} className="text-xs flex gap-1" style={{ color: "var(--muted)" }}><span style={{ color: "#ef4444" }}>›</span>{s}</p>
                  ))}
                </>}
              </div>
            </div>

            <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--card-border)" }}>
              <p className="text-xs font-semibold text-white mb-1">Fazit</p>
              <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{result.verdict}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StockSearch({ label, color, onSelect }: { label: string; color: string; onSelect: (s: string) => void }) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<StockEntry[]>([]);
  const [liveResults, setLiveResults] = useState<LiveResult[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hits = searchStocks(q);
    setSuggestions(hits);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length >= 2) {
      setShowDrop(true);
      setLiveLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
          if (res.ok) {
            const data: LiveResult[] = await res.json();
            const staticSyms = new Set(hits.map(h => h.symbol));
            setLiveResults(data.filter(r => !staticSyms.has(r.symbol)));
          }
        } catch { /* ignore */ }
        setLiveLoading(false);
      }, 300);
    } else {
      setLiveResults([]);
      setLiveLoading(false);
      setShowDrop(q.length >= 1 && hits.length > 0);
    }
  }, [q]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropRef.current?.contains(e.target as Node) || inputRef.current?.contains(e.target as Node)) return;
      setShowDrop(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function pick(symbol: string) {
    setShowDrop(false);
    setQ("");
    setSuggestions([]);
    setLiveResults([]);
    onSelect(symbol);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sym = q.trim().toUpperCase();
    if (sym) pick(sym);
  }

  const hasDrop = showDrop && (suggestions.length > 0 || liveResults.length > 0 || liveLoading);

  return (
    <div className="relative">
      <form onSubmit={submit}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--muted)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value.toUpperCase())}
            onFocus={() => (suggestions.length > 0 || liveResults.length > 0) && setShowDrop(true)}
            placeholder={label}
            maxLength={20}
            autoComplete="off"
            className="w-full rounded-xl pl-8 pr-3 py-2.5 text-white text-sm border outline-none"
            style={{ background: "var(--card)", borderColor: color + "50" }}
          />
        </div>
      </form>

      {hasDrop && (
        <div ref={dropRef} className="absolute top-full left-0 right-0 mt-1 rounded-xl border overflow-hidden z-50 shadow-xl" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          {suggestions.map(s => (
            <button key={s.symbol} type="button"
              onMouseDown={e => { e.preventDefault(); pick(s.symbol); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-b last:border-b-0 hover:bg-white/5"
              style={{ borderColor: "var(--card-border)" }}>
              <span className="w-4 text-center flex-shrink-0 text-xs">{REGION_LABEL[s.region]}</span>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-white text-xs">{s.symbol}</span>
                <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>{s.name}</p>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(100,116,139,0.2)", color: "var(--muted)" }}>{s.region}</span>
            </button>
          ))}

          {suggestions.length > 0 && (liveResults.length > 0 || liveLoading) && (
            <div className="px-3 py-1 flex items-center gap-2">
              <span className="text-[10px] font-medium" style={{ color: "var(--muted)" }}>Weltweit</span>
              <div className="flex-1 h-px" style={{ background: "var(--card-border)" }} />
            </div>
          )}

          {liveResults.map(r => (
            <button key={r.symbol} type="button"
              onMouseDown={e => { e.preventDefault(); pick(r.symbol); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-b last:border-b-0 hover:bg-white/5"
              style={{ borderColor: "var(--card-border)" }}>
              <Globe size={11} className="flex-shrink-0" style={{ color: "var(--muted)" }} />
              <div className="flex-1 min-w-0">
                <span className="font-bold text-white text-xs">{r.symbol}</span>
                <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>{r.name}</p>
              </div>
              {r.exchange && <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(100,116,139,0.2)", color: "var(--muted)" }}>{r.exchange}</span>}
            </button>
          ))}

          {liveLoading && (
            <div className="px-3 py-2 flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full border border-t-transparent animate-spin flex-shrink-0" style={{ borderColor: "var(--muted)", borderTopColor: "transparent" }} />
              <span className="text-[10px]" style={{ color: "var(--muted)" }}>Suche weltweit…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CompareView() {
  const params = useSearchParams();
  const router = useRouter();

  const [symbolA, setSymbolA] = useState(params.get("a")?.toUpperCase() ?? "");
  const [symbolB, setSymbolB] = useState(params.get("b")?.toUpperCase() ?? "");

  // Sync state when URL params change (e.g. navigating from asset page with both symbols)
  useEffect(() => {
    const a = params.get("a")?.toUpperCase() ?? "";
    const b = params.get("b")?.toUpperCase() ?? "";
    if (a && a !== symbolA) { setSymbolA(a); setAssetA(null); setScoreA(null); setHistA([]); }
    if (b && b !== symbolB) { setSymbolB(b); setAssetB(null); setScoreB(null); setHistB([]); }
  }, [params]);

  const [assetA, setAssetA] = useState<AssetData | null>(null);
  const [assetB, setAssetB] = useState<AssetData | null>(null);
  const [scoreA, setScoreA] = useState<ScoreData | null>(null);
  const [scoreB, setScoreB] = useState<ScoreData | null>(null);
  const [histA, setHistA] = useState<HistoryPoint[]>([]);
  const [histB, setHistB] = useState<HistoryPoint[]>([]);
  const [period, setPeriod] = useState<Period>("1M");
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);

  async function loadAsset(symbol: string, side: "a" | "b") {
    const setLoading = side === "a" ? setLoadingA : setLoadingB;
    const setAsset = side === "a" ? setAssetA : setAssetB;
    const setScore = side === "a" ? setScoreA : setScoreB;
    const setHist = side === "a" ? setHistA : setHistB;

    setLoading(true);
    try {
      const [assetRes, histRes] = await Promise.all([
        fetch(`/api/assets/${symbol}`),
        fetch(`/api/assets/${symbol}/history?period=${PERIOD_MAP[period]}`),
      ]);
      if (assetRes.ok) {
        const d = await assetRes.json();
        setAsset({
          symbol,
          name: d.name ?? null,
          price: d.price ?? null,
          currency: d.currency ?? null,
          priceChangePct: d.price_change_pct ?? null,
          pe_ratio: d.pe_ratio ?? null,
          market_cap: d.market_cap ?? null,
          revenue_growth: d.revenue_growth ?? null,
          free_cashflow: d.free_cashflow ?? null,
          debt_to_equity: d.debt_to_equity ?? null,
          rsi: d.rsi ?? null,
          moving_average_50: d.moving_average_50 ?? null,
          moving_average_200: d.moving_average_200 ?? null,
        });
      }
      if (histRes.ok) {
        const h = await histRes.json();
        if (Array.isArray(h)) setHist(h);
      }
      // Load score after snapshot is cached
      const scoreRes = await fetch(`/api/analyze/${symbol}`, { method: "POST" });
      if (scoreRes.ok) {
        const s = await scoreRes.json();
        setScore({ total_score: s.total_score, fundamental_score: s.fundamental_score, technical_score: s.technical_score, risk_score: s.risk_score, signal: s.signal });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (symbolA) loadAsset(symbolA, "a"); }, [symbolA]);
  useEffect(() => { if (symbolB) loadAsset(symbolB, "b"); }, [symbolB]);

  // Reload history when period changes
  useEffect(() => {
    async function reloadHist(symbol: string, setHist: (h: HistoryPoint[]) => void) {
      const res = await fetch(`/api/assets/${symbol}/history?period=${PERIOD_MAP[period]}`);
      if (res.ok) { const h = await res.json(); if (Array.isArray(h)) setHist(h); }
    }
    if (symbolA) reloadHist(symbolA, setHistA);
    if (symbolB) reloadHist(symbolB, setHistB);
  }, [period]);

  function handleSelectA(s: string) {
    setSymbolA(s); setAssetA(null); setScoreA(null); setHistA([]);
    router.replace(`/dashboard/compare?a=${s}${symbolB ? `&b=${symbolB}` : ""}`);
  }
  function handleSelectB(s: string) {
    setSymbolB(s); setAssetB(null); setScoreB(null); setHistB([]);
    router.replace(`/dashboard/compare?a=${symbolA}&b=${s}`);
  }

  const bothLoaded = !!assetA && !!assetB;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "var(--card-border)" }}>
          <ArrowLeft size={16} style={{ color: "var(--muted)" }} />
        </button>
        <h2 className="text-lg font-bold text-white">Aktienvergleich</h2>
      </div>

      {/* Search row */}
      <div className="grid grid-cols-2 gap-3">
        <StockSearch label="Aktie A" color="#3b82f6" onSelect={handleSelectA} />
        <StockSearch label="Aktie B" color="#f59e0b" onSelect={handleSelectB} />
      </div>

      {/* Header cards */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { sym: symbolA, asset: assetA, score: scoreA, loading: loadingA, color: "#3b82f6" },
          { sym: symbolB, asset: assetB, score: scoreB, loading: loadingB, color: "#f59e0b" },
        ].map(({ sym, asset, score, loading, color }) => (
          <div key={color} className="rounded-2xl border p-3 space-y-1.5"
            style={{ background: "var(--card)", borderColor: color + "40", borderTopWidth: "3px", borderTopColor: color }}>
            {loading ? (
              <Skeleton className="w-full" height="h-16" />
            ) : asset ? (
              <>
                <Link href={`/dashboard/asset/${sym}`} className="font-bold text-white text-sm hover:underline block">{sym}</Link>
                {asset.name && <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>{asset.name}</p>}
                <p className="text-base font-semibold text-white">
                  {asset.price?.toFixed(2) ?? "—"}
                  <span className="text-xs font-normal ml-1" style={{ color: "var(--muted)" }}>{asset.currency ?? ""}</span>
                </p>
                {asset.priceChangePct != null && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{
                      color: asset.priceChangePct >= 0 ? "#22c55e" : "#ef4444",
                      background: asset.priceChangePct >= 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                    }}>
                    {asset.priceChangePct >= 0 ? "+" : ""}{asset.priceChangePct.toFixed(2)}%
                  </span>
                )}
                {score ? <ScoreBadge signal={score.signal} score={score.total_score} size="sm" /> : <Skeleton className="w-16" height="h-4" />}
              </>
            ) : (
              <p className="text-xs py-4 text-center" style={{ color: "var(--muted)" }}>{sym ? `${sym} nicht gefunden` : "Aktie eingeben"}</p>
            )}
          </div>
        ))}
      </div>

      {/* Chart */}
      {bothLoaded && (
        <CompareChart
          histA={histA} histB={histB}
          symbolA={symbolA} symbolB={symbolB}
          period={period} onPeriod={setPeriod}
        />
      )}

      {/* Metrics table */}
      {bothLoaded && (
        <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--card-border)" }}>
            <p className="text-xs font-semibold text-white">Kennzahlen</p>
          </div>
          <div className="px-4 py-1">
            <div className="grid grid-cols-3 py-1.5">
              <span className="text-right text-[10px] font-bold pr-1" style={{ color: "#3b82f6" }}>{symbolA}</span>
              <span className="text-center text-[10px]" style={{ color: "var(--muted)" }}></span>
              <span className="text-left text-[10px] font-bold pl-1" style={{ color: "#f59e0b" }}>{symbolB}</span>
            </div>
            <MetricRow label="KGV" a={assetA.pe_ratio?.toFixed(1) ?? "—"} b={assetB.pe_ratio?.toFixed(1) ?? "—"} aRaw={assetA.pe_ratio} bRaw={assetB.pe_ratio} higherIsBetter={false} />
            <MetricRow label="Marktkapitalisierung" a={fmtBig(assetA.market_cap)} b={fmtBig(assetB.market_cap)} aRaw={assetA.market_cap} bRaw={assetB.market_cap} />
            <MetricRow label="Umsatzwachstum" a={assetA.revenue_growth != null ? (assetA.revenue_growth * 100).toFixed(1) + "%" : "—"} b={assetB.revenue_growth != null ? (assetB.revenue_growth * 100).toFixed(1) + "%" : "—"} aRaw={assetA.revenue_growth} bRaw={assetB.revenue_growth} />
            <MetricRow label="Free Cashflow" a={fmtBig(assetA.free_cashflow)} b={fmtBig(assetB.free_cashflow)} aRaw={assetA.free_cashflow} bRaw={assetB.free_cashflow} />
            <MetricRow label="Debt/Equity" a={assetA.debt_to_equity?.toFixed(2) ?? "—"} b={assetB.debt_to_equity?.toFixed(2) ?? "—"} aRaw={assetA.debt_to_equity} bRaw={assetB.debt_to_equity} higherIsBetter={false} />
            <MetricRow label="RSI" a={assetA.rsi?.toFixed(1) ?? "—"} b={assetB.rsi?.toFixed(1) ?? "—"} aRaw={assetA.rsi} bRaw={assetB.rsi} />
          </div>
        </div>
      )}

      {/* Score comparison */}
      {bothLoaded && (scoreA || scoreB) && (
        <div className="rounded-2xl border p-4 space-y-3" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-xs font-semibold text-white">Analyse-Score</p>
          <div className="grid grid-cols-2 gap-4">
            {[{ sym: symbolA, score: scoreA, color: "#3b82f6" }, { sym: symbolB, score: scoreB, color: "#f59e0b" }].map(({ sym, score, color }) => (
              <div key={sym} className="space-y-2">
                <p className="text-xs font-bold" style={{ color }}>{sym}</p>
                {score ? (
                  <>
                    <ScoreBadge signal={score.signal} score={score.total_score} size="sm" />
                    <ScoreBar label="Gesamt" score={score.total_score} />
                    <ScoreBar label="Fundamental" score={score.fundamental_score} />
                    <ScoreBar label="Technisch" score={score.technical_score} />
                    <ScoreBar label="Risiko (inv.)" score={score.risk_score} />
                  </>
                ) : <Skeleton className="w-full" height="h-20" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Compare */}
      {(symbolA && symbolB) && (
        <AICompareCard symbolA={symbolA} symbolB={symbolB} assetA={assetA} assetB={assetB} snapshotLoaded={bothLoaded} />
      )}
    </div>
  );
}
