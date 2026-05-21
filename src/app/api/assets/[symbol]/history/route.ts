import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { fetchPriceHistory } from "@/lib/finance-client";
import { z } from "zod";

const periodSchema = z.enum(["1mo", "3mo", "6mo", "1y", "2y", "5y"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const { symbol: rawSymbol } = await params;
  const parsed = tickerSchema.safeParse(rawSymbol);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Ticker-Symbol" }, { status: 400 });
  }
  const symbol = parsed.data;

  const period = periodSchema.safeParse(
    request.nextUrl.searchParams.get("period") ?? "6mo"
  );

  try {
    const data = await fetchPriceHistory(symbol, period.success ? period.data : "6mo");
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
