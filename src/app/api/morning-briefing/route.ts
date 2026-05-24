/*
 * Morgen-Briefing — personalisiertes KI-Briefing, täglich neu generiert.
 *
 * Supabase migration (einmalig im SQL-Editor ausführen):
 *
 *   CREATE TABLE IF NOT EXISTS public.morning_briefings (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *     headline TEXT NOT NULL DEFAULT '',
 *     market_overview TEXT NOT NULL DEFAULT '',
 *     watchlist_highlights JSONB NOT NULL DEFAULT '[]',
 *     daily_opportunity JSONB,
 *     generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *   CREATE INDEX IF NOT EXISTS morning_briefings_user_generated
 *     ON public.morning_briefings(user_id, generated_at DESC);
 *   ALTER TABLE public.morning_briefings ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Own briefings" ON public.morning_briefings
 *     FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAssetData, fetchGoogleNews, fetchMarketIndices } from "@/lib/finance-client";
import type { GoogleNewsItem, MarketIndex } from "@/lib/finance-client";

export interface MorningBriefing {
  id: string;
  user_id: string;
  headline: string;
  market_overview: string;
  watchlist_highlights: string[];
  daily_opportunity: { symbol: string; name: string; reason: string } | null;
  indices: { symbol: string; name: string; price: number | null; change_pct: number | null }[];
  generated_at: string;
  from_cache: boolean;
}

function isSameDay(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("");
}

function parseJSON<T>(raw: string): T {
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON");
  return JSON.parse(stripped.slice(start, end + 1)) as T;
}

export async function GET(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "KI nicht konfiguriert" }, { status: 503 });
  }

  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const supabase = await createClient();

  // Always fetch indices live (they change throughout the day)
  const liveIndices = await fetchMarketIndices();

  // Return cached briefing text if available and not forced refresh
  if (!refresh) {
    const { data: cached } = await supabase
      .from("morning_briefings")
      .select("*")
      .eq("user_id", user.id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();

    if (cached && isSameDay(cached.generated_at)) {
      return NextResponse.json({
        ...cached,
        watchlist_highlights: cached.watchlist_highlights as string[],
        daily_opportunity: cached.daily_opportunity as MorningBriefing["daily_opportunity"],
        indices: liveIndices,
        from_cache: true,
      });
    }
  }

  // Fetch watchlist
  const { data: watchlist } = await supabase
    .from("watchlist_items")
    .select("symbol, name")
    .eq("user_id", user.id)
    .limit(10);

  if (!watchlist || watchlist.length === 0) {
    return NextResponse.json(
      { error: "Füge zuerst Aktien zur Watchlist hinzu." },
      { status: 404 },
    );
  }

  const top5 = watchlist.slice(0, 5);

  // Fetch asset data and news in parallel (indices already fetched above)
  const [assetSettled, newsSettled] = await Promise.all([
    Promise.allSettled(top5.map(item => fetchAssetData(item.symbol))),
    Promise.allSettled(top5.slice(0, 3).map(item => fetchGoogleNews(item.symbol))),
  ]);
  const indices = liveIndices;

  // Build asset context string
  const assetLines = top5.map((item, i) => {
    const r = assetSettled[i];
    if (r.status === "rejected") return `${item.symbol} (${item.name}): Daten nicht verfügbar`;
    const d = r.value as {
      price?: number | null;
      currency?: string | null;
      price_change_pct?: number | null;
      rsi?: number | null;
      moving_average_50?: number | null;
    };
    const pct = d.price_change_pct != null
      ? ` (${d.price_change_pct > 0 ? "+" : ""}${d.price_change_pct.toFixed(1)}%)`
      : "";
    const rsi = d.rsi != null ? ` | RSI ${d.rsi.toFixed(0)}` : "";
    const ma50 = d.moving_average_50 != null ? ` | MA50 ${d.moving_average_50.toFixed(2)}` : "";
    return `${item.symbol} (${item.name}): ${d.price?.toFixed(2) ?? "—"} ${d.currency ?? ""}${pct}${rsi}${ma50}`;
  });

  // Build news context string
  const newsLines = top5.slice(0, 3).map((item, i) => {
    const r = newsSettled[i];
    if (r.status === "rejected") return "";
    const articles = (r.value as GoogleNewsItem[]).slice(0, 2).map(n => `  · ${n.title}`).join("\n");
    return articles ? `${item.symbol}:\n${articles}` : "";
  }).filter(Boolean);

  // Fetch existing scores for opportunity selection
  const { data: scores } = await supabase
    .from("analysis_scores")
    .select("symbol, signal, total_score")
    .in("symbol", top5.map(i => i.symbol))
    .order("total_score", { ascending: false });

  const scoresLine = scores && scores.length > 0
    ? scores.map(s => `${s.symbol}: ${s.signal} (${s.total_score}/100)`).join(", ")
    : "Keine Scores verfügbar";

  // Build market indices context
  const indicesLine = (indices as MarketIndex[]).length > 0
    ? (indices as MarketIndex[]).map(idx => {
        if (idx.price == null) return `${idx.name}: keine Daten`;
        const pct = idx.change_pct != null
          ? ` (${idx.change_pct >= 0 ? "+" : ""}${idx.change_pct.toFixed(2)}%)`
          : "";
        return `${idx.name}: ${idx.price.toLocaleString("de-DE")}${pct}`;
      }).join(" | ")
    : "Marktdaten nicht verfügbar";

  const today = new Date().toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
  const isWeekend = [0, 6].includes(new Date().getDay());

  const prompt = `Morgen-Briefing für ${today}${isWeekend ? " (Wochenende – Märkte geschlossen)" : ""}.

MARKTINDIZES:
${indicesLine}

WATCHLIST-POSITIONEN:
${assetLines.join("\n")}

ANALYSE-SCORES:
${scoresLine}

AKTUELLE SCHLAGZEILEN:
${newsLines.join("\n") || "Keine Schlagzeilen verfügbar"}

Erstelle ein prägnantes Morgen-Briefing auf Deutsch. Wähle als Tages-Chance die Aktie mit dem besten Chance/Risiko-Verhältnis (hoher Score + positive Signale).

JSON-Format:
{"headline":"Eine prägnante Zeile was heute wichtig ist","market_overview":"2-3 Sätze zur Marktlage","watchlist_highlights":["SYMBOL: kurze Beobachtung","..."],"daily_opportunity":{"symbol":"TICKER","name":"Unternehmensname","reason":"1-2 Sätze warum heute interessant"}}`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: "Du bist ein prägnanter Finanz-Assistent. Erstelle faktenbasierte Morgen-Briefings auf Deutsch. Beziehe dich ausschließlich auf bereitgestellte Daten. Antworte ausschließlich mit validem JSON.",
      messages: [{ role: "user", content: prompt }],
    });

    const parsed = parseJSON<{
      headline: string;
      market_overview: string;
      watchlist_highlights: string[];
      daily_opportunity: { symbol: string; name: string; reason: string } | null;
    }>(extractText(response.content));

    const { data: saved } = await supabase
      .from("morning_briefings")
      .insert({
        user_id: user.id,
        headline: parsed.headline ?? "",
        market_overview: parsed.market_overview ?? "",
        watchlist_highlights: parsed.watchlist_highlights ?? [],
        daily_opportunity: parsed.daily_opportunity ?? null,
      })
      .select()
      .single();

    return NextResponse.json({
      ...(saved ?? {
        id: crypto.randomUUID(),
        user_id: user.id,
        generated_at: new Date().toISOString(),
      }),
      headline: parsed.headline,
      market_overview: parsed.market_overview,
      watchlist_highlights: parsed.watchlist_highlights,
      daily_opportunity: parsed.daily_opportunity,
      indices: liveIndices,
      from_cache: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Briefing fehlgeschlagen: ${err instanceof Error ? err.message : "Unbekannter Fehler"}` },
      { status: 503 },
    );
  }
}
