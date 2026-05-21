import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { fetchAssetData } from "@/lib/finance-client";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

const CACHE_TTL_HOURS = 6;

async function getCachedSnapshot(symbol: string) {
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

  return data ?? null;
}

async function saveSnapshot(raw: Awaited<ReturnType<typeof fetchAssetData>>) {
  const supabase = await createClient();
  await supabase.from("asset_snapshots").insert({
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
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  // 60 requests per 10 minutes per user — cache hits are cheap, live fetches are not
  const rl = rateLimit({ key: `assets:${user.id}`, limit: 60, windowSecs: 600 });
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

  const cached = await getCachedSnapshot(symbol);
  if (cached) {
    return NextResponse.json({ ...cached, fromCache: true });
  }

  try {
    const raw = await fetchAssetData(symbol);
    await saveSnapshot(raw);
    return NextResponse.json({ ...raw, fromCache: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json(
      { error: `Datenabruf fehlgeschlagen: ${message}` },
      { status: 503 }
    );
  }
}
