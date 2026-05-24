"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PortfolioSummary, PortfolioGroup } from "@/app/api/portfolio/route";

function fmt(n: number, dec = 2) { return n.toFixed(dec); }
function fmtSign(n: number, dec = 2) { return (n >= 0 ? "+" : "") + n.toFixed(dec); }
function fmtK(n: number) {
  if (Math.abs(n) >= 1000) return (n >= 0 ? "" : "-") + "$" + Math.abs(n / 1000).toFixed(1) + "k";
  return (n >= 0 ? "" : "-") + "$" + Math.abs(n).toFixed(2);
}

// ── Summary Header ────────────────────────────────────────────────────────────

function SummaryCard({ s }: { s: PortfolioSummary }) {
  const pnlColor = s.total_pnl >= 0 ? "#22c55e" : "#ef4444";
  const dayColor = s.day_pnl == null ? "var(--muted)" : s.day_pnl >= 0 ? "#22c55e" : "#ef4444";

  return (
    <div className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      {/* Gesamt */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Gesamtwert</p>
          <p className="text-2xl font-bold text-white">${fmt(s.total_current)}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            Investiert: ${fmt(s.total_invested)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold" style={{ color: pnlColor }}>
            {fmtSign(s.total_pnl)}$
          </p>
          <p className="text-sm font-semibold" style={{ color: pnlColor }}>
            {fmtSign(s.total_pnl_pct)}%
          </p>
        </div>
      </div>

      {/* Tagesveränderung + Best/Worst */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-2.5" style={{ background: "rgba(100,116,139,0.1)" }}>
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>Heute</p>
          <p className="text-sm font-bold mt-0.5" style={{ color: dayColor }}>
            {s.day_pnl != null ? fmtSign(s.day_pnl) + "$" : "—"}
          </p>
        </div>
        {s.best && (
          <div className="rounded-xl p-2.5" style={{ background: "rgba(34,197,94,0.08)" }}>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>Beste</p>
            <p className="text-xs font-bold text-white mt-0.5">{s.best.symbol}</p>
            <p className="text-[10px] font-semibold" style={{ color: "#22c55e" }}>
              +{s.best.pnl_pct.toFixed(1)}%
            </p>
          </div>
        )}
        {s.worst && s.worst.symbol !== s.best?.symbol && (
          <div className="rounded-xl p-2.5" style={{ background: "rgba(239,68,68,0.08)" }}>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>Schlechteste</p>
            <p className="text-xs font-bold text-white mt-0.5">{s.worst.symbol}</p>
            <p className="text-[10px] font-semibold" style={{ color: "#ef4444" }}>
              {s.worst.pnl_pct.toFixed(1)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Position Group ────────────────────────────────────────────────────────────

function PositionCard({ group, totalCurrent }: { group: PortfolioGroup; totalCurrent: number }) {
  const [expanded, setExpanded] = useState(false);
  const pnlColor = group.pnl == null ? "var(--muted)" : group.pnl >= 0 ? "#22c55e" : "#ef4444";
  const dayColor = group.day_change_pct == null ? "var(--muted)" : group.day_change_pct >= 0 ? "#22c55e" : "#ef4444";
  const weightPct = group.weight_pct ?? 0;

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      {/* Main row */}
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
          <div className="text-right flex-shrink-0">
            {group.pnl != null && (
              <p className="text-sm font-bold" style={{ color: pnlColor }}>
                {fmtSign(group.pnl)}$
              </p>
            )}
            {group.pnl_pct != null && (
              <p className="text-xs font-semibold" style={{ color: pnlColor }}>
                {fmtSign(group.pnl_pct)}%
              </p>
            )}
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-4 gap-1.5 text-xs mb-3">
          <div>
            <p style={{ color: "var(--muted)" }}>Aktien</p>
            <p className="font-semibold text-white">{group.total_shares}</p>
          </div>
          <div>
            <p style={{ color: "var(--muted)" }}>Ø Kauf</p>
            <p className="font-semibold text-white">${fmt(group.avg_purchase_price)}</p>
          </div>
          <div>
            <p style={{ color: "var(--muted)" }}>Aktuell</p>
            <p className="font-semibold text-white">
              {group.current_price != null ? `$${fmt(group.current_price)}` : "—"}
            </p>
          </div>
          <div>
            <p style={{ color: "var(--muted)" }}>Heute</p>
            <p className="font-semibold" style={{ color: dayColor }}>
              {group.day_change_pct != null
                ? `${fmtSign(group.day_change_pct, 1)}%`
                : "—"}
            </p>
          </div>
        </div>

        {/* Weight bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--card-border)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, weightPct)}%`, background: "var(--primary)" }} />
          </div>
          <span className="text-[10px] w-8 text-right" style={{ color: "var(--muted)" }}>
            {weightPct.toFixed(1)}%
          </span>
          {group.lots.length > 1 && (
            <button className="text-[10px]" style={{ color: "var(--muted)" }}
              onClick={() => setExpanded(v => !v)}>
              {group.lots.length} Lots {expanded ? "▲" : "▼"}
            </button>
          )}
        </div>
      </div>

      {/* Lots detail (expandable for multi-broker) */}
      {expanded && group.lots.length > 1 && (
        <div className="border-t px-4 pb-3 pt-2 space-y-2"
          style={{ borderColor: "var(--card-border)" }}>
          {group.lots.map((lot, i) => {
            const lotPnlColor = lot.pnl == null ? "var(--muted)" : lot.pnl >= 0 ? "#22c55e" : "#ef4444";
            return (
              <div key={lot.id} className="flex items-center justify-between text-xs rounded-xl px-3 py-2"
                style={{ background: "var(--background)" }}>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-white">
                    {lot.shares} × ${fmt(lot.purchase_price)}
                  </span>
                  {lot.broker && (
                    <span className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ background: "var(--card-border)", color: "var(--muted)" }}>
                      {lot.broker}
                    </span>
                  )}
                  <span style={{ color: "var(--muted)" }}>
                    {new Date(lot.purchase_date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  </span>
                </div>
                {lot.pnl != null && (
                  <span className="font-semibold" style={{ color: lotPnlColor }}>
                    {fmtSign(lot.pnl)}$
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Add Form ──────────────────────────────────────────────────────────────────

interface AddFormState {
  symbol: string; name: string; shares: string;
  purchase_price: string; purchase_date: string; broker: string;
}

function AddForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AddFormState>({
    symbol: "", name: "", shares: "", purchase_price: "",
    purchase_date: new Date().toISOString().slice(0, 10), broker: "",
  });

  async function lookupName(symbol: string) {
    if (!symbol) return;
    try {
      const res = await fetch(`/api/assets/${symbol.toUpperCase()}`);
      if (res.ok) {
        const d = await res.json();
        if (d.name) setForm(f => ({ ...f, name: d.name }));
      }
    } catch {}
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

  const field = "w-full rounded-xl px-3 py-2 text-sm text-white border outline-none";
  const style = { background: "var(--background)", borderColor: "var(--card-border)" };

  return (
    <form onSubmit={handleSubmit}
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <h3 className="font-semibold text-white">Neue Position</h3>
      {error && <p className="text-xs" style={{ color: "#ef4444" }}>{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Ticker *</label>
          <input required className={field} style={style} placeholder="AAPL"
            value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
            onBlur={e => lookupName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Name</label>
          <input className={field} style={style} placeholder="Apple Inc."
            value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Anzahl Aktien *</label>
          <input required type="number" step="any" min="0" className={field} style={style}
            placeholder="10" value={form.shares}
            onChange={e => setForm(f => ({ ...f, shares: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Einstiegskurs ($) *</label>
          <input required type="number" step="any" min="0" className={field} style={style}
            placeholder="150.00" value={form.purchase_price}
            onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Kaufdatum *</label>
          <input required type="date" className={field} style={style}
            value={form.purchase_date}
            onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Broker (optional)</label>
          <input className={field} style={style} placeholder="z.B. Trade Republic"
            value={form.broker} onChange={e => setForm(f => ({ ...f, broker: e.target.value }))} />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={submitting}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
          style={{ background: "var(--primary)", color: "#000" }}>
          {submitting ? "Speichern…" : "Speichern"}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: "var(--card-border)", color: "var(--muted)" }}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function PortfolioView() {
  const [data, setData] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

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

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-32 rounded-lg animate-pulse" style={{ background: "var(--card-border)" }} />
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
          <button onClick={() => setShowForm(v => !v)}
            className="text-xs px-3 py-1.5 rounded-xl font-semibold"
            style={{ background: "var(--primary)", color: "#000" }}>
            + Position
          </button>
        )}
      </div>

      {/* Summary */}
      {data && !isEmpty && <SummaryCard s={data} />}

      {/* Add Form */}
      {showForm && (
        <AddForm
          onSaved={() => { setShowForm(false); load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Positions */}
      {data && data.groups.map(group => (
        <div key={group.symbol}>
          <PositionCard group={group} totalCurrent={data.total_current} />
          {/* Delete button per lot shown only when single lot */}
          {group.lots.length === 1 && (
            <div className="flex justify-end mt-1 pr-1">
              <button onClick={() => handleDelete(group.lots[0].id)}
                className="text-xs px-2 py-0.5 rounded-lg"
                style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)" }}>
                Löschen
              </button>
            </div>
          )}
          {group.lots.length > 1 && (
            <div className="flex justify-end mt-1 pr-1 gap-2">
              {group.lots.map(lot => (
                <button key={lot.id} onClick={() => handleDelete(lot.id)}
                  className="text-[10px] px-2 py-0.5 rounded-lg"
                  style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)" }}>
                  Lot {new Date(lot.purchase_date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })} löschen
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Empty state */}
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
        <AddForm
          onSaved={() => { setShowForm(false); load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
