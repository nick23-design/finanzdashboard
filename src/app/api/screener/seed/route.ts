import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAssetData } from "@/lib/finance-client";
import { calculateScore } from "@/lib/scoring/engine";
import { STOCKS } from "@/lib/stocks-list";

// Curated universe: top US + DE + ETF picks (avoid very exotic symbols that yfinance fails on)
const UNIVERSE = STOCKS.filter(s =>
  s.region === "US" || s.region === "ETF" ||
  ["SAP.DE","SIE.DE","ALV.DE","MBG.DE","BMW.DE","DTE.DE","BAS.DE","IFX.DE","ADS.DE","ENR.DE","AIR.DE"].includes(s.symbol)
).map(s => s.symbol);

const CACHE_TTL_HOURS = 6;
const BATCH_SIZE = 5;

export async function POST() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const supabase = await createClient();
  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();

  // Find which symbols already have a fresh score
  const { data: fresh } = await supabase
    .from("analysis_scores")
    .select("symbol")
    .gte("created_at", cutoff);

  const freshSet = new Set((fresh ?? []).map(r => r.symbol));
  const toAnalyze = UNIVERSE.filter(sym => !freshSet.has(sym));

  if (toAnalyze.length === 0) {
    return NextResponse.json({ seeded: 0, skipped: UNIVERSE.length, message: "Alle Scores aktuell" });
  }

  let seeded = 0;
  let failed = 0;

  // Process in batches to avoid overloading the backend
  for (let i = 0; i < toAnalyze.length; i += BATCH_SIZE) {
    const batch = toAnalyze.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async symbol => {
      try {
        // Check for a fresh snapshot first
        const { data: snapRow } = await supabase
          .from("asset_snapshots")
          .select("*")
          .eq("symbol", symbol)
          .gte("fetched_at", cutoff)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .single();

        let snapshot = snapRow;

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

          // Save snapshot
          await supabase.from("asset_snapshots").insert({
            symbol: snapshot.symbol,
            price: snapshot.price,
            currency: snapshot.currency,
            isin: snapshot.isin,
            description: snapshot.description,
            pe_ratio: snapshot.pe_ratio,
            market_cap: snapshot.market_cap,
            debt_to_equity: snapshot.debt_to_equity,
            revenue_growth: snapshot.revenue_growth,
            free_cashflow: snapshot.free_cashflow,
            rsi: snapshot.rsi,
            moving_average_50: snapshot.moving_average_50,
            moving_average_200: snapshot.moving_average_200,
          });
        }

        const score = calculateScore(snapshot);
        await supabase.from("analysis_scores").insert({
          symbol: score.symbol,
          total_score: score.totalScore,
          fundamental_score: score.fundamentalScore,
          technical_score: score.technicalScore,
          risk_score: score.riskScore,
          signal: score.signal,
          explanation: score.explanation,
        });

        seeded++;
      } catch {
        failed++;
      }
    }));
  }

  return NextResponse.json({
    seeded,
    failed,
    skipped: freshSet.size,
    total: UNIVERSE.length,
  });
}
