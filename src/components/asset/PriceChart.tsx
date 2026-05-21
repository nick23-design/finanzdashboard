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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/assets/${symbol}/history?period=${period}`)
      .then((r) => r.json())
      .then((d: PricePoint[]) => {
        if (!cancelled) {
          setData(Array.isArray(d) ? d : []);
          setLoading(false);
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

    // Single idempotent teardown used both by cleanup and before re-create.
    // Nulls chartRef BEFORE calling .remove() so a second call is a no-op.
    function destroyChart() {
      roRef.current?.disconnect();
      roRef.current = null;

      const c = chartRef.current;
      chartRef.current = null; // null first — guards double-dispose
      if (c) {
        try { c.remove(); } catch { /* already disposed in Strict Mode */ }
      }
    }

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      // Guard: effect may have already been cleaned up while import was in flight
      if (unmounted || !containerRef.current) return;

      // Tear down any chart left by a previous render before creating a new one
      destroyChart();

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#1e293b" },
          textColor: "#94a3b8",
        },
        grid: {
          vertLines: { color: "#334155" },
          horzLines: { color: "#334155" },
        },
        width: containerRef.current.clientWidth,
        height: 220,
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: "#334155" },
        timeScale: { borderColor: "#334155", timeVisible: false },
      });

      const series = chart.addAreaSeries({
        lineColor: "#3b82f6",
        topColor: "rgba(59,130,246,0.25)",
        bottomColor: "rgba(59,130,246,0)",
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

      // Store in ref only after fully initialised
      chartRef.current = chart;

      // ResizeObserver guards against calling applyOptions on a disposed chart
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

  return (
    <div
      className="rounded-2xl border p-4"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white">Kursverlauf</h3>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="px-2 py-1 rounded-lg text-xs font-medium transition-all"
              style={{
                background: period === p ? "var(--primary)" : "transparent",
                color: period === p ? "white" : "var(--muted)",
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
