import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

export interface ScreenerEntry {
  symbol: string;
  total_score: number;
  fundamental_score: number;
  technical_score: number;
  risk_score: number;
  signal: string;
  explanation: string;
  scored_at: string;
  price: number | null;
  pe_ratio: number | null;
  market_cap: number | null;
  rsi: number | null;
  revenue_growth: number | null;
  debt_to_equity: number | null;
}

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const supabase = await createClient();

  // Latest score per symbol (Supabase doesn't have DISTINCT ON, so fetch all and filter in JS)
  const { data: scores, error } = await supabase
    .from("analysis_scores")
    .select("symbol, total_score, fundamental_score, technical_score, risk_score, signal, explanation, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error || !scores?.length) return NextResponse.json([]);

  // Keep only the latest entry per symbol
  const seen = new Set<string>();
  const latest = scores.filter(s => {
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });

  // Fetch latest snapshots for these symbols
  const symbols = latest.map(s => s.symbol);
  const { data: snapshots } = await supabase
    .from("asset_snapshots")
    .select("symbol, price, pe_ratio, market_cap, rsi, revenue_growth, debt_to_equity, fetched_at")
    .in("symbol", symbols)
    .order("fetched_at", { ascending: false });

  interface SnapRow {
    symbol: string;
    price: number | null;
    pe_ratio: number | null;
    market_cap: number | null;
    rsi: number | null;
    revenue_growth: number | null;
    debt_to_equity: number | null;
    fetched_at: string;
  }

  // Latest snapshot per symbol
  const snapMap = new Map<string, SnapRow>();
  if (snapshots) {
    for (const s of snapshots) {
      if (!snapMap.has(s.symbol)) snapMap.set(s.symbol, s as SnapRow);
    }
  }

  const entries: ScreenerEntry[] = latest.map(score => {
    const snap = snapMap.get(score.symbol);
    return {
      symbol: score.symbol,
      total_score: score.total_score,
      fundamental_score: score.fundamental_score,
      technical_score: score.technical_score,
      risk_score: score.risk_score,
      signal: score.signal,
      explanation: score.explanation,
      scored_at: score.created_at,
      price: snap?.price ?? null,
      pe_ratio: snap?.pe_ratio ?? null,
      market_cap: snap?.market_cap ?? null,
      rsi: snap?.rsi ?? null,
      revenue_growth: snap?.revenue_growth ?? null,
      debt_to_equity: snap?.debt_to_equity ?? null,
    };
  });

  return NextResponse.json(entries);
}
