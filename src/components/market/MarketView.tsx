"use client";

import { useState } from "react";
import { MarketIndexBar } from "@/components/dashboard/MarketIndexBar";
import { MacroBar } from "@/components/dashboard/MacroBar";
import { SectorTeaser } from "@/components/dashboard/SectorTeaser";
import { EarningsCalendarCard } from "@/components/dashboard/EarningsCalendarCard";
import { ScreenerTeaser } from "@/components/screener/ScreenerTeaser";
import { NHSelectView } from "@/components/dashboard/NHSelectView";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";

export function MarketView() {
  const [nhOpen, setNhOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("market_nh_open") === "1";
  });

  function toggleNH() {
    setNhOpen(v => {
      const next = !v;
      localStorage.setItem("market_nh_open", next ? "1" : "0");
      return next;
    });
  }

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

      {/* NH Select */}
      <div className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <button
          onClick={toggleNH}
          className="w-full px-4 py-3 flex items-center justify-between"
          style={{ background: "transparent" }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            NH Select
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: "var(--primary)" }}>
              {nhOpen ? "Einklappen" : "Ausklappen"}
            </span>
            {nhOpen
              ? <ChevronUp size={14} style={{ color: "var(--muted)" }} />
              : <ChevronDown size={14} style={{ color: "var(--muted)" }} />}
          </div>
        </button>
        {nhOpen && (
          <div className="border-t px-0 pb-0" style={{ borderColor: "var(--card-border)" }}>
            <NHSelectView />
          </div>
        )}
      </div>
    </div>
  );
}
