/*
 * Morgen-Briefing — persönliches Markt-Briefing mit Watchlist-Relevanz.
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
import {
  fetchAssetData,
  fetchGoogleNews,
  fetchMarketIndices,
  fetchEarningsCalendar,
} from "@/lib/finance-client";
import type { MarketIndex } from "@/lib/finance-client";

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

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
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

  // Fetch all data in parallel: assets, news (top 5), earnings (top 5), scores
  const top5 = watchlist.slice(0, 5);
  const [assetSettled, newsSettled, earningsSettled, scoresResult] = await Promise.all([
    Promise.allSettled(watchlist.map(item => fetchAssetData(item.symbol))),
    Promise.allSettled(top5.map(item => fetchGoogleNews(item.symbol))),
    Promise.allSettled(top5.map(item => fetchEarningsCalendar(item.symbol))),
    supabase
      .from("analysis_scores")
      .select("symbol, signal, total_score")
      .in("symbol", watchlist.map(i => i.symbol))
      .order("total_score", { ascending: false }),
  ]);

  // Build asset data map
  interface AssetData {
    price?: number | null;
    currency?: string | null;
    price_change_pct?: number | null;
    rsi?: number | null;
    moving_average_50?: number | null;
  }
  const assetMap = new Map<string, AssetData>();
  watchlist.forEach((item, i) => {
    const r = assetSettled[i];
    if (r.status === "fulfilled") assetMap.set(item.symbol, r.value as AssetData);
  });

  // Sort watchlist items by absolute day change (notable movers first)
  const ranked = watchlist.map(item => {
    const d = assetMap.get(item.symbol);
    return { item, data: d ?? null, absPct: Math.abs(d?.price_change_pct ?? 0) };
  }).sort((a, b) => b.absPct - a.absPct);

  // Split into notable (>= 1.5 % move) and rest
  const notable = ranked.filter(r => r.absPct >= 1.5);
  const rest    = ranked.filter(r => r.absPct < 1.5);

  function formatAssetLine(symbol: string, name: string, d: AssetData | null): string {
    if (!d) return `${symbol} (${name}): Daten nicht verfügbar`;
    const pct = d.price_change_pct != null
      ? ` (${d.price_change_pct > 0 ? "+" : ""}${d.price_change_pct.toFixed(1)}%)`
      : "";
    const rsi = d.rsi != null ? ` | RSI ${d.rsi.toFixed(0)}` : "";
    const ma50 = d.moving_average_50 != null ? ` | MA50 ${d.moving_average_50.toFixed(2)}` : "";
    return `${symbol} (${name}): ${d.price?.toFixed(2) ?? "—"} ${d.currency ?? ""}${pct}${rsi}${ma50}`;
  }

  const notableLines = notable.length > 0
    ? notable.map(r => formatAssetLine(r.item.symbol, r.item.name, r.data))
    : ["Keine außergewöhnlichen Bewegungen heute"];

  const restLines = rest.length > 0
    ? rest.map(r => formatAssetLine(r.item.symbol, r.item.name, r.data))
    : [];

  // News for top5 items (map by index in top5 order)
  const newsLines = top5.map((item, i) => {
    const r = newsSettled[i];
    if (r.status === "rejected" || !r.value.length) return "";
    const articles = r.value.slice(0, 2).map(n => `  · ${n.title}`).join("\n");
    return articles ? `${item.symbol}:\n${articles}` : "";
  }).filter(Boolean);

  // Upcoming earnings in next 14 days
  const earningsLines = top5.map((item, i) => {
    const r = earningsSettled[i];
    if (r.status === "rejected" || !r.value?.next_earnings_date) return null;
    const days = daysUntil(r.value.next_earnings_date);
    if (days == null || days < 0 || days > 14) return null;
    const label = days === 0 ? "heute" : days === 1 ? "morgen" : `in ${days} Tagen`;
    return `${item.symbol}: Earnings ${label} (${r.value.next_earnings_date})`;
  }).filter((x): x is string => x !== null);

  // Scores context
  const scores = scoresResult.data;
  const scoresLine = scores && scores.length > 0
    ? scores.map(s => `${s.symbol}: ${s.signal} (${s.total_score}/100)`).join(", ")
    : "Keine Scores verfügbar";

  // Market indices context
  const indicesLine = (liveIndices as MarketIndex[]).length > 0
    ? (liveIndices as MarketIndex[]).map(idx => {
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

  const prompt = `Morgen-Briefing für ${today}${isWeekend ? " (Wochenende — Märkte geschlossen, Wochenrückblick)" : ""}.

MARKTINDIZES:
${indicesLine}

WATCHLIST — HEUTE AUFFÄLLIG (≥ 1,5 % Bewegung):
${notableLines.join("\n")}

WATCHLIST — WEITERE POSITIONEN:
${restLines.length > 0 ? restLines.join("\n") : "—"}

ANALYSE-SCORES (gespeichert):
${scoresLine}

NEWS-SCHLAGZEILEN (auffälligste Positionen):
${newsLines.join("\n") || "Keine Schlagzeilen verfügbar"}

EARNINGS-TERMINE (nächste 14 Tage in Watchlist):
${earningsLines.length > 0 ? earningsLines.join("\n") : "Keine bevorstehenden Earnings"}

AUFGABE:
Erstelle ein Morgen-Briefing auf Deutsch. Fokus:
- 60 % Marktbild: Was bewegt die Märkte heute? Übergeordnetes Thema, Sektor-Kontext.
- 25 % Watchlist-Relevanz: Nur Positionen erwähnen, die heute wirklich auffällig sind (Bewegung, Earnings, News). Stille Positionen nicht erwähnen.
- 15 % Idee des Tages: Eine Aktie oder ein Thema, das heute research-würdig ist.

REGELN:
- Keine Kauf- oder Verkaufsempfehlungen
- Keine Kursversprechen, Kursziele oder Renditeerwartungen
- Nur Aussagen, die aus den bereitgestellten Daten ableitbar sind
- watchlist_highlights: maximal 3 Einträge, nur bei echten Signalen, sonst leeres Array
- daily_opportunity ist eine Research-Idee/Hinweis, keine Empfehlung

JSON (exakt dieses Format):
{"headline":"Eine prägnante Zeile was heute wichtig ist","market_overview":"2-3 Sätze zur Marktlage — marktgetrieben, nicht watchlist-getrieben","watchlist_highlights":["SYMBOL: kurze Beobachtung, nur wenn auffällig"],"daily_opportunity":{"symbol":"TICKER","name":"Unternehmensname","reason":"1-2 Sätze warum heute research-würdig"}}`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: "Du bist ein nüchterner Finanz-Assistent für ein privates Research-Dashboard. Erstelle faktenbasierte Morgen-Briefings auf Deutsch. Keine Kauf-/Verkaufsempfehlungen, keine Kursversprechen. Beziehe dich ausschließlich auf bereitgestellte Daten. Antworte ausschließlich mit validem JSON.",
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
