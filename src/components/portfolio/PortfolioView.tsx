"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PortfolioPositionEnriched } from "@/app/api/portfolio/route";

function fmt(n: number, dec = 2) {
  return n.toFixed(dec);
}

function fmtSign(n: number) {
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function PnlBadge({ value, pct }: { value: number; pct: number }) {
  const color = value >= 0 ? "#22c55e" : "#ef4444";
  return (
    <div className="text-right">
      <p className="text-sm font-semibold" style={{ color }}>
        {fmtSign(value)} $
      </p>
      <p className="text-xs" style={{ color }}>
        {fmtSign(pct)}%
      </p>
    </div>
  );
}

interface AddFormState {
  symbol: string;
  name: string;
  shares: string;
  purchase_price: string;
  purchase_date: string;
}

export function PortfolioView() {
  const [positions, setPositions] = useState<PortfolioPositionEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<AddFormState>({
    symbol: "",
    name: "",
    shares: "",
    purchase_price: "",
    purchase_date: new Date().toISOString().slice(0, 10),
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) setPositions(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function lookupName(symbol: string) {
    if (!symbol || symbol.length < 1) return;
    try {
      const res = await fetch(`/api/assets/${symbol.toUpperCase()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.name) setForm(f => ({ ...f, name: data.name }));
      }
    } catch {}
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
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
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Fehler beim Speichern");
      }
      setShowForm(false);
      setForm({ symbol: "", name: "", shares: "", purchase_price: "", purchase_date: new Date().toISOString().slice(0, 10) });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/portfolio/${id}`, { method: "DELETE" });
    setPositions(ps => ps.filter(p => p.id !== id));
  }

  const totalInvested = positions.reduce((s, p) => s + p.purchase_value, 0);
  const totalCurrent = positions.reduce((s, p) => s + (p.current_value ?? p.purchase_value), 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-32 rounded-lg animate-pulse" style={{ background: "var(--card-border)" }} />
        <div className="h-28 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
        <div className="h-20 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Portfolio</h2>

      {/* Summary */}
      {positions.length > 0 && (
        <div
          className="rounded-2xl border p-4 space-y-3"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>Investiert</p>
              <p className="text-lg font-bold text-white">${fmt(totalInvested)}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>Aktueller Wert</p>
              <p className="text-lg font-bold text-white">${fmt(totalCurrent)}</p>
            </div>
          </div>
          <div
            className="rounded-xl p-3 flex items-center justify-between"
            style={{ background: totalPnl >= 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--muted)" }}>Gesamt P&L</p>
            <div className="text-right">
              <p className="text-base font-bold" style={{ color: totalPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                {fmtSign(totalPnl)} $
              </p>
              <p className="text-xs font-semibold" style={{ color: totalPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                {fmtSign(totalPnlPct)}%
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Positions */}
      {positions.map(p => (
        <div
          key={p.id}
          className="rounded-2xl border p-4"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <Link
                href={`/dashboard/asset/${p.symbol}`}
                className="font-bold text-white hover:underline">
                {p.symbol}
              </Link>
              {p.name && (
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{p.name}</p>
              )}
            </div>
            {p.pnl != null && p.pnl_pct != null && (
              <PnlBadge value={p.pnl} pct={p.pnl_pct} />
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs mb-3">
            <div>
              <p style={{ color: "var(--muted)" }}>Aktien</p>
              <p className="font-semibold text-white">{p.shares}</p>
            </div>
            <div>
              <p style={{ color: "var(--muted)" }}>Kaufpreis</p>
              <p className="font-semibold text-white">${fmt(p.purchase_price)}</p>
            </div>
            <div>
              <p style={{ color: "var(--muted)" }}>Aktuell</p>
              <p className="font-semibold text-white">
                {p.current_price != null ? `$${fmt(p.current_price)}` : "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Gekauft: {new Date(p.purchase_date).toLocaleDateString("de-DE")}
            </p>
            <button
              onClick={() => handleDelete(p.id)}
              className="text-xs px-2 py-1 rounded-lg transition-opacity hover:opacity-80"
              style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)" }}>
              Löschen
            </button>
          </div>
        </div>
      ))}

      {/* Add Button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 rounded-2xl border-2 border-dashed text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--card-border)", color: "var(--muted)" }}>
          + Position hinzufügen
        </button>
      )}

      {/* Add Form */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          className="rounded-2xl border p-4 space-y-3"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <h3 className="font-semibold text-white">Neue Position</h3>

          {formError && (
            <p className="text-xs" style={{ color: "#ef4444" }}>{formError}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>
                Ticker *
              </label>
              <input
                required
                value={form.symbol}
                onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
                onBlur={e => lookupName(e.target.value)}
                placeholder="z.B. AAPL"
                className="w-full rounded-xl px-3 py-2 text-sm text-white border"
                style={{ background: "var(--bg)", borderColor: "var(--card-border)" }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>
                Name
              </label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Apple Inc."
                className="w-full rounded-xl px-3 py-2 text-sm text-white border"
                style={{ background: "var(--bg)", borderColor: "var(--card-border)" }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>
                Anzahl Aktien *
              </label>
              <input
                required
                type="number"
                step="any"
                min="0"
                value={form.shares}
                onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
                placeholder="100"
                className="w-full rounded-xl px-3 py-2 text-sm text-white border"
                style={{ background: "var(--bg)", borderColor: "var(--card-border)" }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>
                Kaufpreis ($) *
              </label>
              <input
                required
                type="number"
                step="any"
                min="0"
                value={form.purchase_price}
                onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))}
                placeholder="150.00"
                className="w-full rounded-xl px-3 py-2 text-sm text-white border"
                style={{ background: "var(--bg)", borderColor: "var(--card-border)" }}
              />
            </div>
          </div>

          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>
              Kaufdatum *
            </label>
            <input
              required
              type="date"
              value={form.purchase_date}
              onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
              className="w-full rounded-xl px-3 py-2 text-sm text-white border"
              style={{ background: "var(--bg)", borderColor: "var(--card-border)" }}
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
              style={{ background: "var(--primary)", color: "#000" }}>
              {submitting ? "Speichern…" : "Speichern"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: "var(--card-border)", color: "var(--muted)" }}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
