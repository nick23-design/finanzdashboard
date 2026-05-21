"use client";

import { useState, useTransition } from "react";
import type { WatchlistItem } from "@/types/database";
import { WatchlistCard } from "./WatchlistCard";
import { AddTickerForm } from "./AddTickerForm";
import { CardSkeleton } from "@/components/ui/Skeleton";

interface WatchlistViewProps {
  initialItems: WatchlistItem[];
}

export function WatchlistView({ initialItems }: WatchlistViewProps) {
  const [items, setItems] = useState<WatchlistItem[]>(initialItems);
  const [isPending, startTransition] = useTransition();

  function handleAdd(item: WatchlistItem) {
    setItems((prev) => [item, ...prev]);
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Meine Watchlist</h2>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {items.length} Aktie{items.length !== 1 ? "n" : ""}
        </span>
      </div>

      <AddTickerForm onAdd={handleAdd} />

      {isPending && (
        <div className="space-y-3">
          <CardSkeleton />
        </div>
      )}

      {items.length === 0 && !isPending ? (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-3xl mb-2">📋</p>
          <p className="text-white font-medium">Watchlist ist leer</p>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Füge oben einen Ticker hinzu, z.B. AAPL oder MSFT
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <WatchlistCard key={item.id} item={item} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  );
}
