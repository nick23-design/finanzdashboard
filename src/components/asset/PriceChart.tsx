"use client";

import { useEffect, useRef, useState } from "react";
import type { PricePoint } from "@/types/finance";
import { Skeleton } from "@/components/ui/Skeleton";

const PERIODS = ["1mo", "3mo", "6mo", "1y", "2y"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_LABELS: Record<Period, string> = {
  "1mo": "1M",
  "3mo": "3M",
  "6mo": "6M",
  "1y": "1J",
  "2y": "2J",
};

interface PriceChartProps {
  symbol: string;
}

type LWChart = ReturnType<typeof import("lightweight-charts").createChart>;

export function PriceChart({ symbol }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<LWChart | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [period, setPeriod] = useState<Period>("6mo");
  const [data, setData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changePct, setChangePct] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setChangePct(null);

    fetch(`/api/assets/${symbol}/history?period=${period}`)
      .then((r) => r.json())
      .then((d: PricePoint[]) => {
        if (!cancelled) {
          const pts = Array.isArray(d) ? d : [];
          setData(pts);
          setLoading(false);

          if (pts.length >= 2) {
            const first = pts[0].value;
            const last = pts[pts.length - 1].value;
            setChangePct(first > 0 ? ((last - first) / first) * 100 : null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Kursdaten nicht verfügbar");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [symbol, period]);

  useEffect(() => {
    if (!containerRef.current || loading || error) return;

    let unmounted = false;

    function destroyChart() {
      roRef.current?.disconnect();
      roRef.current = null;

      const c = chartRef.current;
      chartRef.current = null;
      if (c) {
        try { c.remove(); } catch { /* already disposed in Strict Mode */ }
      }
    }

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (unmounted || !containerRef.current) return;

      destroyChart();

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#111111" },
          textColor: "#64748b",
        },
        grid: {
          vertLines: { color: "#222222" },
          horzLines: { color: "#222222" },
        },
        width: containerRef.current.clientWidth,
        height: 220,
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: "#222222" },
        timeScale: { borderColor: "#222222", timeVisible: false },
      });

      const series = chart.addAreaSeries({
        lineColor: "#00e676",
        topColor: "rgba(0,230,118,0.20)",
        bottomColor: "rgba(0,230,118,0)",
        lineWidth: 2,
      });

      const chartData = data.map((p) => ({
        time: p.time as `${number}-${number}-${number}`,
        value: p.value,
      }));

      if (chartData.length > 0) {
        series.setData(chartData);
        chart.timeScale().fitContent();
      }

      chartRef.current = chart;

      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (chartRef.current) {
            try {
              chartRef.current.applyOptions({ width: entry.contentRect.width });
            } catch { /* disposed */ }
          }
        }
      });
      ro.observe(containerRef.current);
      roRef.current = ro;
    });

    return () => {
      unmounted = true;
      destroyChart();
    };
  }, [data, loading, error]);

  const isUp = (changePct ?? 0) >= 0;

  return (
    <div
      className="rounded-2xl border p-4"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-white">Kursverlauf</h3>
          {!loading && changePct != null && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{
                color: isUp ? "#22c55e" : "#ef4444",
                background: isUp ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
              }}>
              {isUp ? "+" : ""}{changePct.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="px-2 py-1 rounded-lg text-xs font-medium transition-all"
              style={{
                background: period === p ? "var(--primary)" : "transparent",
                color: period === p ? "#000" : "var(--muted)",
              }}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Skeleton className="w-full" height="h-[220px]" />
      ) : error ? (
        <div
          className="h-[220px] flex items-center justify-center rounded-xl"
          style={{ background: "var(--background)" }}>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {error}
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="w-full" />
      )}
    </div>
  );
}
