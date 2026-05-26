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
 *
 *   -- Vera Feedback Dataset:
 *   CREATE TABLE IF NOT EXISTS public.fact_check_findings (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     analysis_id UUID REFERENCES public.ai_analyses(id) ON DELETE CASCADE,
 *     symbol TEXT NOT NULL,
 *     claim TEXT NOT NULL,
 *     issue_type TEXT NOT NULL CHECK (issue_type IN (
 *       'unbelegt_guidance','uebertriebener_konsens','falsche_zahl',
 *       'erfundenes_event','fehlende_evidenz','sonstiges'
 *     )),
 *     correction TEXT NOT NULL,
 *     severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
 *     evidence_urls TEXT[] DEFAULT '{}',
 *     confidence INTEGER NOT NULL CHECK (confidence >= 1 AND confidence <= 10),
 *     review_status TEXT NOT NULL DEFAULT 'auto' CHECK (review_status IN ('auto','confirmed','rejected')),
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *   CREATE INDEX IF NOT EXISTS fact_check_findings_symbol
 *     ON public.fact_check_findings(symbol, created_at DESC);
 *   CREATE INDEX IF NOT EXISTS fact_check_findings_issue_type
 *     ON public.fact_check_findings(issue_type, created_at DESC);
 *   ALTER TABLE public.fact_check_findings ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Allow authenticated" ON public.fact_check_findings
 *     FOR ALL TO authenticated USING (true) WITH CHECK (true);
 */

import { NextRequest, NextResponse, after } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import {
  fetchAssetData,
  fetchGoogleNews,
  fetchEdgarFacts,
  fetchInsiderTrades,
  fetchTrends,
  fetchInstitutional,
  fetchAnalystData,
} from "@/lib/finance-client";
import type {
  GoogleNewsItem,
  EdgarFacts,
  InsiderTrade,
  TrendPoint,
  InstitutionalData,
  AnalystData,
} from "@/lib/finance-client";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/rate-limit";
import { PEER_MAP } from "@/lib/peer-map";
import { enrichWithDescriptions, fetchArticleDescription } from "@/lib/article-fetch";
import type { AssetSnapshot, Database } from "@/types/database";

export const maxDuration = 90;

const ENRICH_MAX_ARTICLES = 6;
const ENRICH_TIMEOUT_MS = 8_000;
const VERA_MAX_TURNS = 3;

type AIAnalysisInsert = Database["public"]["Tables"]["ai_analyses"]["Insert"];

const CACHE_TTL_HOURS = 6;

// --- Validation constants ---

const ALLOWED_RECOMMENDATIONS = [
  "Kaufen", "Leicht kaufen", "Halten", "Leicht verkaufen", "Verkaufen",
] as const;
type AllowedRecommendation = typeof ALLOWED_RECOMMENDATIONS[number];

const CompleteAnalysisSchema = z.object({
  recommendation: z.enum(["Kaufen", "Leicht kaufen", "Halten", "Leicht verkaufen", "Verkaufen"]),
  conviction: z.number().min(1).max(10),
  summary: z.string().min(1),
  bull_case: z.array(z.string()),
  bear_case: z.array(z.string()),
  growth_outlook: z.string(),
  entry: z.number().nullable().optional(),
  target: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  entry_rationale: z.string().optional(),
  target_rationale: z.string().optional(),
});
type CompleteAnalysisInput = z.infer<typeof CompleteAnalysisSchema>;

// --- Peer context ---

type SbClient = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createServiceClient>;

async function fetchPeerContext(symbol: string, client?: SbClient): Promise<string> {
  // Strip exchange suffix so "VOW3.DE" → "VOW3" matches the peer map
  const baseSymbol = symbol.split(".")[0].toUpperCase();
  const peers = PEER_MAP[symbol] ?? PEER_MAP[baseSymbol];
  if (!peers?.length) return "";

  const supabase = client ?? await createClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("asset_snapshots")
    .select("symbol, pe_ratio, revenue_growth, debt_to_equity, market_cap")
    .in("symbol", peers)
    .gte("fetched_at", cutoff)
    .order("fetched_at", { ascending: false });

  if (!data || data.length === 0) return "";

  const seen = new Set<string>();
  const rows = (data as { symbol: string; pe_ratio: number | null; revenue_growth: number | null; debt_to_equity: number | null; market_cap: number | null }[])
    .filter(r => { if (seen.has(r.symbol)) return false; seen.add(r.symbol); return true; });

  if (rows.length === 0) return "";

  const peValues = rows.map(r => r.pe_ratio).filter((v): v is number => v != null);
  const growthValues = rows.map(r => r.revenue_growth).filter((v): v is number => v != null);
  const deValues = rows.map(r => r.debt_to_equity).filter((v): v is number => v != null);

  const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const peAvg = avg(peValues);
  const growthAvg = avg(growthValues);
  const deAvg = avg(deValues);

  const lines = [`Vergleich mit ${rows.map(r => r.symbol).join(", ")} (Branchen-Peers):`];
  if (peAvg != null) lines.push(`  Ø KGV Peers: ${peAvg.toFixed(1)}`);
  if (growthAvg != null) lines.push(`  Ø Umsatzwachstum Peers: ${(growthAvg * 100).toFixed(1)}%`);
  if (deAvg != null) lines.push(`  Ø Debt/Equity Peers: ${deAvg.toFixed(2)}`);

  return lines.join("\n");
}

// --- Types ---

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

export interface PriceLevels {
  entry: number | null;
  target: number | null;
  stop_loss: number | null;
  entry_rationale: string;
  target_rationale: string;
}

interface SynthesisResult {
  recommendation: string;
  conviction: number;
  summary: string;
  bull_case: string[];
  bear_case: string[];
  growth_outlook: string;
  price_levels?: PriceLevels | null;
}

export interface StructuredFinding {
  claim: string;
  issue_type: "unbelegt_guidance" | "uebertriebener_konsens" | "falsche_zahl" | "erfundenes_event" | "fehlende_evidenz" | "sonstiges";
  correction: string;
  severity: "low" | "medium" | "high";
  evidence_urls: string[];
  confidence: number;
}

interface FactCheckResult {
  corrections: string[];
  verified_claims: string[];
  confidence_adjustment: number;
  corrected_summary?: string;
  corrected_bull_case?: string[];
  corrected_bear_case?: string[];
  findings?: StructuredFinding[];
}

export interface ProtocolEntry {
  agent: string;
  status: "ok" | "warning" | "skipped";
  detail: string;
}

export interface DianaQualityReport {
  completeness_score: number;
  stale_fields: string[];
  missing_fields: string[];
  warnings: string[];
  analysis_confidence_cap: number;
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
  price_levels: PriceLevels | null;
  data_quality: DianaQualityReport | null;
  analyzed_at: string;
  from_cache: boolean;
  protocol: ProtocolEntry[];
}

interface OrchestratorResult {
  recommendation: string;
  conviction: number;
  summary: string;
  bull_case: string[];
  bear_case: string[];
  growth_outlook: string;
  price_levels: PriceLevels | null;
  fundamental: FundamentalAnalysis;
  sentiment: SentimentAnalysis;
  market_intel: MarketIntelAnalysis | null;
  protocol: ProtocolEntry[];
  findings: StructuredFinding[];
}

// --- Helpers ---

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
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found");
  return JSON.parse(stripped.slice(start, end + 1)) as T;
}

function clampConviction(n: number): number {
  return Math.min(10, Math.max(1, Math.round(n)));
}

function validateRecommendation(r: string): AllowedRecommendation {
  return ALLOWED_RECOMMENDATIONS.includes(r as AllowedRecommendation)
    ? (r as AllowedRecommendation)
    : "Halten";
}

function validateBeforeSave(r: AIAnalysisResult): boolean {
  return !!(r.symbol?.trim() && r.summary?.trim() && r.recommendation?.trim());
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
    `Umsatzwachstum (TTM, YoY): ${s.revenue_growth != null ? (s.revenue_growth * 100).toFixed(1) + "%" : "N/A"}`,
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

function formatAnalystData(a: AnalystData | null): string {
  if (!a) return "";
  const total = a.strong_buy + a.buy + a.hold + a.sell + a.strong_sell;
  if (total === 0 && a.mean_target == null) return "";
  const lines: string[] = [];
  if (a.mean_target != null) {
    lines.push(`Analysten-Kursziel: Ø $${a.mean_target.toFixed(2)} (Hoch $${a.high_target?.toFixed(2) ?? "N/A"} / Tief $${a.low_target?.toFixed(2) ?? "N/A"})`);
  }
  if (total > 0) {
    lines.push(`Analysten-Empfehlungen (${total} Analysten): Strong Buy ${a.strong_buy} | Buy ${a.buy} | Hold ${a.hold} | Sell ${a.sell} | Strong Sell ${a.strong_sell}`);
  }
  return lines.join("\n");
}

// --- Agents ---

async function runFundamentalAgent(s: AssetSnapshot, edgar: EdgarFacts | null, peerContext?: string, focus?: string): Promise<FundamentalAnalysis> {
  const client = getClient();
  const edgarSection = formatEdgarTrend(edgar);
  const peerSection = peerContext ? `\n\nBRANCHEN-VERGLEICH:\n${peerContext}\nBewerte KGV, Wachstum und Verschuldung relativ zu diesen Peer-Werten.` : "";
  const focusNote = focus ? `\n\nBesonderer Fokus für diesen Durchlauf: ${focus}` : "";
  const prompt = `Bewerte diese Aktie für einen wachstumsorientierten Investor:\n\n${formatMetrics(s)}${edgarSection ? "\n\n" + edgarSection : ""}${peerSection}${focusNote}\n\nJSON-Format:\n{"growth_rating":<1-10>,"key_positives":["..."],"key_risks":["..."],"valuation_comment":"..."}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: "Du bist ein wachstumsorientierter Aktienanalyst. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach.",
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

type NewsItemWithDesc = GoogleNewsItem & { description?: string | null };

async function runSentimentAgent(news: NewsItemWithDesc[]): Promise<SentimentAnalysis> {
  if (news.length === 0) {
    return {
      sentiment: "neutral",
      key_themes: ["Keine aktuellen Nachrichten verfügbar"],
      sentiment_summary: "Keine Nachrichten zum Auswerten.",
    };
  }

  const client = getClient();

  const PREMIUM_SOURCES = ["Reuters", "Bloomberg", "Financial Times", "WSJ", "Wall Street Journal", "CNBC", "Handelsblatt", "FAZ", "Seeking Alpha"];
  const headlines = news.map(n => {
    const tier = PREMIUM_SOURCES.some(s => n.source.includes(s)) ? "[★]" : "[ ]";
    const desc = n.description ? `\n   → ${n.description}` : "";
    return `${tier} ${n.title} (${n.source})${desc}`;
  }).join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: "Du bist ein Finanz-Nachrichtenanalyst. Artikel von Quellen mit [★] sind besonders zuverlässig und sollen stärker gewichtet werden. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach.",
    messages: [
      {
        role: "user",
        content: `Analysiere diese Schlagzeilen für Investoren ([★] = hochwertige Quelle, stärker gewichten):\n\n${headlines}\n\nJSON-Format:\n{"sentiment":"bullish"|"neutral"|"bearish","key_themes":["..."],"sentiment_summary":"..."}`,
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
  analystData: AnalystData | null,
): Promise<SynthesisResult> {
  const client = getClient();

  const marketIntelSection = marketIntel
    ? `\nMARKT-INTELLIGENZ:
Insider-Signal: ${marketIntel.insider_signal.toUpperCase()}
Institutioneller Trend: ${marketIntel.institutional_trend.toUpperCase()}
Google Trends: ${marketIntel.trends_momentum.toUpperCase()}
Beobachtungen: ${marketIntel.key_observations.join(" | ")}`
    : "";

  const analystSection = formatAnalystData(analystData);

  const currentPriceRef = s.price != null ? `AKTUELLER KURS: ${s.price.toFixed(2)} ${s.currency ?? "USD"} (nicht mit Kurszielen verwechseln)\n\n` : "";
  const context = `AKTIE: ${symbol}
${currentPriceRef}KENNZAHLEN (aktuelle Marktdaten):
${formatMetrics(s)}
${analystSection ? "\nANALYSTEN-KONSENS (Zukunftsprognosen, kein aktueller Kurs):\n" + analystSection : ""}
WACHSTUMSBEWERTUNG: ${fundamental.growth_rating}/10
Stärken: ${fundamental.key_positives.join(" | ")}
Risiken: ${fundamental.key_risks.join(" | ")}
Bewertungskommentar: ${fundamental.valuation_comment}

NACHRICHTENSTIMMUNG: ${sentiment.sentiment.toUpperCase()}
Themen: ${sentiment.key_themes.join(", ")}
${sentiment.sentiment_summary}${marketIntelSection}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system: "Du bist ein erfahrener Investment-Analyst spezialisiert auf Wachstumsaktien. Erstelle eine präzise, faktenbasierte Investmentempfehlung auf Deutsch. WICHTIG: Beziehe dich ausschließlich auf die bereitgestellten Daten. Erwähne keine Firmennamen, Deals, Produkte oder Ereignisse, die nicht explizit in den Daten enthalten sind. Berechne konkrete Kursziele (price_levels): entry als idealen Einstieg (nahe MA50 oder -3% bei RSI>50), target als Kursziel (Analysten-Konsens bevorzugt, sonst +15-25%), stop_loss als -8-12% unter entry. Nutze null wenn Datenlage unklar. Antworte ausschließlich mit validem JSON, ohne Text davor oder danach.",
    messages: [
      {
        role: "user",
        content: `Erstelle eine Investmentempfehlung:\n\n${context}\n\nJSON-Format:\n{"recommendation":"Kaufen"|"Leicht kaufen"|"Halten"|"Leicht verkaufen"|"Verkaufen","conviction":<1-10>,"summary":"2-3 Sätze","bull_case":["...","...","..."],"bear_case":["...","..."],"growth_outlook":"Ausblick","price_levels":{"entry":<Zahl|null>,"target":<Zahl|null>,"stop_loss":<Zahl|null>,"entry_rationale":"Kurzbegründung","target_rationale":"Kurzbegründung"}}`,
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

async function runFactCheckAgent(
  symbol: string,
  synthesis: SynthesisResult,
  analystData: AnalystData | null,
  googleNews: NewsItemWithDesc[],
  snapshot: AssetSnapshot,
  skipArticleFetch = false,
): Promise<{ result: SynthesisResult; entry: ProtocolEntry; findings: StructuredFinding[] }> {
  const client = getClient();

  // URL whitelist — Vera may only fetch URLs already present in googleNews
  const allowedUrls = new Set(googleNews.map(n => n.url).filter((u): u is string => !!u));

  const veraTool: Anthropic.Messages.Tool = {
    name: "fetch_article",
    description: "Ruft den vollständigen Inhalt eines bekannten Nachrichtenartikels ab, um eine Behauptung zu verifizieren. Nur für URLs aus der bereitgestellten News-Liste verwenden. Max. 3 Aufrufe insgesamt.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "URL des Artikels (muss aus der News-Liste stammen)" },
        reason: { type: "string", description: "Welche konkrete Behauptung soll verifiziert werden?" },
      },
      required: ["url", "reason"],
    },
  };

  function articleAgeDays(published: string | null): number | null {
    if (!published) return null;
    try {
      const pub = new Date(published);
      if (isNaN(pub.getTime())) return null;
      return Math.floor((Date.now() - pub.getTime()) / 86_400_000);
    } catch { return null; }
  }

  const newsSection = googleNews.slice(0, 10).map(n => {
    const days = articleAgeDays(n.published);
    const ageLabel = days === null ? "" : days === 0 ? " (heute)" : days === 1 ? " (gestern)" : ` (vor ${days} Tagen)`;
    const excerpt = n.description ? `\n   Excerpt: ${n.description}` : "";
    return `- [${n.url ?? "keine URL"}] ${n.title} (${n.source}${ageLabel})${excerpt}`;
  }).join("\n") || "Keine Schlagzeilen verfügbar";

  const analystSection = formatAnalystData(analystData) || "Keine Analysten-Daten verfügbar";

  const draftText = `Empfehlung: ${synthesis.recommendation} (Überzeugung: ${synthesis.conviction}/10)
Zusammenfassung: ${synthesis.summary}
Bull-Case: ${synthesis.bull_case.join(" | ")}
Bear-Case: ${synthesis.bear_case.join(" | ")}
Wachstumsausblick: ${synthesis.growth_outlook}`;

  const fmtBigAuth = (n: number | null) => {
    if (n == null) return null;
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)} T`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} Mrd.`;
    return `${(n / 1e6).toFixed(2)} Mio.`;
  };

  const authFacts = [
    `Aktueller Kurs: ${snapshot.price?.toFixed(2) ?? "N/A"} ${snapshot.currency ?? "USD"} (live von Finance API — autoritativ)`,
    snapshot.moving_average_50 != null ? `50-Tage-MA: ${snapshot.moving_average_50.toFixed(2)}` : null,
    snapshot.moving_average_200 != null ? `200-Tage-MA: ${snapshot.moving_average_200.toFixed(2)}` : null,
    snapshot.pe_ratio != null ? `KGV: ${snapshot.pe_ratio.toFixed(1)}` : null,
    snapshot.revenue_growth != null ? `Umsatzwachstum (TTM, YoY): ${(snapshot.revenue_growth * 100).toFixed(1)}%` : null,
    snapshot.free_cashflow != null ? `Free Cashflow: ${fmtBigAuth(snapshot.free_cashflow)} ${snapshot.currency ?? "USD"}` : null,
    snapshot.debt_to_equity != null ? `Debt/Equity: ${snapshot.debt_to_equity.toFixed(2)}` : null,
    snapshot.market_cap != null ? `Marktkapitalisierung: ${fmtBigAuth(snapshot.market_cap)} ${snapshot.currency ?? "USD"}` : null,
    snapshot.rsi != null ? `RSI (14): ${snapshot.rsi.toFixed(1)} (live von Finance API — autoritativ)` : null,
    snapshot.currency && snapshot.currency !== "USD"
      ? `Währungshinweis: Finance API liefert Analysten-Kursziele in USD. Opus darf diese in ${snapshot.currency} umrechnen — das ist korrekt und kein Fehler.`
      : null,
  ].filter(Boolean).join("\n");

  const systemPrompt = `Du bist Vera, eine kritische Fact-Checkerin für Finanzanalysen. Du kannst mit fetch_article (max. 3 Aufrufe) vollständige Artikel abrufen um strittige Behauptungen zu verifizieren. Korrigiere nur was durch die gelieferten Fakten nachweislich falsch ist. Antworte am Ende ausschließlich mit validem JSON.

REGELN — Autoritative Daten & Artikel-Freshness:
1. AUTORITATIVE MARKTDATEN (Finance API, live) haben immer Vorrang — alle Werte in diesem Abschnitt (Kurs, MAs, KGV, FCF, D/E, Marktkapitalisierung, Umsatzwachstum, RSI) dürfen NICHT durch Artikelangaben überschrieben oder als "unbelegt" markiert werden. Sie stammen direkt von der Finance API und sind per Definition belegt.
2. Altersbasierte Vertrauensregeln — eine Korrektur ist nur zulässig wenn der Beleg-Artikel aktuell genug ist:
   - Kurse, Marktpreise, aktuelle Kennzahlen: nur Artikel < 2 Tage (älter = veraltet, keine Korrektur)
   - Quartalsergebnisse, Guidance, Prognosen: nur Artikel < 14 Tage
   - Ereignisse (M&A, Produktlaunch, Personalwechsel): nur Artikel < 30 Tage
   - Strukturelle Fakten (Geschäftsmodell, Branche, Produktkategorien): kein Alterslimit
   - Bei zu alten Artikeln: KEINE Korrektur — ggf. als findings-Eintrag mit confidence ≤ 4 und Hinweis "Artikel möglicherweise veraltet (vor X Tagen)"
3. Prozentzahlen in Artikeln (z.B. "51% Rally vom März-Tief") sind historische Kursbewegungen, keine MA-Abstände — nicht als MA-Korrektur verwenden.
4. Umsatzwachstum (TTM, YoY) ist der korrekte Jahresvergleich — einzelne positive Quartale widerlegen einen negativen TTM-Wert nicht.
5. Währungsumrechnung bei Analysten-Kurszielen: Finance API liefert Kursziele immer in USD. Bei Aktien die nicht in USD notieren darf Opus diese in die lokale Notierungswährung umrechnen. Eine solche Umrechnung ist KEIN Fehler — auch wenn der umgerechnete Wert vom USD-Betrag in den autoritativen Daten abweicht.`;

  const userContent = `Prüfe diese KI-Analyse für ${symbol} auf Faktengenauigkeit.

AUTORITATIVE MARKTDATEN (Finance API, live — Vorrang vor Nachrichtenartikeln):
${authFacts}

ANALYSTEN-KONSENS (Zukunftsprognosen):
${analystSection}

NACHRICHTEN (Alter in Klammern — beachte Altersregeln; Preisangaben in Artikeln sind historisch):
${newsSection}

ZU PRÜFENDE ANALYSE:
${draftText}

Wenn ein Excerpt zu kurz ist um eine Behauptung zu verifizieren: nutze fetch_article für den relevantesten Artikel.

Abschließendes JSON-Format:
{"corrections":["konkrete Korrektur, oder leeres Array"],"verified_claims":["verifizierte Aussagen"],"confidence_adjustment":<-3 bis 0>,"corrected_summary":"<nur bei Faktenfehler, sonst null>","corrected_bull_case":["<korrigierte Liste>"],"corrected_bear_case":["<korrigierte Liste>"],"findings":[{"claim":"<betroffene Behauptung>","issue_type":"unbelegt_guidance|uebertriebener_konsens|falsche_zahl|erfundenes_event|fehlende_evidenz|sonstiges","correction":"<Korrektur>","severity":"low|medium|high","evidence_urls":["<URL>"],"confidence":<1-10>}]}`;

  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userContent }];
  const fallbackEntry: ProtocolEntry = { agent: "Vera", status: "skipped", detail: "Fact-Check nicht verfügbar" };
  let fetchCount = 0;
  let factCheck: FactCheckResult | null = null;

  // Im schnellen Modus (Background-Job): kein fetch_article → ein einziger Sonnet-Call
  const activeTools = skipArticleFetch ? [] : [veraTool];
  const maxTurns = skipArticleFetch ? 1 : VERA_MAX_TURNS;

  try {
    for (let i = 0; i < maxTurns; i++) {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: systemPrompt,
        ...(activeTools.length > 0
          ? { tools: activeTools, tool_choice: { type: "auto" } as Anthropic.Messages.ToolChoiceAuto }
          : {}),
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
        const text = extractText(response.content);
        if (text) {
          try { factCheck = parseJSON<FactCheckResult>(text); } catch { /* incomplete JSON → fallback */ }
        }
        break;
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      if (!toolUses.length) break;

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (tu.name !== "fetch_article") {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Unbekanntes Tool." });
          continue;
        }
        if (fetchCount >= 3) {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Limit erreicht: max. 3 fetch_article Aufrufe erlaubt." });
          continue;
        }
        const { url } = tu.input as { url: string; reason: string };
        if (!allowedUrls.has(url)) {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Fehler: URL nicht in der erlaubten News-Liste." });
          continue;
        }
        fetchCount++;
        const articleContent = await fetchArticleDescription(url, { maxLines: 6, maxChars: 1200 });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: articleContent ?? "Artikel konnte nicht abgerufen werden.",
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch {
    return { result: synthesis, entry: fallbackEntry, findings: [] };
  }

  if (!factCheck) return { result: synthesis, entry: fallbackEntry, findings: [] };

  const corrections = (factCheck.corrections ?? []).filter(c => c.length > 0);
  const convictionNew = clampConviction(synthesis.conviction + (factCheck.confidence_adjustment ?? 0));

  const result: SynthesisResult = {
    ...synthesis,
    conviction: convictionNew,
    summary: factCheck.corrected_summary ?? synthesis.summary,
    bull_case: factCheck.corrected_bull_case ?? synthesis.bull_case,
    bear_case: factCheck.corrected_bear_case ?? synthesis.bear_case,
  };

  const fetchNote = fetchCount > 0 ? ` · ${fetchCount} Artikel nachrecherchiert` : "";
  const entry: ProtocolEntry = corrections.length > 0
    ? {
        agent: "Vera",
        status: "warning",
        detail: `${corrections.length} Korrektur${corrections.length > 1 ? "en" : ""}: ${corrections.join(" · ")}${factCheck.confidence_adjustment ? ` · Conviction ${synthesis.conviction}→${convictionNew}` : ""}${fetchNote}`,
      }
    : {
        agent: "Vera",
        status: "ok",
        detail: `${(factCheck.verified_claims ?? []).length} Aussagen verifiziert — keine Korrekturen nötig${fetchNote}`,
      };

  const findings: StructuredFinding[] = (factCheck.findings ?? []).map(f => ({
    ...f,
    confidence: clampConviction(f.confidence ?? 5),
  }));

  return { result, entry, findings };
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
    system: "Du bist ein Marktanalyse-Experte. Bewerte Insider-Aktivität, institutionelle Positionierung und Suchtrends als Investmentsignale. Antworte ausschließlich mit validem JSON.",
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

// --- Guardrails & Feedback Dataset ---

async function fetchGuardrails(symbol: string, client?: SbClient): Promise<string> {
  try {
    const supabase = client ?? await createClient();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: symbolData }, { data: globalData }] = await Promise.all([
      supabase.from("fact_check_findings")
        .select("correction, issue_type")
        .eq("symbol", symbol)
        .gte("created_at", cutoff)
        .neq("review_status", "rejected")
        .gte("confidence", 7)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.from("fact_check_findings")
        .select("correction, issue_type")
        .gte("created_at", cutoff)
        .neq("review_status", "rejected")
        .gte("confidence", 9)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const seen = new Set<string>();
    const lines: string[] = [];
    const rows = [...((symbolData as { correction: string; issue_type: string }[] | null) ?? []), ...((globalData as { correction: string; issue_type: string }[] | null) ?? [])];
    for (const r of rows) {
      const key = r.correction.slice(0, 60);
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(`  - ${r.correction}`);
      }
    }
    if (!lines.length) return "";
    return `HISTORISCHE GUARDRAILS (aus früheren Vera-Korrekturen — strikt einhalten):\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

async function saveFactCheckFindings(
  analysisId: string | null,
  symbol: string,
  findings: StructuredFinding[],
  client?: SbClient,
): Promise<void> {
  if (!findings.length || !analysisId) return;
  try {
    const supabase = client ?? await createClient();
    await supabase.from("fact_check_findings").insert(
      findings.map(f => ({
        analysis_id: analysisId,
        symbol,
        claim: f.claim,
        issue_type: f.issue_type,
        correction: f.correction,
        severity: f.severity,
        evidence_urls: f.evidence_urls ?? [],
        confidence: clampConviction(f.confidence),
        review_status: "auto",
      })),
    );
  } catch { /* Non-critical */ }
}

// --- Diana · Datenqualitäts-Modul ---

function runDianaCheck(
  snapshot: AssetSnapshot,
  googleNews: NewsItemWithDesc[],
  edgarFacts: EdgarFacts | null,
  analystData: AnalystData | null,
  peerContext: string,
): DianaQualityReport {
  let score = 100;
  const missing: string[] = [];
  const stale: string[] = [];
  const warnings: string[] = [];

  if (snapshot.price == null) { score -= 30; missing.push("Aktueller Kurs"); }

  if (snapshot.fetched_at) {
    const ageHours = (Date.now() - new Date(snapshot.fetched_at).getTime()) / 3600000;
    if (ageHours > 48) { score -= 10; stale.push(`Kursdaten (${Math.round(ageHours)}h alt)`); }
  }

  const fundamentalFields: [string, keyof AssetSnapshot, number][] = [
    ["KGV", "pe_ratio", 5],
    ["Marktkapitalisierung", "market_cap", 5],
    ["Umsatzwachstum", "revenue_growth", 5],
    ["Free Cashflow", "free_cashflow", 5],
    ["Debt/Equity", "debt_to_equity", 3],
    ["RSI", "rsi", 3],
    ["MA50", "moving_average_50", 2],
    ["MA200", "moving_average_200", 2],
  ];
  for (const [label, key, pts] of fundamentalFields) {
    if (snapshot[key] == null) { score -= pts; missing.push(label); }
  }

  if (!edgarFacts || edgarFacts.revenue.length === 0) {
    score -= 15; missing.push("EDGAR-Quartalsdaten");
  } else if (edgarFacts.revenue.length < 4) {
    score -= 5; warnings.push(`Nur ${edgarFacts.revenue.length} EDGAR-Quartale`);
  }

  if (googleNews.length === 0) {
    score -= 10; missing.push("Aktuelle News");
  } else {
    const withExcerpts = googleNews.filter(n => n.description).length;
    if (withExcerpts < 2) {
      score -= 5; warnings.push(`Nur ${withExcerpts}/${googleNews.length} News mit Auszug`);
    }
  }

  const hasAnalystData = analystData && (
    analystData.mean_target != null ||
    analystData.strong_buy + analystData.buy + analystData.hold + analystData.sell + analystData.strong_sell > 0
  );
  if (!hasAnalystData) { score -= 10; missing.push("Analysten-Konsens"); }

  if (!peerContext) { score -= 5; warnings.push("Keine Peer-Vergleichsdaten"); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const cap = score >= 85 ? 10 : score >= 70 ? 8 : score >= 55 ? 7 : score >= 40 ? 6 : score >= 25 ? 5 : 4;

  return { completeness_score: score, missing_fields: missing, stale_fields: stale, warnings, analysis_confidence_cap: cap };
}

// --- Orchestrator ---

async function runOrchestrator(
  symbol: string,
  snapshot: AssetSnapshot,
  googleNews: NewsItemWithDesc[],
  edgarFacts: EdgarFacts | null,
  insiderTrades: InsiderTrade[],
  trends: TrendPoint[],
  institutional: InstitutionalData | null,
  analystData: AnalystData | null,
  confidenceCap: number,
  peerContext?: string,
): Promise<OrchestratorResult> {
  const client = getClient();
  let fundamental: FundamentalAnalysis | null = null;
  let sentiment: SentimentAnalysis | null = null;
  let marketIntel: MarketIntelAnalysis | null = null;
  const protocol: ProtocolEntry[] = [];

  // Load guardrails from Vera's past findings (parallel, non-blocking on failure)
  const guardrails = await fetchGuardrails(symbol).catch(() => "");

  const dataAvailability = [
    `Finanzkennzahlen: ${snapshot.price != null ? "vorhanden" : "fehlen"}`,
    `SEC EDGAR Quartalsdaten: ${edgarFacts ? `vorhanden (${edgarFacts.revenue.length} Quartale)` : "fehlen"}`,
    `Aktuelle News: ${googleNews.length > 0 ? `${googleNews.length} Artikel` : "keine"}`,
    `Insider-Transaktionen: ${insiderTrades.length > 0 ? `${insiderTrades.length} Einträge` : "keine"}`,
    `Google Trends: ${trends.length > 0 ? "vorhanden" : "fehlen"}`,
    `Institutionelle Daten: ${institutional ? "vorhanden" : "fehlen"}`,
    `Analysten-Konsens: ${analystData ? `Kursziel $${analystData.mean_target?.toFixed(2) ?? "N/A"}` : "fehlen"}`,
  ].join("\n");

  const tools: Anthropic.Messages.Tool[] = [
    {
      name: "analyze_fundamentals",
      description: "Felix (Fundamental-Analyst): Bewertet KGV, FCF, Verschuldung, Wachstum und SEC EDGAR Quartalsdaten. Kann mit spezifischem Fokus erneut aufgerufen werden.",
      input_schema: {
        type: "object" as const,
        properties: {
          focus: {
            type: "string",
            description: "Optionaler Fokus, z.B. 'Verschuldung genauer prüfen' oder 'Wachstumstrend vertiefen'",
          },
        },
      },
    },
    {
      name: "analyze_sentiment",
      description: "Nina (Sentiment-Analystin): Bewertet Nachrichtenstimmung aus aktuellen Headlines.",
      input_schema: { type: "object" as const, properties: {} },
    },
    {
      name: "analyze_market_intelligence",
      description: "Marco (Markt-Intelligence): Analysiert Insider-Transaktionen, institutionelle Positionen und Google Trends. Nur aufrufen wenn Daten laut Datenverfügbarkeit vorhanden.",
      input_schema: { type: "object" as const, properties: {} },
    },
    {
      name: "complete_analysis",
      description: "Schließt die Analyse ab. Erst aufrufen wenn mindestens Fundamental- und Sentiment-Analyse vorliegen und du mit den Ergebnissen zufrieden bist.",
      input_schema: {
        type: "object" as const,
        properties: {
          recommendation: {
            type: "string",
            enum: ["Kaufen", "Leicht kaufen", "Halten", "Leicht verkaufen", "Verkaufen"],
          },
          conviction: { type: "number", description: "Überzeugungswert 1–10" },
          summary: { type: "string", description: "2–3 prägnante Sätze" },
          bull_case: { type: "array", items: { type: "string" }, description: "3 Argumente für die Aktie" },
          bear_case: { type: "array", items: { type: "string" }, description: "2–3 Risiken" },
          growth_outlook: { type: "string" },
          entry: { type: "number", description: "Idealer Einstiegskurs (nahe MA50 oder −3% vom aktuellen Kurs bei RSI>50)" },
          target: { type: "number", description: "12-Monats-Kursziel (Analysten-Konsens bevorzugt, sonst +15–25%)" },
          stop_loss: { type: "number", description: "Stop-Loss: −8 bis −12% unter entry. Pflichtfeld — nutze −10% von entry als Fallback wenn unklar." },
          entry_rationale: { type: "string", description: "Kurze Begründung für den Einstiegskurs (z.B. 'Nahe MA50', 'Support-Level')" },
          target_rationale: { type: "string", description: "Kurze Begründung für das Kursziel (z.B. 'Analysten-Konsens', 'KGV-Expansion')" },
        },
        required: ["recommendation", "conviction", "summary", "bull_case", "bear_case", "growth_outlook"],
      },
    },
  ];

  const currentPriceLine = snapshot.price != null
    ? `AKTUELLER KURS: ${snapshot.price.toFixed(2)} ${snapshot.currency ?? "USD"} ← dieser Wert, nicht das Analysten-Kursziel`
    : `AKTUELLER KURS: N/A`;

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: `Führe eine vollständige Investmentanalyse für ${symbol} durch.

${currentPriceLine}

DATENVERFÜGBARKEIT:
${dataAvailability}

KENNZAHLEN (aktuelle Marktdaten):
${formatMetrics(snapshot)}

${analystData ? "ANALYSTEN-KONSENS (Zukunftsprognosen, kein aktueller Kurs):\n" + formatAnalystData(analystData) + "\n" : ""}
Vorgehen: Starte mit Fundamental- und Sentiment-Analyse. Rufe Markt-Intelligenz ab wenn Daten vorhanden. Bei widersprüchlichen Signalen oder unzureichenden Ergebnissen: vertiefe die relevante Analyse mit spezifischem Fokus. Schließe mit complete_analysis ab.

KURSZIELE (immer angeben): entry = idealer Einstieg (nahe MA50 oder −3% vom aktuellen Kurs), target = 12-Monats-Ziel (Analysten-Konsens bevorzugt, sonst +15–25%), stop_loss = PFLICHTFELD, immer −10% unter entry wenn keine bessere Grundlage vorhanden. entry_rationale und target_rationale sind kurze Begründungen (5–10 Wörter).`,
    },
  ];

  const systemPrompt = `Du bist Opus, der leitende Investment-Stratege. Du koordinierst dein Analyse-Team:
- Felix (analyze_fundamentals): Fundamental-Analyst, kann mit Fokus mehrfach aufgerufen werden
- Nina (analyze_sentiment): Sentiment-Analystin
- Marco (analyze_market_intelligence): Markt-Intelligence-Spezialist

Du erkennst widersprüchliche Signale, hinterfragst unzureichende Ergebnisse und entscheidest selbst welche Analysen du benötigst. Erstelle faktenbasierte, präzise Empfehlungen auf Deutsch. Beziehe dich ausschließlich auf bereitgestellte Daten.

KRITISCHE REGELN zur Datentreue:
1. Der aktuelle Kurs steht unter "AKTUELLER KURS:" und "Preis:" in den Kennzahlen — das Analysten-Kursziel ist ein Zukunftsziel, nie der aktuelle Kurs.
2. Prozentzahlen in Nachrichtentexten (z.B. "51% Rally vom Tief") beziehen sich auf historische Kursbewegungen, NICHT auf den Abstand zu MA50/MA200 — diese Werte nie als technische Indikatoren zitieren.
3. Umsatzwachstum (TTM, YoY) ist der gleitende Jahresvergleich — einzelne Quartale können abweichen; korrekte Formulierung: "Umsatz TTM −3,5% YoY".
4. entry-Preis für Kursziele muss nahe dem AKTUELLEN KURS liegen (±15%), nicht nahe dem Analysten-Kursziel.${guardrails ? "\n\n" + guardrails : ""}

DATENQUALITÄT (Diana): Maximale erlaubte Conviction für diese Analyse: ${confidenceCap}/10. Vergib keine höhere Conviction — die Datenbasis ist entsprechend bewertet.`;

  for (let i = 0; i < 10; i++) {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      system: systemPrompt,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "end_turn") break;

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) break;

    // complete_analysis → validate with Zod, run Vera, then return
    const completeCall = toolUses.find(t => t.name === "complete_analysis");
    if (completeCall) {
      let inp: CompleteAnalysisInput;
      const parseResult = CompleteAnalysisSchema.safeParse(completeCall.input);
      if (parseResult.success) {
        inp = parseResult.data;
      } else {
        // Salvage what we can from malformed input
        const raw = completeCall.input as Record<string, unknown>;
        inp = {
          recommendation: validateRecommendation(String(raw.recommendation ?? "Halten")),
          conviction: clampConviction(Number(raw.conviction ?? 5)),
          summary: String(raw.summary ?? ""),
          bull_case: Array.isArray(raw.bull_case) ? raw.bull_case.map(String) : [],
          bear_case: Array.isArray(raw.bear_case) ? raw.bear_case.map(String) : [],
          growth_outlook: String(raw.growth_outlook ?? ""),
          entry: raw.entry != null ? Number(raw.entry) : undefined,
          target: raw.target != null ? Number(raw.target) : undefined,
          stop_loss: raw.stop_loss != null ? Number(raw.stop_loss) : undefined,
          entry_rationale: String(raw.entry_rationale ?? ""),
          target_rationale: String(raw.target_rationale ?? ""),
        };
        protocol.push({ agent: "Opus", status: "warning", detail: "complete_analysis Schema-Validierung fehlgeschlagen — Fallback-Werte genutzt" });
      }

      const rawConviction = clampConviction(inp.conviction);
      const cappedConviction = Math.min(rawConviction, confidenceCap);

      const entryVal = inp.entry ?? null;
      const stopLossVal = inp.stop_loss ?? (entryVal != null ? Math.round(entryVal * 0.90 * 100) / 100 : null);

      const rawResult: SynthesisResult = {
        recommendation: inp.recommendation,
        conviction: cappedConviction,
        summary: inp.summary,
        bull_case: inp.bull_case ?? [],
        bear_case: inp.bear_case ?? [],
        growth_outlook: inp.growth_outlook,
        price_levels: (entryVal != null || inp.target != null || stopLossVal != null) ? {
          entry: entryVal, target: inp.target ?? null, stop_loss: stopLossVal,
          entry_rationale: inp.entry_rationale || "Nahe aktuellem Kursniveau",
          target_rationale: inp.target_rationale || "Basierend auf Analystenkonsens",
        } : null,
      };

      const capNote = rawConviction > confidenceCap ? ` · Conviction ${rawConviction}→${cappedConviction} (Diana-Cap)` : "";
      protocol.push({
        agent: "Opus",
        status: "ok",
        detail: `Synthese: ${rawResult.recommendation} · Conviction ${cappedConviction}/10 · Adaptive Thinking aktiv${capNote}`,
      });

      const { result: verified, entry: veraEntry, findings } = await runFactCheckAgent(symbol, rawResult, analystData, googleNews, snapshot);
      protocol.push(veraEntry);

      return {
        ...verified,
        price_levels: verified.price_levels ?? null,
        fundamental: fundamental ?? { growth_rating: 5, key_positives: [], key_risks: [], valuation_comment: "" },
        sentiment: sentiment ?? { sentiment: "neutral", key_themes: [], sentiment_summary: "" },
        market_intel: marketIntel,
        protocol,
        findings,
      };
    }

    // Process remaining tool calls and continue
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      let content: string;
      if (toolUse.name === "analyze_fundamentals") {
        const { focus } = toolUse.input as { focus?: string };
        fundamental = await runFundamentalAgent(snapshot, edgarFacts, peerContext, focus);
        content = JSON.stringify(fundamental);
        protocol.push({
          agent: "Felix",
          status: "ok",
          detail: `Wachstumsbewertung ${fundamental.growth_rating}/10 · ${fundamental.key_positives.length} Stärken, ${fundamental.key_risks.length} Risiken${peerContext ? " · Peer-Kontext vorhanden" : ""}${focus ? ` · Fokus: ${focus}` : ""}`,
        });
      } else if (toolUse.name === "analyze_sentiment") {
        sentiment = await runSentimentAgent(googleNews);
        content = JSON.stringify(sentiment);
        const withExcerpts = googleNews.filter(n => n.description).length;
        protocol.push({
          agent: "Nina",
          status: "ok",
          detail: `Sentiment: ${sentiment.sentiment} · ${sentiment.key_themes.length} Themen · ${withExcerpts}/${googleNews.length} Artikel mit Jina-Excerpt`,
        });
      } else if (toolUse.name === "analyze_market_intelligence") {
        marketIntel = await runMarketIntelAgent(insiderTrades, trends, institutional);
        content = JSON.stringify(marketIntel);
        const noData = marketIntel.key_observations[0] === "Keine Markt-Intelligenz-Daten verfügbar";
        protocol.push({
          agent: "Marco",
          status: noData ? "skipped" : "ok",
          detail: noData ? "Keine Daten verfügbar (nur für US-Aktien)" : `Insider: ${marketIntel.insider_signal} · Institutionen: ${marketIntel.institutional_trend} · Trends: ${marketIntel.trends_momentum}`,
        });
      } else {
        content = JSON.stringify({ error: "Unbekanntes Tool" });
      }
      toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Fallback: Orchestrator hat nicht sauber abgeschlossen → direkte Pipeline
  const [fb_f, fb_s, fb_m] = await Promise.all([
    fundamental ?? runFundamentalAgent(snapshot, edgarFacts, peerContext),
    sentiment ?? runSentimentAgent(googleNews),
    marketIntel ?? runMarketIntelAgent(insiderTrades, trends, institutional),
  ]);
  if (!fundamental) protocol.push({ agent: "Felix", status: "ok", detail: `Wachstumsbewertung ${fb_f.growth_rating}/10 (Fallback)` });
  if (!sentiment) protocol.push({ agent: "Nina", status: "ok", detail: `Sentiment: ${fb_s.sentiment} (Fallback)` });
  if (!marketIntel) {
    const noData = fb_m.key_observations[0] === "Keine Markt-Intelligenz-Daten verfügbar";
    protocol.push({ agent: "Marco", status: noData ? "skipped" : "ok", detail: noData ? "Keine Daten verfügbar" : `Insider: ${fb_m.insider_signal} (Fallback)` });
  }
  const rawSynthesisFb = await runSynthesisAgent(symbol, snapshot, fb_f, fb_s, fb_m, analystData);
  const cappedFb = { ...rawSynthesisFb, conviction: Math.min(rawSynthesisFb.conviction, confidenceCap) };
  const capNoteFb = rawSynthesisFb.conviction > confidenceCap ? ` · Conviction ${rawSynthesisFb.conviction}→${cappedFb.conviction} (Diana-Cap)` : "";
  protocol.push({ agent: "Opus", status: "ok", detail: `Synthese (Fallback): ${cappedFb.recommendation} · Conviction ${cappedFb.conviction}/10${capNoteFb}` });
  const rawSynthesis = cappedFb;
  const { result: synthesis, entry: veraEntry, findings } = await runFactCheckAgent(symbol, rawSynthesis, analystData, googleNews, snapshot);
  protocol.push(veraEntry);
  return { ...synthesis, price_levels: synthesis.price_levels ?? null, fundamental: fb_f, sentiment: fb_s, market_intel: fb_m, protocol, findings };
}

// --- Cache & Persistence ---

// ─── Optimierte Pipeline (ersetzt runOrchestrator) ───────────────────────────

async function runAnalysisPipeline(
  symbol: string,
  snapshot: AssetSnapshot,
  googleNews: NewsItemWithDesc[],
  edgarFacts: EdgarFacts | null,
  insiderTrades: InsiderTrade[],
  trends: TrendPoint[],
  institutional: InstitutionalData | null,
  analystData: AnalystData | null,
  confidenceCap: number,
  peerContext: string,
  serviceClient: SbClient,
  onSynthesisStart?: () => Promise<void>,
  onVeraStart?: () => Promise<void>,
): Promise<OrchestratorResult> {
  const protocol: ProtocolEntry[] = [];
  const guardrails = await fetchGuardrails(symbol, serviceClient).catch(() => "");

  // Felix + Nina + Marco parallel (alle Haiku — schnell)
  const [fundamental, sentiment, marketIntel] = await Promise.all([
    runFundamentalAgent(snapshot, edgarFacts, peerContext),
    runSentimentAgent(googleNews),
    runMarketIntelAgent(insiderTrades, trends, institutional),
  ]);

  const withExcerpts = googleNews.filter(n => n.description).length;
  const noMarcoData = marketIntel.key_observations[0] === "Keine Markt-Intelligenz-Daten verfügbar";

  protocol.push({ agent: "Felix", status: "ok", detail: `Wachstumsbewertung ${fundamental.growth_rating}/10 · ${fundamental.key_positives.length} Stärken, ${fundamental.key_risks.length} Risiken${peerContext ? " · Peer-Kontext vorhanden" : ""}` });
  protocol.push({ agent: "Nina", status: "ok", detail: `Sentiment: ${sentiment.sentiment} · ${sentiment.key_themes.length} Themen · ${withExcerpts}/${googleNews.length} Artikel mit Jina-Excerpt` });
  protocol.push({ agent: "Marco", status: noMarcoData ? "skipped" : "ok", detail: noMarcoData ? "Keine Daten verfügbar (nur für US-Aktien)" : `Insider: ${marketIntel.insider_signal} · Institutionen: ${marketIntel.institutional_trend} · Trends: ${marketIntel.trends_momentum}` });

  // Synthese (Sonnet — deutlich schneller als Opus mit Adaptive Thinking)
  if (onSynthesisStart) await onSynthesisStart().catch(() => {});
  const rawSynthesis = await runSynthesisAgent(symbol, snapshot, fundamental, sentiment, marketIntel, analystData);
  const rawConviction = clampConviction(rawSynthesis.conviction);
  const cappedConviction = Math.min(rawConviction, confidenceCap);
  const capNote = rawConviction > confidenceCap ? ` · Conviction ${rawConviction}→${cappedConviction} (Diana-Cap)` : "";
  protocol.push({ agent: "Opus", status: "ok", detail: `Synthese: ${rawSynthesis.recommendation} · Conviction ${cappedConviction}/10${capNote}${guardrails ? " · Guardrails aktiv" : ""}` });

  const cappedSynthesis = { ...rawSynthesis, conviction: cappedConviction };

  // Vera — ein schneller Sonnet-Call ohne article-fetch (Excerpts aus Schritt 2 reichen)
  if (onVeraStart) await onVeraStart().catch(() => {});
  const { result: verified, entry: veraEntry, findings } = await runFactCheckAgent(
    symbol, cappedSynthesis, analystData, googleNews, snapshot,
    true, // skipArticleFetch: Background-Job-Modus, kein Jina
  );
  protocol.push(veraEntry);

  return {
    ...verified,
    conviction: Math.min(verified.conviction, confidenceCap),
    price_levels: verified.price_levels ?? null,
    fundamental,
    sentiment,
    market_intel: marketIntel,
    protocol,
    findings,
  };
}

// ─── Background Job ───────────────────────────────────────────────────────────

async function runAnalysisJob(
  jobId: string,
  symbol: string,
  userId: string,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<void> {
  const ts = () => new Date().toISOString();

  const updateStep = async (step: string, progress: number) => {
    await serviceClient.from("analysis_jobs").update({
      status: "running",
      current_step: step,
      progress,
      updated_at: ts(),
    }).eq("id", jobId).eq("user_id", userId);
  };

  try {
    await updateStep("fetch_data", 10);

    const [assetData, googleNews, edgarFacts, insiderTrades, trends, institutional, analystData] =
      await Promise.all([
        fetchAssetData(symbol),
        fetchGoogleNews(symbol).catch(() => [] as GoogleNewsItem[]),
        fetchEdgarFacts(symbol).catch(() => null),
        fetchInsiderTrades(symbol).catch(() => [] as InsiderTrade[]),
        fetchTrends(symbol).catch(() => [] as TrendPoint[]),
        fetchInstitutional(symbol).catch(() => null),
        fetchAnalystData(symbol).catch(() => null as AnalystData | null),
      ]);

    const snapshot: AssetSnapshot = {
      id: "",
      symbol: assetData.symbol,
      price: assetData.price,
      currency: assetData.currency,
      isin: assetData.isin ?? null,
      description: assetData.description ?? null,
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

    await updateStep("enrich_news", 20);

    const googleNewsLimited = googleNews.slice(0, ENRICH_MAX_ARTICLES);
    const googleNewsEnriched = await Promise.race([
      enrichWithDescriptions(googleNewsLimited),
      new Promise<typeof googleNewsLimited>(resolve =>
        setTimeout(() => resolve(googleNewsLimited), ENRICH_TIMEOUT_MS),
      ),
    ]).catch(() => googleNewsLimited);

    const peerContext = await fetchPeerContext(symbol, serviceClient).catch(() => "");

    await updateStep("diana_check", 30);

    const diana = runDianaCheck(snapshot, googleNewsEnriched, edgarFacts, analystData, peerContext);
    const dianaEntry: ProtocolEntry = {
      agent: "Diana",
      status: diana.completeness_score >= 70 ? "ok" : "warning",
      detail: [
        `Datenbasis ${diana.completeness_score}/100`,
        `Cap ${diana.analysis_confidence_cap}/10`,
        ...(diana.missing_fields.length ? [`Fehlend: ${diana.missing_fields.slice(0, 4).join(", ")}`] : []),
        ...(diana.stale_fields.length ? [`Veraltet: ${diana.stale_fields.join(", ")}`] : []),
        ...(diana.warnings.length ? diana.warnings.slice(0, 2) : []),
      ].join(" · "),
    };

    await updateStep("run_agents", 45);

    const orchestrated = await runAnalysisPipeline(
      symbol, snapshot, googleNewsEnriched, edgarFacts, insiderTrades, trends, institutional, analystData,
      diana.analysis_confidence_cap, peerContext, serviceClient,
      () => updateStep("run_synthesis", 65),
      () => updateStep("run_vera", 80),
    );

    await updateStep("save_result", 95);

    const result: AIAnalysisResult = {
      symbol,
      recommendation: orchestrated.recommendation,
      conviction: orchestrated.conviction,
      summary: orchestrated.summary,
      bull_case: orchestrated.bull_case,
      bear_case: orchestrated.bear_case,
      growth_outlook: orchestrated.growth_outlook,
      fundamental: orchestrated.fundamental,
      sentiment: orchestrated.sentiment,
      market_intel: orchestrated.market_intel,
      price_levels: orchestrated.price_levels,
      data_quality: diana,
      protocol: [dianaEntry, ...orchestrated.protocol],
      analyzed_at: new Date().toISOString(),
      from_cache: false,
    };

    const analysisId = await saveAnalysis(result, serviceClient);
    if (analysisId && orchestrated.findings.length) {
      void saveFactCheckFindings(analysisId, symbol, orchestrated.findings, serviceClient);
    }
    void saveOutcome(result, serviceClient);

    await serviceClient.from("analysis_jobs").update({
      status: "completed",
      current_step: "completed",
      progress: 100,
      result: result as unknown as import("@/types/database").Json,
      updated_at: ts(),
    }).eq("id", jobId).eq("user_id", userId);

  } catch (err) {
    await serviceClient.from("analysis_jobs").update({
      status: "failed",
      error: err instanceof Error ? err.message : "Unbekannter Fehler",
      updated_at: ts(),
    }).eq("id", jobId).eq("user_id", userId);
  }
}

// ─── Cache & Persistence ──────────────────────────────────────────────────────

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
      price_levels: (data.extra_data as Record<string, unknown>)?.price_levels as PriceLevels | null ?? null,
      data_quality: (data.extra_data as Record<string, unknown>)?.data_quality as DianaQualityReport | null ?? null,
      protocol: (data.extra_data as Record<string, unknown>)?.protocol as ProtocolEntry[] ?? [],
      analyzed_at: data.analyzed_at,
      from_cache: true,
    };
  } catch {
    return null;
  }
}

async function saveOutcome(result: AIAnalysisResult, client?: SbClient): Promise<void> {
  try {
    const supabase = client ?? await createClient();
    const checkAt = new Date(result.analyzed_at);
    checkAt.setDate(checkAt.getDate() + 30);

    await supabase.from("analysis_outcomes").insert({
      symbol: result.symbol,
      recommendation: result.recommendation,
      conviction: result.conviction,
      price_at_analysis: result.price_levels?.entry ?? null,
      price_target: result.price_levels?.target ?? null,
      stop_loss: result.price_levels?.stop_loss ?? null,
      analyzed_at: result.analyzed_at,
      check_at: checkAt.toISOString(),
    });
  } catch {
    // Non-critical
  }
}

async function saveAnalysis(result: AIAnalysisResult, client?: SbClient): Promise<string | null> {
  if (!validateBeforeSave(result)) return null;
  try {
    const supabase = client ?? await createClient();
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
      extra_data: ({
        ...(result.market_intel ? { market_intel: result.market_intel } : {}),
        ...(result.price_levels ? { price_levels: result.price_levels } : {}),
        ...(result.data_quality ? { data_quality: result.data_quality } : {}),
        protocol: result.protocol,
      }) as unknown as import("@/types/database").Json,
    };
    const { data } = await supabase.from("ai_analyses").insert(payload).select("id").single();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

// --- Route handler ---

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const { symbol: rawSymbol } = await params;
  const parsed = tickerSchema.safeParse(rawSymbol);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Ticker-Symbol" }, { status: 400 });
  }

  const cached = await getCached(parsed.data);
  if (cached) return NextResponse.json(cached);
  return NextResponse.json({ status: "analyzing" });
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
  const { user, supabase } = auth;

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

  // Job anlegen
  const { data: job, error: jobErr } = await supabase
    .from("analysis_jobs")
    .insert({ user_id: user.id, symbol, status: "queued", current_step: "queued", progress: 0 })
    .select("id")
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: "Job konnte nicht erstellt werden" }, { status: 500 });
  }

  const serviceClient = createServiceClient();

  // Analyse läuft asynchron nach dem Response — kein Timeout-Risiko mehr
  after(async () => {
    await runAnalysisJob(job.id, symbol, user.id, serviceClient);
  });

  return NextResponse.json({ status: "queued", job_id: job.id, symbol });
}
