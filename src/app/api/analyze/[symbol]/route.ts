import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { fetchAssetData } from "@/lib/finance-client";
import { calculateScore } from "@/lib/scoring/engine";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import type { AssetSnapshot } from "@/types/database";

const CACHE_TTL_HOURS = 6;

async function getCachedScore(symbol: string) {
  const supabase = await createClient();
  const cutoff = new Date(
    Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data } = await supabase
    .from("analysis_scores")
    .select("*")
    .eq("symbol", symbol)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return data ?? null;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  // 20 live analyses per 10 minutes per user (cache hits bypass this)
  const rl = rateLimit({ key: `analyze:${user.id}`, limit: 20, windowSecs: 600 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte warte kurz." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const { symbol: rawSymbol } = await params;
  const parsed = tickerSchema.safeParse(rawSymbol);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Ticker-Symbol" }, { status: 400 });
  }
  const symbol = parsed.data;

  const cached = await getCachedScore(symbol);
  if (cached) {
    return NextResponse.json({ ...cached, fromCache: true });
  }

  try {
    const raw = await fetchAssetData(symbol);
    const snapshot: AssetSnapshot = {
      id: "",
      symbol: raw.symbol,
      price: raw.price,
      currency: raw.currency,
      pe_ratio: raw.pe_ratio,
      market_cap: raw.market_cap,
      debt_to_equity: raw.debt_to_equity,
      revenue_growth: raw.revenue_growth,
      free_cashflow: raw.free_cashflow,
      rsi: raw.rsi,
      moving_average_50: raw.moving_average_50,
      moving_average_200: raw.moving_average_200,
      fetched_at: raw.fetched_at,
    };

    const score = calculateScore(snapshot);

    const supabase = await createClient();
    const { data: saved, error } = await supabase
      .from("analysis_scores")
      .insert({
        symbol: score.symbol,
        total_score: score.totalScore,
        fundamental_score: score.fundamentalScore,
        technical_score: score.technicalScore,
        risk_score: score.riskScore,
        signal: score.signal,
        explanation: score.explanation,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ...saved, fromCache: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
