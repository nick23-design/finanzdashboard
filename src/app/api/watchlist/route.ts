import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { addWatchlistSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user, supabase } = auth;

  const { data, error } = await supabase
    .from("watchlist_items")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user, supabase } = auth;

  // 30 additions per hour — prevents watchlist spam
  const rl = rateLimit({ key: `watchlist:post:${user.id}`, limit: 30, windowSecs: 3600 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Zu viele Einträge. Bitte warte etwas." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = addWatchlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Eingabe", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { symbol, name } = parsed.data;

  const { data, error } = await supabase
    .from("watchlist_items")
    .insert({ user_id: user.id, symbol, name })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `${symbol} ist bereits in der Watchlist` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
