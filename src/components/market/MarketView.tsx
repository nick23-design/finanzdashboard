"use client";

import { MarketIndexBar } from "@/components/dashboard/MarketIndexBar";
import { MacroBar } from "@/components/dashboard/MacroBar";
import { SectorTeaser } from "@/components/dashboard/SectorTeaser";
import { EarningsCalendarCard } from "@/components/dashboard/EarningsCalendarCard";
import { ScreenerTeaser } from "@/components/screener/ScreenerTeaser";
import Link from "next/link";

export function MarketView() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Markt</h2>

      {/* Indizes */}
      <MarketIndexBar />

      {/* Makro */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Makro-Indikatoren
          </p>
        </div>
        <MacroBar />
      </div>

      {/* Sektoren */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Sektoren
          </p>
          <Link href="/dashboard/sectors"
            className="text-xs font-medium" style={{ color: "var(--primary)" }}>
            Alle →
          </Link>
        </div>
        <SectorTeaser />
      </div>

      {/* Earnings */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Earnings-Kalender
          </p>
        </div>
        <EarningsCalendarCard />
      </div>

      {/* Screener */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Screener
          </p>
          <Link href="/dashboard/screener"
            className="text-xs font-medium" style={{ color: "var(--primary)" }}>
            Alle →
          </Link>
        </div>
        <ScreenerTeaser />
      </div>
    </div>
  );
}
