"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import type { SignalType } from "@/types/finance";

interface PeerData {
  symbol: string;
  name: string | null;
  price: number | null;
  currency: string | null;
  priceChangePct: number | null;
  totalScore: number | null;
  signal: SignalType;
}

function CompanyLogo({ symbol }: { symbol: string }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
        style={{ background: "var(--card-border)", color: "var(--primary)" }}>
        {symbol.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={`https://financialmodelingprep.com/image-stock/${symbol}.png`}
      onError={() => setError(true)}
      className="w-7 h-7 rounded-lg object-contain flex-shrink-0"
      style={{ background: "var(--card-border)" }}
      alt=""
    />
  );
}

function PeerRow({ symbol, currentSymbol }: { symbol: string; currentSymbol: string }) {
  const [data, setData] = useState<PeerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const assetRes = await fetch(`/api/assets/${symbol}`);
        if (!assetRes.ok || cancelled) return;
        const asset = await assetRes.json();
        if (!cancelled) {
          setData({
            symbol,
            name: asset.name ?? null,
            price: asset.price ?? null,
            currency: asset.currency ?? null,
            priceChangePct: asset.price_change_pct ?? null,
            totalScore: null,
            signal: "Neutral",
          });
          setLoading(false);
        }

        const scoreRes = await fetch(`/api/analyze/${symbol}`, { method: "POST" });
        if (cancelled) return;
        if (scoreRes.ok) {
          const score = await scoreRes.json();
          if (!cancelled) setData(prev => prev ? {
            ...prev,
            totalScore: score.total_score ?? null,
            signal: score.signal ?? "Neutral",
          } : prev);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: "var(--card-border)" }}>
        <Skeleton className="w-7 h-7 rounded-lg flex-shrink-0" height="h-7" />
        <div className="flex-1 space-y-1">
          <Skeleton className="w-16" height="h-3.5" />
          <Skeleton className="w-24" height="h-3" />
        </div>
        <Skeleton className="w-12" height="h-4" />
      </div>
    );
  }

  if (!data) return null;

  const isUp = (data.priceChangePct ?? 0) >= 0;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: "var(--card-border)" }}>
      <CompanyLogo symbol={symbol} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/asset/${symbol}`} className="font-bold text-white text-sm hover:underline">
            {symbol}
          </Link>
          {data.totalScore != null && (
            <ScoreBadge signal={data.signal} score={data.totalScore} size="sm" />
          )}
        </div>
        {data.name && (
          <p className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{data.name}</p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {data.price != null && (
          <span className="text-sm font-semibold text-white">
            {data.price.toFixed(2)}
            <span className="text-[10px] font-normal ml-0.5" style={{ color: "var(--muted)" }}>{data.currency ?? ""}</span>
          </span>
        )}
        {data.priceChangePct != null && (
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{
              color: isUp ? "#22c55e" : "#ef4444",
              background: isUp ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            }}>
            {isUp ? "+" : ""}{data.priceChangePct.toFixed(2)}%
          </span>
        )}
      </div>

      <Link
        href={`/dashboard/compare?a=${currentSymbol}&b=${symbol}`}
        className="text-[11px] px-2.5 py-1.5 rounded-lg font-medium flex-shrink-0"
        style={{ background: "var(--card-border)", color: "var(--muted)" }}>
        vs
      </Link>
    </div>
  );
}

export function PeersSection({ symbol }: { symbol: string }) {
  const [peers, setPeers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/assets/${symbol}/peers`)
      .then(r => r.ok ? r.json() : [])
      .then(setPeers)
      .catch(() => setPeers([]))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (!loading && peers.length === 0) return null;

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--card-border)" }}>
        <p className="text-sm font-semibold text-white">Vergleichbare Unternehmen</p>
      </div>
      <div className="px-4">
        {loading
          ? [1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: "var(--card-border)" }}>
                <Skeleton className="w-7 h-7 rounded-lg flex-shrink-0" height="h-7" />
                <div className="flex-1 space-y-1"><Skeleton className="w-20" height="h-3.5" /><Skeleton className="w-28" height="h-3" /></div>
                <Skeleton className="w-14" height="h-4" />
              </div>
            ))
          : peers.map(p => <PeerRow key={p} symbol={p} currentSymbol={symbol} />)
        }
      </div>
    </div>
  );
}
