import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { getEurUsd } from "@/lib/fx";

// EUR/USD-Kurs für die Preis-Umschaltung im Client. Die Quellen-Kaskade
// (yfinance → EZB → Cache → Fallback) liegt zentral in @/lib/fx.
export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const result = await getEurUsd();
  return NextResponse.json(result);
}
