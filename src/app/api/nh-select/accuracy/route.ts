/*
 * NH Select Trefferquote
 *
 * Supabase migration (einmalig im SQL-Editor ausführen):
 *
 *   ALTER TABLE public.nh_select_daily
 *     ADD COLUMN IF NOT EXISTS price_at_pick FLOAT;
 *
 * Picks werden ab dem nächsten Synthesizer-Lauf mit Preis gespeichert.
 * Picks ohne price_at_pick (ältere Einträge) werden ignoriert.
 */

import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";
const EVAL_AFTER_DAYS = 7;

type Recommendation =
  | "Kaufen"
  | "Leicht kaufen"
  | "Halten"
  | "Leicht verkaufen"
  | "Verkaufen";

function evalOutcome(
  rec: Recommendation,
  returnPct: number,
): "correct" | "neutral" | "incorrect" {
  switch (rec) {
    case "Kaufen":
      return returnPct > 5 ? "correct" : returnPct < -5 ? "incorrect" : "neutral";
    case "Leicht kaufen":
      return returnPct > 3 ? "correct" : returnPct < -3 ? "incorrect" : "neutral";
    case "Halten":
      return Math.abs(returnPct) < 5 ? "correct" : Math.abs(returnPct) > 10 ? "incorrect" : "neutral";
    case "Leicht verkaufen":
      return returnPct < -3 ? "correct" : returnPct > 3 ? "incorrect" : "neutral";
    case "Verkaufen":
      return returnPct < -5 ? "correct" : returnPct > 5 ? "incorrect" : "neutral";
    default:
      return "neutral";
  }
}

export interface NHPickResult {
  symbol: string;
  name: string | null;
  recommendation: string;
  conviction: number;
  price_at_pick: number;
  price_current: number | null;
  return_pct: number | null;
  outcome: "correct" | "neutral" | "incorrect" | "pending";
  created_at: string;
  days_held: number;
}

export interface NHAccuracyStats {
  total_tracked: number;
  evaluated: number;
  pending: number;
  correct: number;
  neutral: number;
  incorrect: number;
  accuracy_rate: number | null;
  avg_return: number | null;
  picks: NHPickResult[];
}

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const supabase = await createClient();

  // Fetch all Synthesizer picks with a price (last 90 days)
  const since = new Date(Date.now() - 90 * 24 * 3_600_000).toISOString();
  const { data: picks } = await (supabase as any)
    .from("nh_select_daily")
    .select("symbol, name, recommendation, conviction, price_at_pick, created_at")
    .eq("agent", "Synthesizer")
    .not("price_at_pick", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(60) as {
      data: {
        symbol: string;
        name: string | null;
        recommendation: string;
        conviction: number;
        price_at_pick: number;
        created_at: string;
      }[] | null;
    };

  if (!picks || picks.length === 0) {
    return NextResponse.json({
      total_tracked: 0,
      evaluated: 0,
      pending: 0,
      correct: 0,
      neutral: 0,
      incorrect: 0,
      accuracy_rate: null,
      avg_return: null,
      picks: [],
    } satisfies NHAccuracyStats);
  }

  const now = Date.now();
  const evalCutoff = now - EVAL_AFTER_DAYS * 24 * 3_600_000;

  const toEvaluate = picks.filter(p => new Date(p.created_at).getTime() <= evalCutoff);
  const pending    = picks.filter(p => new Date(p.created_at).getTime() > evalCutoff);

  // Fetch current prices for picks to evaluate (deduplicated symbols)
  const symbols = [...new Set(toEvaluate.map(p => p.symbol))];
  const priceMap: Record<string, number | null> = {};

  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const res = await fetch(`${FINANCE_API_URL}/assets/${sym}`);
        if (res.ok) {
          const d = await res.json() as { price?: number };
          priceMap[sym] = d.price ?? null;
        } else {
          priceMap[sym] = null;
        }
      } catch {
        priceMap[sym] = null;
      }
    }),
  );

  // Build result array
  const evaluatedResults: NHPickResult[] = toEvaluate.map(p => {
    const currentPrice = priceMap[p.symbol] ?? null;
    const daysHeld = Math.floor((now - new Date(p.created_at).getTime()) / (24 * 3_600_000));
    if (currentPrice == null) {
      return {
        symbol: p.symbol, name: p.name, recommendation: p.recommendation,
        conviction: p.conviction, price_at_pick: p.price_at_pick,
        price_current: null, return_pct: null, outcome: "pending" as const,
        created_at: p.created_at, days_held: daysHeld,
      };
    }
    const returnPct = ((currentPrice - p.price_at_pick) / p.price_at_pick) * 100;
    const outcome = evalOutcome(p.recommendation as Recommendation, returnPct);
    return {
      symbol: p.symbol, name: p.name, recommendation: p.recommendation,
      conviction: p.conviction, price_at_pick: p.price_at_pick,
      price_current: currentPrice, return_pct: parseFloat(returnPct.toFixed(2)),
      outcome, created_at: p.created_at, days_held: daysHeld,
    };
  });

  const pendingResults: NHPickResult[] = pending.map(p => ({
    symbol: p.symbol, name: p.name, recommendation: p.recommendation,
    conviction: p.conviction, price_at_pick: p.price_at_pick,
    price_current: null, return_pct: null, outcome: "pending" as const,
    created_at: p.created_at,
    days_held: Math.floor((now - new Date(p.created_at).getTime()) / (24 * 3_600_000)),
  }));

  const allResults = [...evaluatedResults, ...pendingResults];
  const closed = evaluatedResults.filter(r => r.outcome !== "pending");
  const correct   = closed.filter(r => r.outcome === "correct").length;
  const neutral   = closed.filter(r => r.outcome === "neutral").length;
  const incorrect = closed.filter(r => r.outcome === "incorrect").length;
  const returns   = closed.filter(r => r.return_pct != null).map(r => r.return_pct!);
  const avg_return = returns.length > 0
    ? parseFloat((returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2))
    : null;
  const accuracy_rate = (correct + incorrect) > 0 ? correct / (correct + incorrect) : null;

  return NextResponse.json({
    total_tracked: picks.length,
    evaluated: closed.length,
    pending: allResults.filter(r => r.outcome === "pending").length,
    correct, neutral, incorrect,
    accuracy_rate,
    avg_return,
    picks: allResults,
  } satisfies NHAccuracyStats);
}
