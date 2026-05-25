import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { fetchEarningsCalendar } from "@/lib/finance-client";

export interface EarningsEntry {
  symbol: string;
  name: string | null;
  next_earnings_date: string;
  eps_estimate: number | null;
  revenue_estimate: number | null;
  days_until: number;
}

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const supabase = await createClient();
  const { data: watchlist } = await supabase
    .from("watchlist_items")
    .select("symbol, name")
    .eq("user_id", user.id);

  if (!watchlist?.length) return NextResponse.json([]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results = await Promise.all(
    watchlist.map(async ({ symbol, name }) => {
      try {
        const cal = await fetchEarningsCalendar(symbol);
        if (!cal?.next_earnings_date) return null;
        const earningsDate = new Date(cal.next_earnings_date);
        earningsDate.setHours(0, 0, 0, 0);
        const daysUntil = Math.round((earningsDate.getTime() - today.getTime()) / 86_400_000);
        if (daysUntil < 0 || daysUntil > 60) return null;
        return {
          symbol,
          name: name || null,
          next_earnings_date: cal.next_earnings_date,
          eps_estimate: cal.eps_estimate ?? null,
          revenue_estimate: cal.revenue_estimate ?? null,
          days_until: daysUntil,
        } satisfies EarningsEntry;
      } catch {
        return null;
      }
    })
  );

  const entries = results
    .filter((e): e is EarningsEntry => e !== null)
    .sort((a, b) => a.days_until - b.days_until);

  return NextResponse.json(entries);
}
