/*
 * Hot Pick – tagesfrische Aktienempfehlung (24h gecacht pro User)
 *
 * Supabase SQL (einmalig ausführen):
 *   CREATE TABLE IF NOT EXISTS public.hot_picks (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id UUID REFERENCES auth.users NOT NULL,
 *     symbol TEXT NOT NULL,
 *     name TEXT NOT NULL,
 *     price NUMERIC,
 *     signal TEXT NOT NULL,
 *     score INTEGER NOT NULL,
 *     reason TEXT NOT NULL,
 *     created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
 *   );
 *   ALTER TABLE public.hot_picks ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Users read own" ON public.hot_picks FOR SELECT USING (auth.uid() = user_id);
 *   CREATE POLICY "Users insert own" ON public.hot_picks FOR INSERT WITH CHECK (auth.uid() = user_id);
 *   CREATE POLICY "Users delete own" ON public.hot_picks FOR DELETE USING (auth.uid() = user_id);
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";
const CACHE_TTL_HOURS = 24;

async function getTrendingSymbols(): Promise<string[]> {
  try {
    const res = await fetch(`${FINANCE_API_URL}/trending`, { next: { revalidate: 0 } });
    if (!res.ok) return [];
    const data: { symbol: string }[] = await res.json();
    return data.map(d => d.symbol).filter(Boolean).slice(0, 15);
  } catch {
    return [];
  }
}

async function generateHotPick(userId: string) {
  const supabase = await createClient();

  const { data: watchlist } = await supabase
    .from("watchlist_items")
    .select("symbol, name")
    .eq("user_id", userId);

  const trending = await getTrendingSymbols();
  const watchlistSet = new Set((watchlist ?? []).map(w => w.symbol));

  const candidates: { symbol: string; name: string }[] = [
    ...(watchlist ?? []),
    ...trending.filter(s => !watchlistSet.has(s)).map(s => ({ symbol: s, name: s })),
  ].slice(0, 25);

  if (candidates.length === 0) return null;

  const symbols = candidates.map(c => c.symbol);
  const { data: scores } = await supabase
    .from("analysis_scores")
    .select("symbol, total_score, signal")
    .in("symbol", symbols)
    .in("signal", ["Kaufen", "Leicht kaufen"])
    .order("total_score", { ascending: false })
    .limit(5);

  if (!scores || scores.length === 0) return null;

  const best = scores[0];
  const candidate = candidates.find(c => c.symbol === best.symbol) ?? { symbol: best.symbol, name: best.symbol };

  let price: number | null = null;
  try {
    const res = await fetch(`${FINANCE_API_URL}/assets/${best.symbol}`, { next: { revalidate: 0 } });
    if (res.ok) {
      const data = await res.json();
      price = data.price ?? null;
      if (candidate.name === best.symbol && data.name) candidate.name = data.name;
    }
  } catch { /* use null */ }

  let reason = "Starkes Kaufsignal basierend auf fundamentalen und technischen Indikatoren.";
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const priceStr = price != null ? `Kurs: $${price.toFixed(2)}. ` : "";
      const res = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        system: "Du bist ein präziser Finanzanalyst. Schreibe genau 1-2 Sätze auf Deutsch. Keine Haftungsausschlüsse, keine Einleitungen.",
        messages: [{
          role: "user",
          content: `Warum ist ${best.symbol} (${candidate.name}) heute ein Hot Pick? ${priceStr}Score: ${best.total_score}/100, Signal: ${best.signal}.`,
        }],
      });
      const text = res.content.find(b => b.type === "text")?.text ?? "";
      if (text.length > 10) reason = text.trim();
    } catch { /* use default */ }
  }

  const { data: saved, error } = await supabase
    .from("hot_picks")
    .insert({
      user_id: userId,
      symbol: best.symbol,
      name: candidate.name,
      price,
      signal: best.signal,
      score: best.total_score,
      reason,
    })
    .select()
    .single();

  if (error || !saved) return null;
  return saved;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const supabase = await createClient();

  if (!forceRefresh) {
    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();
    const { data: cached } = await supabase
      .from("hot_picks")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (cached) return NextResponse.json(cached);
  } else {
    // Delete stale picks before generating new one
    await supabase.from("hot_picks").delete().eq("user_id", user.id);
  }

  try {
    const pick = await generateHotPick(user.id);
    if (!pick) return NextResponse.json(null);
    return NextResponse.json(pick);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fehler";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
