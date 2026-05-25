"use client";

import { useEffect, useState } from "react";
import type { MacroIndicator } from "@/app/api/market/macro/route";

export function MacroBar() {
  const [indicators, setIndicators] = useState<MacroIndicator[]>([]);

  useEffect(() => {
    fetch("/api/market/macro")
      .then(r => r.ok ? r.json() : [])
      .then(setIndicators)
      .catch(() => {});
  }, []);

  if (!indicators.length) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
      {indicators.map(ind => {
        if (ind.value == null) return null;
        const up = (ind.change_pct ?? 0) > 0;
        const down = (ind.change_pct ?? 0) < 0;
        const color = ind.key === "vix"
          ? ((ind.value ?? 0) > 25 ? "#ef4444" : (ind.value ?? 0) > 18 ? "#fb923c" : "#22c55e")
          : up ? "#22c55e" : down ? "#ef4444" : "var(--muted)";

        return (
          <div key={ind.key}
            className="flex-shrink-0 rounded-xl px-3 py-2 min-w-[80px]"
            style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}>
            <p className="text-[10px] font-medium" style={{ color: "var(--muted)" }}>{ind.label}</p>
            <p className="text-xs font-bold mt-0.5" style={{ color }}>
              {ind.value.toFixed(ind.key === "tnx" ? 2 : 0)}{ind.unit}
            </p>
            {ind.change_pct != null && (
              <p className="text-[10px] font-medium mt-0.5" style={{ color }}>
                {up ? "▲" : down ? "▼" : ""} {Math.abs(ind.change_pct).toFixed(2)}%
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
