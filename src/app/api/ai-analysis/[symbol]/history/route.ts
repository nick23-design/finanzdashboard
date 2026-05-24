import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const { symbol: rawSymbol } = await params;
  const parsed = tickerSchema.safeParse(rawSymbol);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Symbol" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_analyses")
    .select("id, recommendation, conviction, fundamental_rating, news_sentiment, summary, analyzed_at")
    .eq("symbol", parsed.data)
    .order("analyzed_at", { ascending: false })
    .limit(10);

  return NextResponse.json(data ?? []);
}
