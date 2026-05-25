"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PortfolioSummary, PortfolioGroup } from "@/app/api/portfolio/route";
import { PortfolioChart } from "./PortfolioChart";
import { CorrelationMatrix } from "./CorrelationMatrix";

function fmt(n: number, dec = 2) { return n.toFixed(dec); }
function fmtSign(n: number, dec = 2) { return (n >= 0 ? "+" : "") + n.toFixed(dec); }
function currSign(currency?: string | null) {
  if (currency === "EUR") return "€";
  if (currency === "GBP") return "£";
  if (currency === "CHF") return "CHF ";
  return "$";
}

// ── Period ────────────────────────────────────────────────────────────────────

type Period = "all" | "1mo" | "3mo" | "6mo" | "1y";

const PERIODS: { id: Period; label: string }[] = [
  { id: "all",  label: "ALL" },
  { id: "1mo",  label: "1M"  },
  { id: "3mo",  label: "3M"  },
  { id: "6mo",  label: "6M"  },
  { id: "1y",   label: "1J"  },
];

const PERIOD_LABEL: Record<Period, string> = {
  all: "ALL", "1mo": "1M", "3mo": "3M", "6mo": "6M", "1y": "1J",
};

function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex gap-1 p-1 rounded-xl border"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      {PERIODS.map(p => (
        <button key={p.id} onClick={() => onChange(p.id)}
          className="flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all"
          style={{
            background: period === p.id ? "var(--primary)" : "transparent",
            color: period === p.id ? "#000" : "var(--muted)",
          }}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Period summary derived type ───────────────────────────────────────────────

interface PeriodResult {
  totalPnl: number;
  totalPct: number;
  best:  { symbol: string; pct: number } | null;
  worst: { symbol: string; pct: number } | null;
  loading: boolean;
}

// ── Summary Header ────────────────────────────────────────────────────────────

function SummaryCard({
  s, period, ps,
}: {
  s: PortfolioSummary;
  period: Period;
  ps: PeriodResult | null;
}) {
  const isAllTime = period === "all";
  const label = PERIOD_LABEL[period];

  const displayPnl = isAllTime ? s.total_pnl : ps?.totalPnl ?? null;
  const displayPct = isAllTime ? s.total_pnl_pct : ps?.totalPct ?? null;
  const pnlColor = displayPnl == null ? "var(--muted)" : displayPnl >= 0 ? "#22c55e" : "#ef4444";
  const dayColor = s.day_pnl == null ? "var(--muted)" : s.day_pnl >= 0 ? "#22c55e" : "#ef4444";

  const bestDisplay = isAllTime
    ? (s.best ? { symbol: s.best.symbol, pct: s.best.pnl_pct } : null)
    : (ps?.best ?? null);
  const worstDisplay = isAllTime
    ? (s.worst ? { symbol: s.worst.symbol, pct: s.worst.pnl_pct } : null)
    : (ps?.worst ?? null);

  const dayPct = s.day_pnl != null && s.total_current > 0
    ? (s.day_pnl / Math.max(s.total_current - s.day_pnl, 1)) * 100
    : null;

  return (
    <div className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Gesamtwert</p>
          <p className="text-2xl font-bold text-white">{fmt(s.total_current)}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            Investiert: {fmt(s.total_invested)}
          </p>
        </div>
        <div className="text-right min-w-[80px]">
          {!isAllTime && ps?.loading ? (
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin ml-auto"
              style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
          ) : (
            <>
              {displayPnl != null && (
                <p className="text-lg font-bold" style={{ color: pnlColor }}>
                  {fmtSign(displayPnl)}
                </p>
              )}
              {displayPct != null && (
                <p className="text-sm font-semibold" style={{ color: pnlColor }}>
                  {fmtSign(displayPct)}%
                  {!isAllTime && (
                    <span className="text-[10px] font-normal ml-1" style={{ color: "var(--muted)" }}>
                      {label}
                    </span>
                  )}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-2.5" style={{ background: "rgba(100,116,139,0.1)" }}>
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>Heute</p>
          <p className="text-sm font-bold mt-0.5" style={{ color: dayColor }}>
            {s.day_pnl != null ? fmtSign(s.day_pnl) : "—"}
          </p>
          {dayPct != null && (
            <p className="text-[10px] font-semibold" style={{ color: dayColor }}>
              {fmtSign(dayPct, 1)}%
            </p>
          )}
        </div>
        {bestDisplay && (
          <div className="rounded-xl p-2.5" style={{ background: "rgba(34,197,94,0.08)" }}>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>
              Beste{!isAllTime ? ` ${label}` : ""}
            </p>
            <p className="text-xs font-bold text-white mt-0.5">{bestDisplay.symbol}</p>
            <p className="text-[10px] font-semibold" style={{ color: "#22c55e" }}>
              {bestDisplay.pct >= 0 ? "+" : ""}{bestDisplay.pct.toFixed(1)}%
            </p>
          </div>
        )}
        {worstDisplay && worstDisplay.symbol !== bestDisplay?.symbol && (
          <div className="rounded-xl p-2.5" style={{ background: "rgba(239,68,68,0.08)" }}>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>
              Schlechteste{!isAllTime ? ` ${label}` : ""}
            </p>
            <p className="text-xs font-bold text-white mt-0.5">{worstDisplay.symbol}</p>
            <p className="text-[10px] font-semibold" style={{ color: "#ef4444" }}>
              {worstDisplay.pct.toFixed(1)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Position Group ────────────────────────────────────────────────────────────

function PositionCard({
  group, period, startPrice, histLoading, onDelete,
}: {
  group: PortfolioGroup;
  period: Period;
  startPrice: number | null | undefined;
  histLoading: boolean;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cs = currSign(group.currency);

  const isAllTime = period === "all";
  const label = PERIOD_LABEL[period];

  let displayPnl: number | null = null;
  let displayPct: number | null = null;

  if (isAllTime) {
    displayPnl = group.pnl;
    displayPct = group.pnl_pct;
  } else if (startPrice != null && group.current_price != null) {
    displayPct = (group.current_price - startPrice) / startPrice * 100;
    displayPnl = group.total_shares * (group.current_price - startPrice);
  }

  const pnlColor = displayPnl == null ? "var(--muted)" : displayPnl >= 0 ? "#22c55e" : "#ef4444";
  const dayColor = group.day_change_pct == null ? "var(--muted)" : group.day_change_pct >= 0 ? "#22c55e" : "#ef4444";
  const weightPct = group.weight_pct ?? 0;

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <Link href={`/dashboard/asset/${group.symbol}`}
              className="font-bold text-white text-base hover:underline">
              {group.symbol}
            </Link>
            {group.name && (
              <p className="text-xs truncate mt-0.5" style={{ color: "var(--muted)" }}>{group.name}</p>
            )}
          </div>
          <div className="text-right flex-shrink-0 min-w-[70px]">
            {!isAllTime && histLoading ? (
              <div className="w-3 h-3 rounded-full border border-t-transparent animate-spin ml-auto"
                style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
            ) : (
              <>
                {displayPnl != null && (
                  <p className="text-sm font-bold" style={{ color: pnlColor }}>
                    {fmtSign(displayPnl)}{cs}
                  </p>
                )}
                {displayPct != null && (
                  <p className="text-xs font-semibold" style={{ color: pnlColor }}>
                    {fmtSign(displayPct)}%
                    {!isAllTime && (
                      <span className="text-[9px] font-normal ml-0.5" style={{ color: "var(--muted)" }}>
                        {label}
                      </span>
                    )}
                  </p>
                )}
                {!isAllTime && displayPct == null && !histLoading && (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>—</p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 text-xs mb-3">
          <div>
            <p style={{ color: "var(--muted)" }}>Aktien</p>
            <p className="font-semibold text-white">{group.total_shares}</p>
          </div>
          <div>
            <p style={{ color: "var(--muted)" }}>Ø Kauf</p>
            <p className="font-semibold text-white">{cs}{fmt(group.avg_purchase_price)}</p>
          </div>
          <div>
            <p style={{ color: "var(--muted)" }}>Aktuell</p>
            <p className="font-semibold text-white">
              {group.current_price != null ? `${cs}${fmt(group.current_price)}` : "—"}
            </p>
          </div>
          <div>
            <p style={{ color: "var(--muted)" }}>Heute</p>
            <p className="font-semibold" style={{ color: dayColor }}>
              {group.day_change_pct != null ? `${fmtSign(group.day_change_pct, 1)}%` : "—"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--card-border)" }}>
            <div className="h-full rounded-full"
              style={{ width: `${Math.min(100, weightPct)}%`, background: "var(--primary)" }} />
          </div>
          <span className="text-[10px] w-8 text-right" style={{ color: "var(--muted)" }}>
            {weightPct.toFixed(1)}%
          </span>
          {group.lots.length > 1 ? (
            <button className="text-[10px]" style={{ color: "var(--muted)" }}
              onClick={() => setExpanded(v => !v)}>
              {group.lots.length} Lots {expanded ? "▲" : "▼"}
            </button>
          ) : (
            <button
              onClick={() => onDelete(group.lots[0].id)}
              className="text-[10px] px-2 py-0.5 rounded-lg"
              style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)" }}>
              Löschen
            </button>
          )}
        </div>
      </div>

      {expanded && group.lots.length > 1 && (
        <div className="border-t px-4 pb-3 pt-2 space-y-2"
          style={{ borderColor: "var(--card-border)" }}>
          {group.lots.map((lot) => {
            const lotColor = lot.pnl == null ? "var(--muted)" : lot.pnl >= 0 ? "#22c55e" : "#ef4444";
            return (
              <div key={lot.id}
                className="flex items-center justify-between text-xs rounded-xl px-3 py-2"
                style={{ background: "var(--background)" }}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-semibold text-white">
                    {lot.shares} × {cs}{fmt(lot.purchase_price)}
                  </span>
                  {lot.broker && (
                    <span className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ background: "var(--card-border)", color: "var(--muted)" }}>
                      {lot.broker}
                    </span>
                  )}
                  <span style={{ color: "var(--muted)" }}>
                    {new Date(lot.purchase_date).toLocaleDateString("de-DE", {
                      day: "2-digit", month: "2-digit", year: "2-digit",
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {lot.pnl != null && (
                    <span className="font-semibold" style={{ color: lotColor }}>
                      {fmtSign(lot.pnl)}{cs}
                    </span>
                  )}
                  <button
                    onClick={() => onDelete(lot.id)}
                    className="px-2 py-0.5 rounded-lg text-[10px]"
                    style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)" }}>
                    Löschen
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Add Form ──────────────────────────────────────────────────────────────────

interface SearchSuggestion {
  symbol: string;
  name: string;
  exchange: string | null;
}

interface AddFormState {
  symbol: string; name: string; shares: string;
  purchase_price: string; purchase_date: string; broker: string;
}

function AddForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>("USD");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<AddFormState>({
    symbol: "", name: "", shares: "", purchase_price: "",
    purchase_date: new Date().toISOString().slice(0, 10), broker: "",
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function lookupAsset(symbol: string) {
    if (!symbol) return;
    try {
      const res = await fetch(`/api/assets/${symbol.toUpperCase()}`);
      if (res.ok) {
        const d = await res.json();
        if (d.name) setForm(f => ({ ...f, name: d.name }));
        if (d.currency) setCurrency(d.currency);
      }
    } catch {}
  }

  function handleSymbolChange(value: string) {
    setForm(f => ({ ...f, symbol: value }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
        if (res.ok) {
          const data: SearchSuggestion[] = await res.json();
          setSuggestions(data.slice(0, 6));
          setShowSuggestions(data.length > 0);
        }
      } catch {}
    }, 250);
  }

  function selectSuggestion(s: SearchSuggestion) {
    setForm(f => ({ ...f, symbol: s.symbol, name: s.name }));
    setSuggestions([]);
    setShowSuggestions(false);
    lookupAsset(s.symbol);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: form.symbol.toUpperCase(),
          name: form.name,
          shares: parseFloat(form.shares),
          purchase_price: parseFloat(form.purchase_price),
          purchase_date: form.purchase_date,
          broker: form.broker || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Fehler");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  const cs = currSign(currency);
  const field = "w-full rounded-xl px-3 py-2 text-sm text-white border outline-none";
  const fieldStyle = { background: "var(--background)", borderColor: "var(--card-border)" };

  return (
    <form onSubmit={handleSubmit}
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">Neue Position</h3>
        <button type="button" onClick={onCancel}
          className="text-xs px-2 py-1 rounded-lg"
          style={{ color: "var(--muted)", background: "var(--card-border)" }}>
          ✕
        </button>
      </div>
      {error && <p className="text-xs" style={{ color: "#ef4444" }}>{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        {/* Symbol with autocomplete */}
        <div className="col-span-2" ref={dropdownRef}>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Ticker *</label>
          <div className="relative">
            <input
              required
              className={field}
              style={fieldStyle}
              placeholder="z.B. AAPL, SAP, MSFT…"
              autoComplete="off"
              value={form.symbol}
              onChange={e => handleSymbolChange(e.target.value)}
              onBlur={e => {
                setTimeout(() => setShowSuggestions(false), 150);
                lookupAsset(e.target.value);
              }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div
                className="absolute top-full left-0 right-0 z-50 rounded-xl overflow-hidden shadow-xl mt-1"
                style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}>
                {suggestions.map(s => (
                  <button
                    key={s.symbol}
                    type="button"
                    onMouseDown={() => selectSuggestion(s)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:opacity-80 transition-opacity"
                    style={{ background: "transparent", borderBottom: "1px solid var(--card-border)" }}>
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-white">{s.symbol}</span>
                      <span className="text-xs ml-2 truncate" style={{ color: "var(--muted)" }}>{s.name}</span>
                    </div>
                    {s.exchange && (
                      <span className="text-[10px] ml-2 shrink-0 px-1.5 py-0.5 rounded"
                        style={{ background: "var(--card-border)", color: "var(--muted)" }}>
                        {s.exchange}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-2">
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Name</label>
          <input className={field} style={fieldStyle} placeholder="Apple Inc."
            value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>

        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Anzahl Aktien *</label>
          <input required type="number" step="any" min="0" className={field} style={fieldStyle}
            placeholder="10" value={form.shares}
            onChange={e => setForm(f => ({ ...f, shares: e.target.value }))} />
        </div>

        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>
            Einstiegskurs ({cs}) *
            {currency !== "USD" && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                {currency} erkannt
              </span>
            )}
          </label>
          <input required type="number" step="any" min="0" className={field} style={fieldStyle}
            placeholder={currency === "EUR" ? "150,00" : "150.00"}
            value={form.purchase_price}
            onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))} />
        </div>

        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Kaufdatum *</label>
          <input required type="date" className={field} style={fieldStyle}
            value={form.purchase_date}
            onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} />
        </div>

        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Broker (optional)</label>
          <input className={field} style={fieldStyle} placeholder="z.B. Trade Republic"
            value={form.broker} onChange={e => setForm(f => ({ ...f, broker: e.target.value }))} />
        </div>
      </div>

      <button type="submit" disabled={submitting}
        className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
        style={{ background: "var(--primary)", color: "#000" }}>
        {submitting ? "Speichern…" : "Position speichern"}
      </button>
    </form>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function PortfolioView() {
  const [data, setData] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const [histMap, setHistMap] = useState<Record<string, number | null>>({});
  const [histLoading, setHistLoading] = useState(false);
  const histAbort = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/portfolio/${id}`, { method: "DELETE" });
    load();
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (showForm && formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showForm]);

  useEffect(() => {
    if (period === "all" || !data?.groups.length) {
      setHistMap({});
      setHistLoading(false);
      return;
    }

    histAbort.current?.abort();
    const ctrl = new AbortController();
    histAbort.current = ctrl;

    setHistLoading(true);
    setHistMap({});

    const symbols = data.groups.map(g => g.symbol);
    Promise.all(
      symbols.map(async (sym) => {
        try {
          const res = await fetch(`/api/assets/${sym}/history?period=${period}`, {
            signal: ctrl.signal,
          });
          if (!res.ok) return [sym, null] as const;
          const pts: { time: string; value: number }[] = await res.json();
          return [sym, pts[0]?.value ?? null] as const;
        } catch {
          return [sym, null] as const;
        }
      })
    ).then(results => {
      if (ctrl.signal.aborted) return;
      const m: Record<string, number | null> = {};
      for (const [sym, p] of results) m[sym] = p;
      setHistMap(m);
      setHistLoading(false);
    });
  }, [period, data]);

  let ps: PeriodResult | null = null;
  if (period !== "all" && data) {
    const valid = data.groups.filter(g => histMap[g.symbol] != null && g.current_price != null);
    if (valid.length > 0) {
      let startTotal = 0, currentTotal = 0;
      const rets: { symbol: string; pct: number }[] = [];
      for (const g of valid) {
        const sp = histMap[g.symbol]!;
        startTotal  += g.total_shares * sp;
        currentTotal += g.total_shares * g.current_price!;
        rets.push({ symbol: g.symbol, pct: (g.current_price! - sp) / sp * 100 });
      }
      const totalPnl = currentTotal - startTotal;
      const totalPct = startTotal > 0 ? (totalPnl / startTotal) * 100 : 0;
      ps = {
        totalPnl, totalPct,
        best:  rets.reduce((a, b) => b.pct > a.pct ? b : a),
        worst: rets.reduce((a, b) => b.pct < a.pct ? b : a),
        loading: histLoading,
      };
    } else {
      ps = { totalPnl: 0, totalPct: 0, best: null, worst: null, loading: histLoading };
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-32 rounded-lg animate-pulse" style={{ background: "var(--card-border)" }} />
        <div className="h-10 rounded-xl animate-pulse" style={{ background: "var(--card)" }} />
        <div className="h-36 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
        <div className="h-24 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
      </div>
    );
  }

  const isEmpty = !data || data.groups.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Portfolio</h2>
        {!isEmpty && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="text-xs px-3 py-1.5 rounded-xl font-semibold"
            style={{ background: showForm ? "var(--card-border)" : "var(--primary)", color: showForm ? "var(--muted)" : "#000" }}>
            {showForm ? "Abbrechen" : "+ Position"}
          </button>
        )}
      </div>

      {/* Form opens at the top */}
      {showForm && (
        <div ref={formRef}>
          <AddForm
            onSaved={() => { setShowForm(false); load(); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {!isEmpty && <PeriodPicker period={period} onChange={p => setPeriod(p)} />}

      {data && !isEmpty && <SummaryCard s={data} period={period} ps={ps} />}

      {data && !isEmpty && (
        <div className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-xs font-semibold px-4 pt-3 pb-1" style={{ color: "var(--muted)" }}>
            Portfoliowert
          </p>
          <PortfolioChart groups={data.groups} totalInvested={data.total_invested} period={period} />
        </div>
      )}

      {data && data.groups.length >= 2 && (
        <CorrelationMatrix groups={data.groups} />
      )}

      {data && data.groups.map(group => (
        <PositionCard
          key={group.symbol}
          group={group}
          period={period}
          startPrice={histMap[group.symbol]}
          histLoading={histLoading}
          onDelete={handleDelete}
        />
      ))}

      {isEmpty && !showForm && (
        <div className="rounded-2xl border p-8 text-center space-y-3"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-3xl">📊</p>
          <p className="font-semibold text-white">Portfolio ist leer</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Füge deine ersten Positionen hinzu — mehrere Lots pro Aktie möglich.
          </p>
          <button onClick={() => setShowForm(true)}
            className="mt-1 px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "var(--primary)", color: "#000" }}>
            + Erste Position hinzufügen
          </button>
        </div>
      )}

      {isEmpty && showForm && (
        <div ref={formRef}>
          <AddForm
            onSaved={() => { setShowForm(false); load(); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}
    </div>
  );
}
