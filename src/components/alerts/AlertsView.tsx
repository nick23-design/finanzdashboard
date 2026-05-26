"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { PriceAlert } from "@/types/database";

function alertStyle(direction: "above" | "below") {
  return direction === "below"
    ? { bg: "rgba(34,197,94,0.06)",  border: "rgba(34,197,94,0.28)",  tag: "rgba(34,197,94,0.15)",  color: "#22c55e", label: "Kauf-Alarm"    }
    : { bg: "rgba(251,146,60,0.06)", border: "rgba(251,146,60,0.28)", tag: "rgba(251,146,60,0.15)", color: "#fb923c", label: "Verkauf-Alarm" };
}

function AlertCard({ alert, onDelete }: { alert: PriceAlert; onDelete: (id: string) => void }) {
  const s = alertStyle(alert.direction);
  const dirText = alert.direction === "above" ? "steigt über" : "fällt unter";

  return (
    <div className="rounded-2xl border p-4"
      style={{ background: s.bg, borderColor: s.border }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/dashboard/asset/${alert.symbol}`}
              className="font-bold text-white text-base hover:underline">
              {alert.symbol}
            </Link>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: s.tag, color: s.color }}>
              {s.label}
            </span>
          </div>
          {alert.name && (
            <p className="text-xs mt-0.5 truncate" style={{ color: "var(--muted)" }}>{alert.name}</p>
          )}
          <p className="text-sm font-semibold mt-1.5" style={{ color: s.color }}>
            Alarm wenn Kurs {dirText} ${alert.target_price.toFixed(2)}
          </p>
        </div>
        <button onClick={() => onDelete(alert.id)}
          className="text-xs px-2.5 py-1 rounded-lg flex-shrink-0"
          style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)" }}>
          Löschen
        </button>
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
        Gesetzt: {new Date(alert.created_at).toLocaleDateString("de-DE")}
      </p>
    </div>
  );
}

function TriggeredCard({ alert, onDelete }: { alert: PriceAlert; onDelete: (id: string) => void }) {
  const s = alertStyle(alert.direction);
  return (
    <div className="rounded-2xl border p-3 opacity-50"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-sm">{alert.symbol}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: s.tag, color: s.color }}>
              {s.label}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            {alert.direction === "above" ? "über" : "unter"} ${alert.target_price.toFixed(2)} · ausgelöst{" "}
            {alert.triggered_at ? new Date(alert.triggered_at).toLocaleDateString("de-DE") : ""}
          </p>
        </div>
        <button onClick={() => onDelete(alert.id)}
          className="text-xs px-2 py-1 rounded-lg flex-shrink-0"
          style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)" }}>
          Löschen
        </button>
      </div>
    </div>
  );
}

interface AddFormState {
  symbol: string;
  name: string;
  target_price: string;
  direction: "above" | "below";
}

function AddForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AddFormState>({
    symbol: "", name: "", target_price: "", direction: "below",
  });

  async function lookupName(symbol: string) {
    if (!symbol) return;
    try {
      const res = await fetch(`/api/assets/${symbol.toUpperCase()}`);
      if (res.ok) {
        const d = await res.json();
        if (d.name) setForm(f => ({ ...f, name: d.name }));
        if (d.price && !form.target_price) setForm(f => ({ ...f, target_price: d.price.toFixed(2) }));
      }
    } catch {}
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: form.symbol.toUpperCase(),
          name: form.name,
          target_price: parseFloat(form.target_price),
          direction: form.direction,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehler");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  const field = "w-full rounded-xl px-3 py-2 text-sm text-white border outline-none";
  const fs = { background: "var(--background)", borderColor: "var(--card-border)" };

  return (
    <form onSubmit={handleSubmit}
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <h3 className="font-semibold text-white">Neuer Alarm</h3>
      {error && <p className="text-xs" style={{ color: "#ef4444" }}>{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Ticker *</label>
          <input required className={field} style={fs} placeholder="AAPL"
            value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
            onBlur={e => lookupName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>Zielpreis ($) *</label>
          <input required type="number" step="any" min="0" className={field} style={fs}
            placeholder="200.00" value={form.target_price}
            onChange={e => setForm(f => ({ ...f, target_price: e.target.value }))} />
        </div>
      </div>

      {/* Direction toggle */}
      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--muted)" }}>Alarm-Typ *</label>
        <div className="grid grid-cols-2 gap-2">
          {(["below", "above"] as const).map(dir => {
            const s = alertStyle(dir);
            const active = form.direction === dir;
            return (
              <button key={dir} type="button"
                onClick={() => setForm(f => ({ ...f, direction: dir }))}
                className="py-2 rounded-xl text-xs font-semibold border transition-all"
                style={{
                  background: active ? s.tag : "var(--background)",
                  borderColor: active ? s.color : "var(--card-border)",
                  color: active ? s.color : "var(--muted)",
                }}>
                {s.label}
                <br />
                <span className="text-[10px] font-normal opacity-70">
                  {dir === "below" ? "Kurs fällt unter Ziel" : "Kurs steigt über Ziel"}
                </span>
              </button>
            );
          })}
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

export function AlertsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetSymbol = searchParams.get("symbol")?.toUpperCase() ?? null;
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterSymbol, setFilterSymbol] = useState<string | null>(presetSymbol);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) setAlerts(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    await fetch(`/api/alerts/${id}`, { method: "DELETE" });
    setAlerts(as => as.filter(a => a.id !== id));
  }

  const symbolsFromAlerts = [...new Set(alerts.map(a => a.symbol))].sort();
  const symbols = presetSymbol && !symbolsFromAlerts.includes(presetSymbol)
    ? [presetSymbol, ...symbolsFromAlerts]
    : symbolsFromAlerts;
  const filtered = filterSymbol ? alerts.filter(a => a.symbol === filterSymbol) : alerts;
  const active = filtered.filter(a => !a.triggered);
  const triggered = filtered.filter(a => a.triggered);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-40 rounded-lg animate-pulse" style={{ background: "var(--card-border)" }} />
        <div className="h-12 rounded-xl animate-pulse" style={{ background: "var(--card)" }} />
        <div className="h-20 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-sm"
            style={{ color: "var(--muted)" }}>
            ← Zurück
          </button>
          <h2 className="text-xl font-bold text-white">Kurs-Alarme</h2>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 rounded-xl font-semibold"
            style={{ background: "var(--primary)", color: "#000" }}>
            + Alarm
          </button>
        )}
      </div>

      {/* Symbol filter chips */}
      {(symbols.length > 1 || presetSymbol) && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterSymbol(null)}
            className="text-xs px-3 py-1 rounded-full font-semibold"
            style={{
              background: !filterSymbol ? "var(--primary)" : "var(--card)",
              color: !filterSymbol ? "#000" : "var(--muted)",
              border: `1px solid ${!filterSymbol ? "transparent" : "var(--card-border)"}`,
            }}>
            Alle
          </button>
          {symbols.map(sym => (
            <button key={sym}
              onClick={() => setFilterSymbol(sym === filterSymbol ? null : sym)}
              className="text-xs px-3 py-1 rounded-full font-semibold"
              style={{
                background: filterSymbol === sym ? "var(--primary)" : "var(--card)",
                color: filterSymbol === sym ? "#000" : "var(--muted)",
                border: `1px solid ${filterSymbol === sym ? "transparent" : "var(--card-border)"}`,
              }}>
              {sym}
            </button>
          ))}
        </div>
      )}

      {/* Add Form */}
      {showForm && (
        <AddForm
          onSaved={() => { setShowForm(false); load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Empty state */}
      {filtered.length === 0 && !showForm && (
        <div className="rounded-2xl border p-8 text-center space-y-2"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-3xl">🔔</p>
          <p className="text-sm font-medium text-white">
            {filterSymbol ? `Keine Alarme für ${filterSymbol}` : "Keine aktiven Alarme"}
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Setze Alarme direkt auf der Aktien-Seite oder über &bdquo;+ Alarm&ldquo;.
          </p>
        </div>
      )}

      {/* Active Alerts */}
      {active.length > 0 && (
        <div className="space-y-3">
          {active.map(alert => (
            <AlertCard key={alert.id} alert={alert} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Triggered */}
      {triggered.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--muted)" }}>
            Ausgelöste Alarme
          </p>
          {triggered.map(alert => (
            <TriggeredCard key={alert.id} alert={alert} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
