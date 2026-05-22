/*
 * Multi-Agent AI Analysis for growth-oriented investors.
 *
 * Required Supabase migration (run once in Supabase SQL editor):
 *
 *   CREATE TABLE IF NOT EXISTS public.ai_analyses (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     symbol TEXT NOT NULL,
 *     recommendation TEXT NOT NULL,
 *     conviction INTEGER NOT NULL,
 *     summary TEXT NOT NULL,
 *     bull_case JSONB NOT NULL DEFAULT '[]',
 *     bear_case JSONB NOT NULL DEFAULT '[]',
 *     growth_outlook TEXT NOT NULL DEFAULT '',
 *     fundamental_rating INTEGER NOT NULL DEFAULT 5,
 *     fundamental_positives JSONB NOT NULL DEFAULT '[]',
 *     fundamental_risks JSONB NOT NULL DEFAULT '[]',
 *     valuation_comment TEXT NOT NULL DEFAULT '',
 *     news_sentiment TEXT NOT NULL DEFAULT 'neutral',
 *     news_themes JSONB NOT NULL DEFAULT '[]',
 *     sentiment_summary TEXT NOT NULL DEFAULT '',
 *     analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *   CREATE INDEX IF NOT EXISTS ai_analyses_symbol_analyzed_at
 *     ON public.ai_analyses(symbol, analyzed_at DESC);
 *   ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Allow authenticated" ON public.ai_analyses
 *     FOR ALL TO authenticated USING (true) WITH CHECK (true);
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import {
  fetchAssetData,
  fetchGoogleNews,
  fetchEdgarFacts,
  fetchInsiderTrades,
  fetchTrends,
  fetchInstitutional,
} from "@/lib/finance-client";
import type {
  GoogleNewsItem,
  EdgarFacts,
  InsiderTrade,
  TrendPoint,
  InstitutionalData,
} from "@/lib/finance-client";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import type { AssetSnapshot, Database } from "@/types/database";

type AIAnalysisInsert = Database["public"]["Tables"]["ai_analyses"]["Insert"];

const CACHE_TTL_HOURS = 6;

interface FundamentalAnalysis {
  growth_rating: number;
  key_positives: string[];
  key_risks: string[];
  valuation_comment: string;
}

interface SentimentAnalysis {
  sentiment: "bullish" | "neutral" | "bearish";
  key_themes: string[];
  sentiment_summary: string;
}

interface SynthesisResult {
  recommendation: string;
  conviction: number;
  summary: string;
  bull_case: string[];
  bear_case: string[];
  growth_outlook: string;
}

interface MarketIntelAnalysis {
  insider_signal: "bullish" | "neutral" | "bearish";
  institutional_trend: "accumulating" | "stable" | "reducing";
  trends_momentum: "rising" | "stable" | "declining";
  key_observations: string[];
}

export interface AIAnalysisResult extends SynthesisResult {
  symbol: string;
  fundamental: FundamentalAnalysis;
  sentiment: SentimentAnalysis;
  market_intel: MarketIntelAnalysis | null;
  analyzed_at: string;
  from_cache: boolean;
}

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("");
}

function parseJSON<T>(raw: string): T {
  // Remove markdown fences, then extract the JSON object between first { and last }
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found");
  return JSON.parse(stripped.slice(start, end + 1)) as T;
}

function formatMetrics(s: AssetSnapshot): string {
  const fmt = (n: number | null, decimals = 2) => n != null ? n.toFixed(decimals) : "N/A";
  const fmtBig = (n: number | null) => {
    if (n == null) return "N/A";
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)} T`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} Mrd.`;
    return `${(n / 1e6).toFixed(2)} Mio.`;
  };

  return [
    `Preis: ${fmt(s.price)} ${s.currency ?? "USD"}`,
    `KGV (P/E): ${fmt(s.pe_ratio, 1)}`,
    `Marktkapitalisierung: ${fmtBig(s.market_cap)}`,
    `Umsatzwachstum: ${s.revenue_growth != null ? (s.revenue_growth * 100).toFixed(1) + "%" : "N/A"}`,
    `Free Cashflow: ${fmtBig(s.free_cashflow)}`,
    `Debt/Equity: ${fmt(s.debt_to_equity)}`,
    `RSI (14): ${fmt(s.rsi, 1)}`,
    `50-Tage-MA: ${fmt(s.moving_average_50)}`,
    `200-Tage-MA: ${fmt(s.moving_average_200)}`,
  ].join("\n");
}

function formatEdgarTrend(facts: EdgarFacts | null): string {
  if (!facts) return "";
  const fmtVal = (v: number) => {
    if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)} Mrd.`;
    return `$${(v / 1e6).toFixed(1)} Mio.`;
  };
  const lines: string[] = [];
  if (facts.revenue.length > 0) {
    lines.push("SEC EDGAR Umsatz (letzte Quartale): " +
      facts.revenue.slice(0, 6).map(r => `${r.period}: ${fmtVal(r.value)}`).join(" | "));
  }
  if (facts.net_income.length > 0) {
    lines.push("Nettogewinn: " +
      facts.net_income.slice(0, 4).map(r => `${r.period}: ${fmtVal(r.value)}`).join(" | "));
  }
  if (facts.gross_profit.length > 0) {
    lines.push("Bruttogewinn: " +
      facts.gross_profit.slice(0, 4).map(r => `${r.period}: ${fmtVal(r.value)}`).join(" | "));
  }
  return lines.join("\n");
}

async function runFundamentalAgent(s: AssetSnapshot, edgar: EdgarFacts | null): Promise<FundamentalAnalysis> {
  const client = getClient();
  const edgarSection = formatEdgarTrend(edgar);
  const prompt = `Bewerte diese Aktie für einen wachstumsorientierten Investor:\n\n${formatMetrics(s)}${edgarSection ? "\n\n" + edgarSection : ""}\n\nJSON-Format:\n{"growth_rating":<1-10>,"key_positives":["..."],"key_risks":["..."],"valuation_comment":"..."}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system:
      "Du bist ein wachstumsorientierter Aktienanalyst. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach.",
    messages: [{ role: "user", content: prompt }],
  });

  const fallback: FundamentalAnalysis = {
    growth_rating: 5,
    key_positives: ["Daten werden ausgewertet"],
    key_risks: ["Daten werden ausgewertet"],
    valuation_comment: "Bewertung nicht verfügbar",
  };

  try {
    return parseJSON<FundamentalAnalysis>(extractText(response.content));
  } catch {
    return fallback;
  }
}

async function runSentimentAgent(news: GoogleNewsItem[]): Promise<SentimentAnalysis> {
  if (news.length === 0) {
    return {
      sentiment: "neutral",
      key_themes: ["Keine aktuellen Nachrichten verfügbar"],
      sentiment_summary: "Keine Nachrichten zum Auswerten.",
    };
  }

  const client = getClient();
  const headlines = news.map(n => `- ${n.title} (${n.source})`).join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system:
      "Du bist ein Finanz-Nachrichtenanalyst. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach.",
    messages: [
      {
        role: "user",
        content: `Analysiere diese Schlagzeilen für Investoren:\n\n${headlines}\n\nJSON-Format:\n{"sentiment":"bullish"|"neutral"|"bearish","key_themes":["..."],"sentiment_summary":"..."}`,
      },
    ],
  });

  try {
    return parseJSON<SentimentAnalysis>(extractText(response.content));
  } catch {
    return {
      sentiment: "neutral",
      key_themes: ["Analyse nicht verfügbar"],
      sentiment_summary: "Nachrichtenanalyse konnte nicht verarbeitet werden.",
    };
  }
}

async function runSynthesisAgent(
  symbol: string,
  s: AssetSnapshot,
  fundamental: FundamentalAnalysis,
  sentiment: SentimentAnalysis,
  marketIntel: MarketIntelAnalysis | null,
): Promise<SynthesisResult> {
  const client = getClient();

  const marketIntelSection = marketIntel
    ? `\nMARKT-INTELLIGENZ:
Insider-Signal: ${marketIntel.insider_signal.toUpperCase()}
Institutioneller Trend: ${marketIntel.institutional_trend.toUpperCase()}
Google Trends: ${marketIntel.trends_momentum.toUpperCase()}
Beobachtungen: ${marketIntel.key_observations.join(" | ")}`
    : "";

  const context = `AKTIE: ${symbol}
KENNZAHLEN:
${formatMetrics(s)}

WACHSTUMSBEWERTUNG: ${fundamental.growth_rating}/10
Stärken: ${fundamental.key_positives.join(" | ")}
Risiken: ${fundamental.key_risks.join(" | ")}
Bewertungskommentar: ${fundamental.valuation_comment}

NACHRICHTENSTIMMUNG: ${sentiment.sentiment.toUpperCase()}
Themen: ${sentiment.key_themes.join(", ")}
${sentiment.sentiment_summary}${marketIntelSection}`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1200,
    thinking: { type: "adaptive" },
    system:
      "Du bist ein erfahrener Investment-Analyst spezialisiert auf Wachstumsaktien. Erstelle eine präzise, faktenbasierte Investmentempfehlung auf Deutsch. Antworte ausschließlich mit validem JSON, ohne Text davor oder danach.",
    messages: [
      {
        role: "user",
        content: `Erstelle eine Investmentempfehlung:\n\n${context}\n\nJSON-Format:\n{"recommendation":"Kaufen"|"Leicht kaufen"|"Halten"|"Leicht verkaufen"|"Verkaufen","conviction":<1-10>,"summary":"2-3 Sätze","bull_case":["...","...","..."],"bear_case":["...","..."],"growth_outlook":"Ausblick auf das Wachstumspotenzial"}`,
      },
    ],
  });

  const fallback: SynthesisResult = {
    recommendation: "Halten",
    conviction: 5,
    summary: "Analyse konnte nicht erstellt werden.",
    bull_case: [],
    bear_case: [],
    growth_outlook: "Nicht verfügbar",
  };

  try {
    return parseJSON<SynthesisResult>(extractText(response.content));
  } catch {
    return fallback;
  }
}

function formatMarketIntel(
  trades: InsiderTrade[],
  trends: TrendPoint[],
  institutional: InstitutionalData | null,
): string {
  const lines: string[] = [];

  if (trades.length > 0) {
    const fmtVal = (v: number | null) =>
      v != null ? `$${(v / 1e6).toFixed(2)} Mio.` : "";
    const tradeLines = trades.slice(0, 5).map(t =>
      `${t.transaction_type === "buy" ? "KAUF" : "VERKAUF"} ${t.name} (${t.title}): ${t.shares?.toLocaleString()} Aktien @ $${t.price?.toFixed(2)} ${fmtVal(t.value)} am ${t.date}`
    );
    lines.push("INSIDER-TRANSAKTIONEN:\n" + tradeLines.join("\n"));
  }

  if (institutional) {
    const pctI = institutional.pct_institutions != null
      ? `${(institutional.pct_institutions * 100).toFixed(1)}%`
      : "N/A";
    const pctIn = institutional.pct_insider != null
      ? `${(institutional.pct_insider * 100).toFixed(2)}%`
      : "N/A";
    const holders = institutional.top_holders
      .slice(0, 5)
      .map(h => `${h.holder}${h.pct_held != null ? " " + (h.pct_held * 100).toFixed(1) + "%" : ""}`)
      .join(", ");
    lines.push(`INSTITUTIONELLE: Insider ${pctIn} | Institutionen ${pctI}\nTop-Holder: ${holders}`);
  }

  if (trends.length > 0) {
    const recent = trends.slice(0, 4).map(t => t.value);
    const old = trends.slice(-4).map(t => t.value);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const avgOld = old.reduce((a, b) => a + b, 0) / old.length;
    const current = trends[0].value;
    const trendDir = avgRecent > avgOld * 1.1 ? "steigend" : avgRecent < avgOld * 0.9 ? "fallend" : "stabil";
    lines.push(`GOOGLE TRENDS (0-100): Aktuell ${current} | Trend: ${trendDir} | Ø letzt. 4 Wochen: ${avgRecent.toFixed(0)} vs. Ø vor 1 Jahr: ${avgOld.toFixed(0)}`);
  }

  return lines.join("\n\n");
}

async function runMarketIntelAgent(
  trades: InsiderTrade[],
  trends: TrendPoint[],
  institutional: InstitutionalData | null,
): Promise<MarketIntelAnalysis> {
  const hasInstitutionalData =
    institutional != null &&
    (institutional.pct_institutions != null || institutional.top_holders.length > 0);
  const noData = trades.length === 0 && trends.length === 0 && !hasInstitutionalData;
  if (noData) {
    return {
      insider_signal: "neutral",
      institutional_trend: "stable",
      trends_momentum: "stable",
      key_observations: ["Keine Markt-Intelligenz-Daten verfügbar"],
    };
  }

  const client = getClient();
  const context = formatMarketIntel(trades, trends, institutional);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system:
      "Du bist ein Marktanalyse-Experte. Bewerte Insider-Aktivität, institutionelle Positionierung und Suchtrends als Investmentsignale. Antworte ausschließlich mit validem JSON.",
    messages: [
      {
        role: "user",
        content: `Analysiere diese Markt-Signale:\n\n${context}\n\nJSON-Format:\n{"insider_signal":"bullish"|"neutral"|"bearish","institutional_trend":"accumulating"|"stable"|"reducing","trends_momentum":"rising"|"stable"|"declining","key_observations":["..."]}`,
      },
    ],
  });

  try {
    return parseJSON<MarketIntelAnalysis>(extractText(response.content));
  } catch {
    return {
      insider_signal: "neutral",
      institutional_trend: "stable",
      trends_momentum: "stable",
      key_observations: ["Markt-Intelligenz konnte nicht ausgewertet werden"],
    };
  }
}

async function getCached(symbol: string): Promise<AIAnalysisResult | null> {
  try {
    const supabase = await createClient();
    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();

    const { data } = await supabase
      .from("ai_analyses")
      .select("*")
      .eq("symbol", symbol)
      .gte("analyzed_at", cutoff)
      .order("analyzed_at", { ascending: false })
      .limit(1)
      .single();

    if (!data) return null;

    return {
      symbol: data.symbol,
      recommendation: data.recommendation,
      conviction: data.conviction,
      summary: data.summary,
      bull_case: data.bull_case as string[],
      bear_case: data.bear_case as string[],
      growth_outlook: data.growth_outlook,
      fundamental: {
        growth_rating: data.fundamental_rating,
        key_positives: data.fundamental_positives as string[],
        key_risks: data.fundamental_risks as string[],
        valuation_comment: data.valuation_comment,
      },
      sentiment: {
        sentiment: data.news_sentiment as "bullish" | "neutral" | "bearish",
        key_themes: data.news_themes as string[],
        sentiment_summary: data.sentiment_summary,
      },
      market_intel: (data.extra_data as Record<string, unknown>)?.market_intel as MarketIntelAnalysis | null ?? null,
      analyzed_at: data.analyzed_at,
      from_cache: true,
    };
  } catch {
    return null;
  }
}

async function saveAnalysis(result: AIAnalysisResult): Promise<void> {
  try {
    const supabase = await createClient();
    const payload: AIAnalysisInsert = {
      symbol: result.symbol,
      recommendation: result.recommendation,
      conviction: result.conviction,
      summary: result.summary,
      bull_case: result.bull_case,
      bear_case: result.bear_case,
      growth_outlook: result.growth_outlook,
      fundamental_rating: result.fundamental.growth_rating,
      fundamental_positives: result.fundamental.key_positives,
      fundamental_risks: result.fundamental.key_risks,
      valuation_comment: result.fundamental.valuation_comment,
      news_sentiment: result.sentiment.sentiment,
      news_themes: result.sentiment.key_themes,
      sentiment_summary: result.sentiment.sentiment_summary,
      extra_data: result.market_intel
        ? ({ market_intel: result.market_intel } as unknown as import("@/types/database").Json)
        : {},
    };
    await supabase.from("ai_analyses").insert(payload);
  } catch {
    // Non-critical — analysis still returned even if caching fails
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "KI-Analyse nicht konfiguriert. Bitte ANTHROPIC_API_KEY in den Umgebungsvariablen setzen." },
      { status: 503 },
    );
  }

  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  // 5 live analyses per 10 minutes per user (expensive API calls)
  const rl = rateLimit({ key: `ai-analysis:${user.id}`, limit: 5, windowSecs: 600 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Zu viele KI-Anfragen. Bitte warte kurz." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      },
    );
  }

  const { symbol: rawSymbol } = await params;
  const parsed = tickerSchema.safeParse(rawSymbol);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Ticker-Symbol" }, { status: 400 });
  }
  const symbol = parsed.data;

  const cached = await getCached(symbol);
  if (cached) return NextResponse.json(cached);

  try {
    const [assetData, googleNews, edgarFacts, insiderTrades, trends, institutional] =
      await Promise.all([
        fetchAssetData(symbol),
        fetchGoogleNews(symbol).catch(() => [] as GoogleNewsItem[]),
        fetchEdgarFacts(symbol).catch(() => null),
        fetchInsiderTrades(symbol).catch(() => [] as InsiderTrade[]),
        fetchTrends(symbol).catch(() => [] as TrendPoint[]),
        fetchInstitutional(symbol).catch(() => null),
      ]);

    const snapshot: AssetSnapshot = {
      id: "",
      symbol: assetData.symbol,
      price: assetData.price,
      currency: assetData.currency,
      pe_ratio: assetData.pe_ratio,
      market_cap: assetData.market_cap,
      debt_to_equity: assetData.debt_to_equity,
      revenue_growth: assetData.revenue_growth,
      free_cashflow: assetData.free_cashflow,
      rsi: assetData.rsi,
      moving_average_50: assetData.moving_average_50,
      moving_average_200: assetData.moving_average_200,
      fetched_at: assetData.fetched_at,
    };

    const [fundamental, sentiment, market_intel] = await Promise.all([
      runFundamentalAgent(snapshot, edgarFacts),
      runSentimentAgent(googleNews),
      runMarketIntelAgent(insiderTrades, trends, institutional),
    ]);

    const synthesis = await runSynthesisAgent(symbol, snapshot, fundamental, sentiment, market_intel);

    const result: AIAnalysisResult = {
      symbol,
      ...synthesis,
      fundamental,
      sentiment,
      market_intel,
      analyzed_at: new Date().toISOString(),
      from_cache: false,
    };

    await saveAnalysis(result);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json(
      { error: `KI-Analyse fehlgeschlagen: ${message}` },
      { status: 503 },
    );
  }
}
