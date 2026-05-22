"use client";

import type { EarningsCalendar } from "@/lib/finance-client";

interface Props {
  earnings: EarningsCalendar;
}

export function EarningsCard({ earnings }: Props) {
  if (!earnings.next_earnings_date && earnings.eps_estimate == null) return null;

  const dateStr = earnings.next_earnings_date
    ? new Date(earnings.next_earnings_date).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  const daysUntil = earnings.next_earnings_date
    ? Math.ceil(
        (new Date(earnings.next_earnings_date).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  const fmtBig = (n: number) => {
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(1)} T`;
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)} Mrd.`;
    return `$${(n / 1e6).toFixed(1)} Mio.`;
  };

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <h3 className="font-semibold text-white">Quartalszahlen</h3>

      {dateStr && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Nächster Termin
            </p>
            <p className="text-sm font-semibold text-white">{dateStr}</p>
          </div>
          {daysUntil != null && (
            <span
              className="text-xs px-2 py-1 rounded-full font-medium"
              style={{
                background: daysUntil <= 14 ? "rgba(251,191,36,0.15)" : "rgba(100,116,139,0.2)",
                color: daysUntil <= 14 ? "#fbbf24" : "var(--muted)",
              }}>
              {daysUntil > 0 ? `in ${daysUntil} Tagen` : daysUntil === 0 ? "Heute" : "Vergangen"}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {earnings.eps_estimate != null && (
          <div
            className="rounded-xl p-3"
            style={{ background: "rgba(100,116,139,0.1)" }}>
            <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>
              EPS-Schätzung
            </p>
            <p className="text-sm font-semibold text-white">
              ${earnings.eps_estimate.toFixed(2)}
            </p>
          </div>
        )}
        {earnings.revenue_estimate != null && (
          <div
            className="rounded-xl p-3"
            style={{ background: "rgba(100,116,139,0.1)" }}>
            <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>
              Umsatz-Schätzung
            </p>
            <p className="text-sm font-semibold text-white">
              {fmtBig(earnings.revenue_estimate)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
