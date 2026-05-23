import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export interface OutcomeStats {
  total: number;
  pending: number;
  closed: number;
  correct: number;
  neutral: number;
  incorrect: number;
  accuracy_rate: number | null;
  recent: {
    symbol: string;
    recommendation: string;
    return_pct: number;
    outcome: string;
    checked_at: string;
  }[];
}

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const supabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from("analysis_outcomes")
    .select("symbol, recommendation, return_pct, outcome, checked_at")
    .order("checked_at", { ascending: false })
    .limit(200) as {
      data: {
        symbol: string;
        recommendation: string;
        return_pct: number | null;
        outcome: string;
        checked_at: string | null;
      }[] | null;
    };

  if (!rows) return NextResponse.json({ total: 0, pending: 0, closed: 0, correct: 0, neutral: 0, incorrect: 0, accuracy_rate: null, recent: [] });

  const total = rows.length;
  const pending = rows.filter(r => r.outcome === "pending").length;
  const correct = rows.filter(r => r.outcome === "correct").length;
  const neutral = rows.filter(r => r.outcome === "neutral").length;
  const incorrect = rows.filter(r => r.outcome === "incorrect").length;
  const closed = correct + neutral + incorrect;
  const accuracy_rate = (correct + incorrect) > 0
    ? correct / (correct + incorrect)
    : null;

  const recent = rows
    .filter(r => r.outcome !== "pending" && r.checked_at)
    .slice(0, 10)
    .map(r => ({
      symbol: r.symbol,
      recommendation: r.recommendation,
      return_pct: r.return_pct ?? 0,
      outcome: r.outcome,
      checked_at: r.checked_at!,
    }));

  const stats: OutcomeStats = { total, pending, closed, correct, neutral, incorrect, accuracy_rate, recent };
  return NextResponse.json(stats);
}
