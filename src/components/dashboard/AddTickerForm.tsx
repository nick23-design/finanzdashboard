"use client";

import { useState, useTransition } from "react";
import type { WatchlistItem } from "@/types/database";

interface AddTickerFormProps {
  onAdd: (item: WatchlistItem) => void;
}

export function AddTickerForm({ onAdd }: AddTickerFormProps) {
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ticker = symbol.trim().toUpperCase();
    if (!ticker) return;

    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: ticker, name: ticker }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Fehler beim Hinzufügen");
        return;
      }

      onAdd(data as WatchlistItem);
      setSymbol("");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        placeholder="Ticker (z.B. AAPL)"
        maxLength={10}
        required
        className="flex-1 rounded-xl px-4 py-3 text-white text-sm border outline-none"
        style={{
          background: "var(--card)",
          borderColor: error ? "var(--danger)" : "var(--card-border)",
        }}
      />
      <button
        type="submit"
        disabled={isPending || !symbol.trim()}
        className="rounded-xl px-4 py-3 font-semibold text-white text-sm transition-all
          disabled:opacity-50 flex-shrink-0"
        style={{ background: "var(--primary)" }}>
        {isPending ? "…" : "+ Hinzufügen"}
      </button>
      {error && (
        <p className="w-full text-xs mt-1" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </form>
  );
}
