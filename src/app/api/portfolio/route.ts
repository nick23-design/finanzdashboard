/*
 * Supabase migrations (einmalig ausführen):
 *   ALTER TABLE public.portfolio_positions
 *     ADD COLUMN IF NOT EXISTS broker TEXT;
 *   ALTER TABLE public.portfolio_positions
 *     ADD COLUMN IF NOT EXISTS purchase_currency TEXT;
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

const addSchema = z.object({
  symbol: z.string().min(1).max(30).transform(s => s.toUpperCase().trim()),
  name: z.string().max(200).default(""),
  shares: z.number().positive(),
  purchase_price: z.number().positive(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  broker: z.string().max(50).optional(),
  purchase_currency: z.string().length(3).optional(),
});

export interface PortfolioLot {
  id: string;
  shares: number;
  purchase_price: number;
  purchase_currency: string | null;
  purchase_date: string;
  broker: string | null;
  purchase_value: number;
  current_value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
}

export interface PortfolioGroup {
  symbol: string;
  name: string;
  currency: string | null;
  lots: PortfolioLot[];
  total_shares: number;
  avg_purchase_price: number;
  purchase_value: number;
  current_price: number | null;
  current_value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  day_change_pct: number | null;
  day_pnl: number | null;
  weight_pct: number | null;
}

export interface PortfolioSummary {
  total_invested: number;
  total_current: number;
  total_pnl: number;
  total_pnl_pct: number;
  day_pnl: number | null;
  best: { symbol: string; pnl_pct: number } | null;
  worst: { symbol: string; pnl_pct: number } | null;
  groups: PortfolioGroup[];
}

// Keep for backward compat (used by PortfolioView currently)
export type PortfolioPositionEnriched = PortfolioLot & {
  symbol: string;
  name: string;
  created_at: string;
};

export async function GET(_request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const supabase = await createClient();
  const { data: positions, error } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!positions?.length) return NextResponse.json({ total_invested: 0, total_current: 0, total_pnl: 0, total_pnl_pct: 0, day_pnl: null, best: null, worst: null, groups: [] } satisfies PortfolioSummary);

  // Fetch current prices + daily change for each unique symbol
  const symbols = [...new Set(positions.map(p => p.symbol))];
  const priceMap: Record<string, { price: number | null; change_pct: number | null; currency: string | null }> = {};

  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const res = await fetch(`${FINANCE_API_URL}/assets/${sym}`, { next: { revalidate: 0 } });
        if (res.ok) {
          const d = await res.json();
          priceMap[sym] = { price: d.price ?? null, change_pct: d.price_change_pct ?? null, currency: d.currency ?? null };
        } else {
          priceMap[sym] = { price: null, change_pct: null, currency: null };
        }
      } catch {
        priceMap[sym] = { price: null, change_pct: null, currency: null };
      }
    })
  );

  // Fetch FX rates for cross-currency positions (e.g. USD asset bought in EUR)
  const fxRates: Record<string, number> = {}; // e.g. "EURUSD" -> 1.08 (1 EUR = 1.08 USD)
  const needsEurUsd = positions.some(p => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pc = (p as any).purchase_currency as string | null;
    const ac = priceMap[p.symbol]?.currency;
    return pc && ac && pc !== ac && ((pc === "EUR" && ac === "USD") || (pc === "USD" && ac === "EUR"));
  });
  if (needsEurUsd) {
    try {
      const res = await fetch(`${FINANCE_API_URL}/assets/EURUSD=X`, { next: { revalidate: 300 } });
      if (res.ok) {
        const d = await res.json();
        if (d.price) fxRates["EURUSD"] = d.price; // 1 EUR = X USD
      }
    } catch {}
  }

  function convertToTargetCurrency(price: number, from: string, to: string): number {
    if (from === to) return price;
    const eurUsd = fxRates["EURUSD"];
    if (!eurUsd) return price; // fallback: no conversion available
    if (from === "USD" && to === "EUR") return price / eurUsd;
    if (from === "EUR" && to === "USD") return price * eurUsd;
    return price; // other pairs: no conversion
  }

  // Group by symbol
  const groupMap: Record<string, { positions: typeof positions; name: string }> = {};
  for (const p of positions) {
    if (!groupMap[p.symbol]) groupMap[p.symbol] = { positions: [], name: p.name ?? p.symbol };
    groupMap[p.symbol].positions.push(p);
  }

  const totalCurrent = symbols.reduce((sum, sym) => {
    const { price } = priceMap[sym];
    if (price == null) return sum;
    const shares = groupMap[sym].positions.reduce((s, p) => s + Number(p.shares), 0);
    return sum + price * shares;
  }, 0);

  const groups: PortfolioGroup[] = Object.entries(groupMap).map(([symbol, { positions: lots, name }]) => {
    const { price: currentPrice, change_pct: dayChangePct, currency: assetCurrency } = priceMap[symbol];

    // Use the purchase_currency of the first lot (if set) as the group display currency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const purchaseCurrency = (lots[0] as any).purchase_currency as string | null | undefined;
    const displayCurrency = purchaseCurrency ?? assetCurrency;

    // Convert current price to display currency if they differ
    const currentPriceDisplay = currentPrice != null && assetCurrency && displayCurrency && assetCurrency !== displayCurrency
      ? convertToTargetCurrency(currentPrice, assetCurrency, displayCurrency)
      : currentPrice;

    const totalShares = lots.reduce((s, p) => s + Number(p.shares), 0);
    const purchaseValue = lots.reduce((s, p) => s + Number(p.purchase_price) * Number(p.shares), 0);
    const avgPurchasePrice = totalShares > 0 ? purchaseValue / totalShares : 0;
    const currentValue = currentPriceDisplay != null ? currentPriceDisplay * totalShares : null;
    const pnl = currentValue != null ? currentValue - purchaseValue : null;
    const pnlPct = currentValue != null && purchaseValue > 0 ? (pnl! / purchaseValue) * 100 : null;
    const dayPnl = currentValue != null && dayChangePct != null
      ? currentValue * (dayChangePct / 100) / (1 + dayChangePct / 100)
      : null;
    const weightPct = totalCurrent > 0 && currentValue != null ? (currentValue / totalCurrent) * 100 : null;

    const lotDetails: PortfolioLot[] = lots.map(p => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lotPurchaseCurrency = (p as any).purchase_currency as string | null | undefined;
      const lotDisplayCurrency = lotPurchaseCurrency ?? assetCurrency;
      const lotCurrentPrice = currentPrice != null && assetCurrency && lotDisplayCurrency && assetCurrency !== lotDisplayCurrency
        ? convertToTargetCurrency(currentPrice, assetCurrency, lotDisplayCurrency)
        : currentPrice;
      const pv = Number(p.purchase_price) * Number(p.shares);
      const cv = lotCurrentPrice != null ? lotCurrentPrice * Number(p.shares) : null;
      return {
        id: p.id,
        shares: Number(p.shares),
        purchase_price: Number(p.purchase_price),
        purchase_currency: lotPurchaseCurrency ?? null,
        purchase_date: p.purchase_date,
        broker: p.broker ?? null,
        purchase_value: pv,
        current_value: cv,
        pnl: cv != null ? cv - pv : null,
        pnl_pct: cv != null && pv > 0 ? ((cv - pv) / pv) * 100 : null,
      };
    });

    return {
      symbol, name, currency: displayCurrency ?? null, lots: lotDetails,
      total_shares: totalShares,
      avg_purchase_price: avgPurchasePrice,
      purchase_value: purchaseValue,
      current_price: currentPriceDisplay,
      current_value: currentValue,
      pnl, pnl_pct: pnlPct,
      day_change_pct: dayChangePct,
      day_pnl: dayPnl,
      weight_pct: weightPct,
    };
  });

  const totalInvested = groups.reduce((s, g) => s + g.purchase_value, 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const totalDayPnl = groups.reduce((s, g) => s + (g.day_pnl ?? 0), 0);

  const evaluated = groups.filter(g => g.pnl_pct != null);
  const best  = evaluated.length ? evaluated.reduce((a, b) => (b.pnl_pct! > a.pnl_pct! ? b : a)) : null;
  const worst = evaluated.length ? evaluated.reduce((a, b) => (b.pnl_pct! < a.pnl_pct! ? b : a)) : null;

  const result: PortfolioSummary = {
    total_invested: totalInvested,
    total_current: totalCurrent,
    total_pnl: totalPnl,
    total_pnl_pct: totalPnlPct,
    day_pnl: totalDayPnl,
    best:  best  ? { symbol: best.symbol,  pnl_pct: best.pnl_pct! }  : null,
    worst: worst ? { symbol: worst.symbol, pnl_pct: worst.pnl_pct! } : null,
    groups,
  };
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const body = await request.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_positions")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert({
      user_id: user.id,
      symbol: parsed.data.symbol,
      name: parsed.data.name,
      shares: parsed.data.shares,
      purchase_price: parsed.data.purchase_price,
      purchase_date: parsed.data.purchase_date,
      broker: parsed.data.broker ?? null,
      purchase_currency: parsed.data.purchase_currency ?? null,
    } as any)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
