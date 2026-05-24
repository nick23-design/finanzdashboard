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
  priceChangePct: number | null;
  sparkline: number[];
}

function Sparkline({ prices, isUp }: { prices: number[]; isUp: boolean }) {
  if (prices.length < 2) return null;
  const w = 72, h = 28;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((p, i) => {
    const x = ((i / (prices.length - 1)) * w).toFixed(1);
    const y = (h - ((p - min) / range) * (h - 4) - 2).toFixed(1);
    return `${x},${y}`;
  });
  const color = isUp ? "#22c55e" : "#ef4444";
  return (
    <svg width={w} height={h} className="flex-shrink-0 opacity-80">
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WatchlistCard({ item, onRemove }: WatchlistCardProps) {
  const [data, setData] = useState<QuickData | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [assetRes, scoreRes, histRes] = await Promise.all([
          fetch(`/api/assets/${item.symbol}`),
          fetch(`/api/analyze/${item.symbol}`, { method: "POST" }),
          fetch(`/api/assets/${item.symbol}/history?period=1mo`),
        ]);

        if (cancelled) return;

        const asset = assetRes.ok ? await assetRes.json() : null;
        const score = scoreRes.ok ? await scoreRes.json() : null;
        const hist = histRes.ok ? await histRes.json() : [];
        const sparkline: number[] = Array.isArray(hist)
          ? hist.map((p: { value: number }) => p.value)
          : [];

        const currentPrice: number | null = asset?.price ?? null;
        const prevClose: number | null = sparkline.length >= 1
          ? sparkline[sparkline.length - 1]
          : null;
        const priceChangePct =
          currentPrice != null && prevClose != null && prevClose > 0
            ? ((currentPrice - prevClose) / prevClose) * 100
            : (asset?.price_change_pct ?? null);

        setData({
          price: currentPrice,
          currency: asset?.currency ?? null,
          signal: score?.signal ?? "Neutral",
          totalScore: score?.total_score ?? 50,
          priceChangePct,
          sparkline,
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

  const isUp = (data?.priceChangePct ?? 0) >= 0;
  const accentColor = !loading && data ? (isUp ? "#22c55e" : "#ef4444") : "transparent";

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--card)",
        border: "1px solid var(--card-border)",
        borderLeftWidth: "3px",
        borderLeftColor: accentColor,
      }}>
      <div className="p-4 space-y-3">
        {/* Clickable area → asset detail */}
        <Link href={`/dashboard/asset/${item.symbol}`} className="block space-y-3">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="font-bold text-white text-base">{item.symbol}</span>
              {item.name && item.name !== item.symbol && (
                <p className="text-xs mt-0.5 truncate" style={{ color: "var(--muted)" }}>
                  {item.name}
                </p>
              )}
            </div>
            <div className="flex-shrink-0">
              {loading ? (
                <Skeleton className="w-20" height="h-6" />
              ) : data ? (
                <ScoreBadge signal={data.signal} score={data.totalScore} size="sm" />
              ) : (
                <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>
              )}
            </div>
          </div>

          {/* Price + Sparkline row */}
          <div className="flex items-center justify-between gap-3">
            {loading ? (
              <Skeleton className="w-24" height="h-6" />
            ) : (
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="text-lg font-semibold text-white">
                  {data?.price != null
                    ? `${data.price.toFixed(2)} ${data.currency ?? ""}`
                    : "—"}
                </span>
                {data?.priceChangePct != null && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      color: isUp ? "#22c55e" : "#ef4444",
                      background: isUp ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                    }}>
                    {isUp ? "+" : ""}
                    {data.priceChangePct.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
            {!loading && data && data.sparkline.length >= 2 && (
              <Sparkline prices={data.sparkline} isUp={isUp} />
            )}
          </div>
        </Link>

        {/* Actions */}
        <div className="flex justify-end">
          {confirmDelete ? (
            <div className="flex gap-1">
              <button
                onClick={() => onRemove(item.id)}
                className="rounded-xl px-3 py-1.5 text-sm font-medium text-white"
                style={{ background: "var(--danger)" }}>
                Löschen
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl px-3 py-1.5 text-sm"
                style={{ color: "var(--muted)" }}>
                Nein
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-xl px-3 py-1.5 text-sm"
              style={{ color: "var(--muted)" }}>
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
