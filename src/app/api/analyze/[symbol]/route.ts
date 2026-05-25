import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { fetchAssetData } from "@/lib/finance-client";
import { calculateScore } from "@/lib/scoring/engine";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import type { Database, AnalysisScore, AssetSnapshot } from "@/types/database";

type AnalysisScoreInsert = Database["public"]["Tables"]["analysis_scores"]["Insert"];

const CACHE_TTL_HOURS = 6;

async function getCachedScore(symbol: string): Promise<AnalysisScore | null> {
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

  return (data as AnalysisScore | null) ?? null;
}

async function getCachedSnapshot(symbol: string): Promise<AssetSnapshot | null> {
  const supabase = await createClient();
  const cutoff = new Date(
    Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data } = await supabase
    .from("asset_snapshots")
    .select("*")
    .eq("symbol", symbol)
    .gte("fetched_at", cutoff)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .single();

  return (data as AssetSnapshot | null) ?? null;
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
    // Prefer cached asset snapshot to avoid waking Render backend
    let snapshot: AssetSnapshot | null = await getCachedSnapshot(symbol);

    if (!snapshot) {
      const raw = await fetchAssetData(symbol);
      snapshot = {
        id: "",
        symbol: raw.symbol,
        price: raw.price,
        currency: raw.currency,
        isin: raw.isin ?? null,
        description: raw.description ?? null,
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
    }

    const score = calculateScore(snapshot);

    const supabase = await createClient();
    const { error: insertError } = await supabase
      .from("analysis_scores")
      .insert({
        symbol: score.symbol,
        total_score: score.totalScore,
        fundamental_score: score.fundamentalScore,
        technical_score: score.technicalScore,
        risk_score: score.riskScore,
        signal: score.signal,
        explanation: score.explanation,
      });

    // Insert failure (e.g. RLS) should not block returning the score
    if (insertError) console.error("Score insert failed:", insertError.message);

    return NextResponse.json({
      symbol: score.symbol,
      total_score: score.totalScore,
      fundamental_score: score.fundamentalScore,
      technical_score: score.technicalScore,
      risk_score: score.riskScore,
      signal: score.signal,
      explanation: score.explanation,
      created_at: new Date().toISOString(),
      fromCache: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
