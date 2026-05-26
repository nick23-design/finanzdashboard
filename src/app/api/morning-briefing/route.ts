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
 *     protocol JSONB,
 *     generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *   -- Falls Tabelle bereits existiert:
 *   ALTER TABLE public.morning_briefings ADD COLUMN IF NOT EXISTS protocol JSONB;
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
import type { Json } from "@/types/database";
import {
  fetchAssetData,
  fetchGoogleNews,
  fetchMarketIndices,
  fetchEarningsCalendar,
} from "@/lib/finance-client";
import type { MarketIndex } from "@/lib/finance-client";
import {
  sanitizeText,
  validateIndexClaims,
  patchIndexDirections,
  assessDataQuality,
  scoreIdeaCandidates,
  type DataQuality,
  type IndexWarning,
} from "@/lib/briefing-validator";

export interface BriefingProtocol {
  agent: string;
  model: string;
  watchlist_total: number;
  notable_symbols: string[];
  news_fetched_for: string[];
  news_headlines: string[];
  upcoming_earnings: string[];
  scores_used: string[];
  indices_count: number;
  // Transparency / quality fields
  data_quality: DataQuality;
  validation_warnings: string[];
  was_sanitized: boolean;
  sanitization_changes: string[];
  idea_selection_reasons: string[];
}

export interface MorningBriefing {
  id: string;
  user_id: string;
  headline: string;
  market_overview: string;
  watchlist_highlights: string[];
  daily_opportunity: { symbol: string; name: string; reason: string; these?: string } | null;
  protocol: BriefingProtocol | null;
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

  // Always fetch indices live
  const liveIndices = await fetchMarketIndices();

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
        protocol: cached.protocol as BriefingProtocol | null,
        indices: liveIndices,
        from_cache: true,
      });
    }
  }

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

  // Sort watchlist by absolute day change
  const ranked = watchlist.map(item => {
    const d = assetMap.get(item.symbol);
    return { item, data: d ?? null, absPct: Math.abs(d?.price_change_pct ?? 0) };
  }).sort((a, b) => b.absPct - a.absPct);

  const notable = ranked.filter(r => r.absPct >= 1.5);
  const rest    = ranked.filter(r => r.absPct < 1.5);

  // News metadata
  const newsFetchedFor = top5.map((item, i) => {
    const r = newsSettled[i];
    return (r.status === "fulfilled" && r.value.length > 0) ? item.symbol : null;
  }).filter((x): x is string => x !== null);

  const allNewsHeadlines = top5.flatMap((item, i) => {
    const r = newsSettled[i];
    if (r.status !== "fulfilled") return [];
    return r.value.slice(0, 2).map(n => `${item.symbol}: ${n.title}`);
  });

  // Earnings in next 14 days
  const earningsLines = top5.map((item, i) => {
    const r = earningsSettled[i];
    if (r.status === "rejected" || !r.value?.next_earnings_date) return null;
    const days = daysUntil(r.value.next_earnings_date);
    if (days == null || days < 0 || days > 14) return null;
    const label = days === 0 ? "heute" : days === 1 ? "morgen" : `in ${days} Tagen`;
    return `${item.symbol}: Earnings ${label} (${r.value.next_earnings_date})`;
  }).filter((x): x is string => x !== null);

  // Scores — deduplicate by symbol
  const scoresRaw = scoresResult.data ?? [];
  const scoresBySymbol = new Map<string, typeof scoresRaw[0]>();
  for (const s of scoresRaw) {
    if (!scoresBySymbol.has(s.symbol)) scoresBySymbol.set(s.symbol, s);
  }
  const scores = [...scoresBySymbol.values()];
  const scoresLine = scores.length > 0
    ? scores.map(s => `${s.symbol}: ${s.signal} (${s.total_score}/100)`).join(", ")
    : "Keine Scores verfügbar";

  // ── Data quality assessment ────────────────────────────────────────────────
  const assetsWithPrice = [...assetMap.values()].filter(d => d.price != null).length;
  const dataQuality = assessDataQuality({
    assetsWithPrice,
    watchlistTotal: watchlist.length,
    newsCount: newsFetchedFor.length,
    indicesCount: (liveIndices as MarketIndex[]).length,
    scoresCount: scores.length,
  });

  // ── Idee des Tages — pre-score candidates ────────────────────────────────
  const ideaCandidates = scoreIdeaCandidates(
    top5.map((item, i) => ({
      symbol: item.symbol,
      name: item.name,
      data: assetMap.get(item.symbol) ?? null,
      hasScore: scoresBySymbol.has(item.symbol),
      hasNews: newsSettled[i].status === "fulfilled" && (newsSettled[i] as PromiseFulfilledResult<{ title: string }[]>).value.length > 0,
      hasEarnings: earningsLines.some(e => e.startsWith(item.symbol)),
      newsCount: newsSettled[i].status === "fulfilled"
        ? (newsSettled[i] as PromiseFulfilledResult<{ title: string }[]>).value.length
        : 0,
    }))
  );

  const topCandidate = ideaCandidates[0];
  const ideaCandidatesBlock = ideaCandidates.slice(0, 3)
    .map(c => `  ${c.symbol} (${c.name}): Score ${c.score} — ${c.reasons.join(", ")}`)
    .join("\n");

  // ── Market indices with pre-computed direction labels ─────────────────────
  const indicesLine = (liveIndices as MarketIndex[]).length > 0
    ? (liveIndices as MarketIndex[]).map(idx => {
        if (idx.price == null) return `${idx.name}: keine Daten`;
        const pct = idx.change_pct != null
          ? ` (${idx.change_pct >= 0 ? "+" : ""}${idx.change_pct.toFixed(2)}%)`
          : "";
        const dir = idx.change_pct == null ? "unverändert"
          : idx.change_pct > 0.1 ? "steigt"
          : idx.change_pct < -0.1 ? "fällt"
          : "nahezu unverändert";
        return `${idx.name}: ${idx.price.toLocaleString("de-DE")}${pct} → RICHTUNG: ${dir}`;
      }).join("\n")
    : "Marktdaten nicht verfügbar";

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
  const restLines = rest.map(r => formatAssetLine(r.item.symbol, r.item.name, r.data));

  const newsLines = top5.map((item, i) => {
    const r = newsSettled[i];
    if (r.status === "rejected" || !r.value.length) return "";
    const articles = r.value.slice(0, 2).map(n => `  · ${n.title}`).join("\n");
    return articles ? `${item.symbol}:\n${articles}` : "";
  }).filter(Boolean);

  const today = new Date().toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
  const isWeekend = [0, 6].includes(new Date().getDay());

  const prompt = `Morgen-Briefing für ${today}${isWeekend ? " (Wochenende — Märkte geschlossen, Wochenrückblick)" : ""}.

MARKTINDIZES (mit vorberechneten Richtungsangaben — bindend):
${indicesLine}

WATCHLIST — HEUTE AUFFÄLLIG (≥ 1,5 % Bewegung):
${notableLines.join("\n")}

WATCHLIST — WEITERE POSITIONEN:
${restLines.length > 0 ? restLines.join("\n") : "—"}

ANALYSE-SCORES (gespeichert):
${scoresLine}

NEWS-SCHLAGZEILEN:
${newsLines.join("\n") || "Keine Schlagzeilen verfügbar"}

EARNINGS-TERMINE (nächste 14 Tage in Watchlist):
${earningsLines.length > 0 ? earningsLines.join("\n") : "Keine bevorstehenden Earnings"}

IDEE-KANDIDATEN (vorberechnet — wähle aus dieser Liste):
${ideaCandidatesBlock || "Keine Kandidaten bewertet"}
Empfohlener Fokus: ${topCandidate ? `${topCandidate.symbol} (${topCandidate.reasons.join(", ")})` : "—"}

AUFGABE:
Erstelle ein Morgen-Briefing auf Deutsch. Fokus:
- 60 % Marktbild: Was bewegt die Märkte heute? Beziehe dich auf die Indizes.
- 25 % Watchlist-Relevanz: Nur Positionen nennen, die heute wirklich auffällig sind.
- 15 % Idee des Tages: Wähle aus den IDEE-KANDIDATEN. Formuliere als Research-Frage.

PFLICHT-REGELN:
- Indexbewegungen: AUSSCHLIESSLICH die vorberechneten RICHTUNG-Labels verwenden. Keine eigenen Einschätzungen.
- Keine Sektor-Aussagen ("Technologie-Sektor unter Druck") ohne echte Sektor-ETF-Daten. Nur konkrete Watchlist-Symbole nennen.
- Keine Kauf-/Verkaufsempfehlungen, keine Renditeversprechen, keine Kursziele.
- Beobachtend und research-orientiert formulieren: "beobachten", "prüfen", "auffällig", "research-würdig".
- Keine erfundenen Fachbegriffe. Nur geläufiges Deutsch.
- watchlist_highlights: maximal 3 Einträge, nur bei echten Signalen.
- daily_opportunity.these: konkrete Research-Frage (z.B. "These: Prüfen, ob ... fundamental relevant ist.")

JSON (exakt dieses Format):
{"headline":"Eine prägnante Zeile was heute wichtig ist","market_overview":"2-3 Sätze zur Marktlage — nur Indizes und Fakten, keine Sektor-Verallgemeinerungen","watchlist_highlights":["SYMBOL: beobachtende Formulierung, nur wenn auffällig"],"daily_opportunity":{"symbol":"TICKER","name":"Unternehmensname","reason":"1-2 Sätze warum research-würdig","these":"These: Konkrete Frage die Research klären soll"}}`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
      system: "Du bist ein nüchterner Research-Assistent für ein privates Finanz-Dashboard. Erstelle faktenbasierte Morgen-Briefings auf Deutsch. Keine Kauf-/Verkaufsempfehlungen, keine Renditeversprechen, keine Kursziele. Verwende für Indexbewegungen ausschließlich die im Prompt vorberechneten RICHTUNG-Labels. Beziehe dich nur auf bereitgestellte Daten. Antworte ausschließlich mit validem JSON.",
      messages: [{ role: "user", content: prompt }],
    });

    const parsed = parseJSON<{
      headline: string;
      market_overview: string;
      watchlist_highlights: string[];
      daily_opportunity: { symbol: string; name: string; reason: string; these?: string } | null;
    }>(extractText(response.content));

    // ── Post-generation validation + sanitizing ───────────────────────────
    const allText = [
      parsed.market_overview,
      ...parsed.watchlist_highlights,
      parsed.daily_opportunity?.reason ?? "",
    ].join(" ");

    const indexWarnings: IndexWarning[] = validateIndexClaims(allText, liveIndices as MarketIndex[]);
    const sanitized = sanitizeText(allText, false); // no sector-ETF data available

    // Apply direction patch + sanitization to individual fields
    const processField = (s: string) => {
      const patched = patchIndexDirections(s, liveIndices as MarketIndex[]);
      const clean   = sanitizeText(patched.text, false);
      return { text: clean.text, patchChanges: patched.changes, sanitizeChanges: clean.changes };
    };

    const overviewResult     = processField(parsed.market_overview);
    const finalOverview      = overviewResult.text;
    const finalHighlights    = parsed.watchlist_highlights.map(h => processField(h).text);
    const finalOpportunity   = parsed.daily_opportunity
      ? {
          ...parsed.daily_opportunity,
          reason: processField(parsed.daily_opportunity.reason).text,
          these: parsed.daily_opportunity.these
            ? processField(parsed.daily_opportunity.these).text
            : undefined,
        }
      : null;

    // Collect all patch + sanitize changes across fields
    const allPatchChanges = [
      ...overviewResult.patchChanges,
      ...parsed.watchlist_highlights.flatMap(h => processField(h).patchChanges),
    ];
    const allSanitizeChanges = [
      ...overviewResult.sanitizeChanges,
      ...sanitized.changes,
    ];

    const allWarnings: string[] = [
      ...indexWarnings.map(w => w.warning),
      ...allSanitizeChanges,
    ];

    // ── Build extended protocol ───────────────────────────────────────────
    const protocol: BriefingProtocol = {
      agent: "finn",
      model: "claude-haiku-4-5-20251001",
      watchlist_total: watchlist.length,
      notable_symbols: notable.map(r => r.item.symbol),
      news_fetched_for: newsFetchedFor,
      news_headlines: allNewsHeadlines,
      upcoming_earnings: earningsLines,
      scores_used: scores.map(s => s.symbol),
      indices_count: (liveIndices as MarketIndex[]).length,
      data_quality: dataQuality,
      validation_warnings: allWarnings,
      was_sanitized: allPatchChanges.length > 0 || allSanitizeChanges.length > 0,
      sanitization_changes: [...allPatchChanges, ...allSanitizeChanges],
      idea_selection_reasons: topCandidate?.reasons ?? [],
    };

    const { data: saved } = await supabase
      .from("morning_briefings")
      .insert({
        user_id: user.id,
        headline: parsed.headline ?? "",
        market_overview: finalOverview,
        watchlist_highlights: finalHighlights,
        daily_opportunity: finalOpportunity ?? null,
        protocol: protocol as unknown as Json,
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
      market_overview: finalOverview,
      watchlist_highlights: finalHighlights,
      daily_opportunity: finalOpportunity,
      protocol,
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
