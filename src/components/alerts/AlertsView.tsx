"use client";

import { useEffect, useState } from "react";
import type { PriceAlert } from "@/types/database";

interface AddFormState {
  symbol: string;
  name: string;
  target_price: string;
  direction: "above" | "below";
}

export function AlertsView() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<AddFormState>({
    symbol: "",
    name: "",
    target_price: "",
    direction: "above",
  });

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

  async function lookupName(symbol: string) {
    if (!symbol) return;
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
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Fehler beim Speichern");
      }
      setShowForm(false);
      setForm({ symbol: "", name: "", target_price: "", direction: "above" });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/alerts/${id}`, { method: "DELETE" });
    setAlerts(as => as.filter(a => a.id !== id));
  }

  const active = alerts.filter(a => !a.triggered);
  const triggered = alerts.filter(a => a.triggered);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-32 rounded-lg animate-pulse" style={{ background: "var(--card-border)" }} />
        <div className="h-20 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Kurs-Alarme</h2>

      {active.length === 0 && !showForm && (
        <div
          className="rounded-2xl border p-6 text-center"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-3xl mb-2">🔔</p>
          <p className="text-sm font-medium text-white mb-1">Keine aktiven Alarme</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Erhalte eine E-Mail, wenn ein Kurs dein Ziel erreicht.
          </p>
        </div>
      )}

      {/* Active Alerts */}
      {active.map(alert => (
        <div
          key={alert.id}
          className="rounded-2xl border p-4"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-bold text-white">{alert.symbol}</p>
              {alert.name && (
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{alert.name}</p>
              )}
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                background: alert.direction === "above" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                color: alert.direction === "above" ? "#22c55e" : "#ef4444",
              }}>
              {alert.direction === "above" ? "über" : "unter"} ${alert.target_price.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Gesetzt: {new Date(alert.created_at).toLocaleDateString("de-DE")}
            </p>
            <button
              onClick={() => handleDelete(alert.id)}
              className="text-xs px-2 py-1 rounded-lg"
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
          + Alarm hinzufügen
        </button>
      )}

      {/* Add Form */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          className="rounded-2xl border p-4 space-y-3"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <h3 className="font-semibold text-white">Neuer Alarm</h3>

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
                Richtung *
              </label>
              <select
                value={form.direction}
                onChange={e => setForm(f => ({ ...f, direction: e.target.value as "above" | "below" }))}
                className="w-full rounded-xl px-3 py-2 text-sm text-white border"
                style={{ background: "var(--bg)", borderColor: "var(--card-border)" }}>
                <option value="above">Über Preis</option>
                <option value="below">Unter Preis</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--muted)" }}>
              Zielpreis ($) *
            </label>
            <input
              required
              type="number"
              step="any"
              min="0"
              value={form.target_price}
              onChange={e => setForm(f => ({ ...f, target_price: e.target.value }))}
              placeholder="200.00"
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

      {/* Triggered Alerts */}
      {triggered.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted)" }}>
            Ausgelöste Alarme
          </p>
          {triggered.map(alert => (
            <div
              key={alert.id}
              className="rounded-2xl border p-3 mb-2 opacity-50"
              style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-white">{alert.symbol}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {alert.direction === "above" ? "über" : "unter"} ${alert.target_price.toFixed(2)} — ausgelöst{" "}
                    {alert.triggered_at
                      ? new Date(alert.triggered_at).toLocaleDateString("de-DE")
                      : ""}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(alert.id)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)" }}>
                  Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
