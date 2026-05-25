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
  const w = 52, h = 22;
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
      <polyline points={pts.join(" ")} fill="none" stroke={color}
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CompanyLogo({ symbol }: { symbol: string }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0"
        style={{ background: "var(--card-border)", color: "var(--primary)" }}>
        {symbol.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={`https://financialmodelingprep.com/image-stock/${symbol}.png`}
      onError={() => setError(true)}
      className="w-6 h-6 rounded-md object-contain flex-shrink-0"
      style={{ background: "var(--card-border)" }}
      alt=""
    />
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
      <div className="p-3 space-y-2">
        <Link href={`/dashboard/asset/${item.symbol}`} className="block space-y-2">

          {/* Top: logo + symbol + sparkline */}
          <div className="flex items-start justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <CompanyLogo symbol={item.symbol} />
              <span className="font-bold text-white text-sm truncate">{item.symbol}</span>
            </div>
            {!loading && data && data.sparkline.length >= 2 && (
              <Sparkline prices={data.sparkline} isUp={isUp} />
            )}
          </div>

          {/* Company name */}
          {item.name && item.name !== item.symbol && (
            <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>
              {item.name}
            </p>
          )}

          {/* Price */}
          {loading ? (
            <Skeleton className="w-16" height="h-5" />
          ) : (
            <div>
              <p className="text-sm font-semibold text-white leading-tight">
                {data?.price != null ? data.price.toFixed(2) : "—"}
                <span className="text-[10px] font-normal ml-1" style={{ color: "var(--muted)" }}>
                  {data?.currency ?? ""}
                </span>
              </p>
              {data?.priceChangePct != null && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{
                    color: isUp ? "#22c55e" : "#ef4444",
                    background: isUp ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                  }}>
                  {isUp ? "+" : ""}{data.priceChangePct.toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </Link>

        {/* Score badge + delete */}
        <div className="flex items-center justify-between pt-0.5">
          {loading ? (
            <Skeleton className="w-14" height="h-5" />
          ) : data ? (
            <ScoreBadge signal={data.signal} score={data.totalScore} size="sm" />
          ) : (
            <span />
          )}
          {confirmDelete ? (
            <div className="flex gap-1">
              <button onClick={() => onRemove(item.id)}
                className="rounded-lg px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ background: "var(--danger)" }}>
                Ja
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="rounded-lg px-2 py-0.5 text-[10px]"
                style={{ color: "var(--muted)" }}>
                Nein
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{ color: "var(--muted)" }}>
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
