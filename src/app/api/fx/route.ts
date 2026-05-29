import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { fetchAssetData } from "@/lib/finance-client";

// EUR/USD rate for client-side price display toggles. Mirrors the server-side
// FxContext used by the AI analysis (EURUSD=X via the finance API) with the
// same conservative fallback so the UI stays usable when FX data is missing.
const EUR_USD_FALLBACK = 1.08;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

type FxResult = { eurUsd: number; source: "finance_api" | "fallback"; asOf: string };

let cached: { value: FxResult; expiresAt: number } | null = null;

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.value);
  }

  let result: FxResult = {
    eurUsd: EUR_USD_FALLBACK,
    source: "fallback",
    asOf: new Date().toISOString(),
  };

  try {
    const fx = await fetchAssetData("EURUSD=X");
    const price = typeof fx.price === "number" && Number.isFinite(fx.price) ? fx.price : null;
    if (price && price > 0) {
      result = {
        eurUsd: price,
        source: "finance_api",
        asOf: fx.fetched_at ?? new Date().toISOString(),
      };
    }
  } catch {
    // Keep fallback rate.
  }

  cached = { value: result, expiresAt: Date.now() + CACHE_TTL_MS };
  return NextResponse.json(result);
}
