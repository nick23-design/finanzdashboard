"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import type { WatchlistItem } from "@/types/database";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import type { SignalType } from "@/types/finance";

interface WatchlistCardProps {
  item: WatchlistItem;
  onRemove: (id: string) => void;
}

interface QuickData {
  price: number | null;
  currency: string | null;
  signal: SignalType;
  totalScore: number;
}

export function WatchlistCard({ item, onRemove }: WatchlistCardProps) {
  const [data, setData] = useState<QuickData | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [assetRes, scoreRes] = await Promise.all([
          fetch(`/api/assets/${item.symbol}`),
          fetch(`/api/analyze/${item.symbol}`, { method: "POST" }),
        ]);

        if (cancelled) return;

        const asset = assetRes.ok ? await assetRes.json() : null;
        const score = scoreRes.ok ? await scoreRes.json() : null;

        setData({
          price: asset?.price ?? null,
          currency: asset?.currency ?? null,
          signal: score?.signal ?? "Neutral",
          totalScore: score?.total_score ?? 50,
        });
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [item.symbol]);

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-bold text-white text-base">{item.symbol}</span>
          {item.name && item.name !== item.symbol && (
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              {item.name}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {loading ? (
            <Skeleton className="w-24" height="h-6" />
          ) : data ? (
            <ScoreBadge signal={data.signal} score={data.totalScore} size="sm" />
          ) : (
            <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>
          )}
        </div>
      </div>

      {/* Price row */}
      <div className="flex items-center justify-between">
        {loading ? (
          <Skeleton className="w-20" height="h-5" />
        ) : (
          <span className="text-lg font-semibold text-white">
            {data?.price != null
              ? `${data.price.toFixed(2)} ${data.currency ?? ""}`
              : "—"}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Link
          href={`/dashboard/asset/${item.symbol}`}
          className="flex-1 rounded-xl py-2 text-center text-sm font-medium text-white transition-all"
          style={{ background: "var(--primary)" }}>
          Details
        </Link>

        {confirmDelete ? (
          <div className="flex gap-1 flex-1">
            <button
              onClick={() => onRemove(item.id)}
              className="flex-1 rounded-xl py-2 text-sm font-medium text-white"
              style={{ background: "var(--danger)" }}>
              Löschen
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 rounded-xl py-2 text-sm"
              style={{ color: "var(--muted)" }}>
              Nein
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded-xl px-3 py-2 text-sm"
            style={{ color: "var(--muted)" }}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
