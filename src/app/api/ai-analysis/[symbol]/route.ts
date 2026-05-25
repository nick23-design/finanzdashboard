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
import { rateLimit } from "@/lib/rate-limit";
import { PEER_MAP } from "@/lib/peer-map";
import { enrichWithDescriptions } from "@/lib/article-fetch";
import type { AssetSnapshot, Database } from "@/types/database";

type AIAnalysisInsert = Database["public"]["Tables"]["ai_analyses"]["Insert"];

const CACHE_TTL_HOURS = 6;

async function fetchPeerContext(symbol: string): Promise<string> {
  const peers = PEER_MAP[symbol];
  if (!peers?.length) return "";

  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("asset_snapshots")
    .select("symbol, pe_ratio, revenue_growth, debt_to_equity, market_cap")
    .in("symbol", peers)
    .gte("fetched_at", cutoff)
    .order("fetched_at", { ascending: false });

  if (!data || data.length === 0) return "";

  // Deduplicate to latest per symbol
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

interface FactCheckResult {
  corrections: string[];
  verified_claims: string[];
  confidence_adjustment: number;
  corrected_summary?: string;
  corrected_bull_case?: string[];
  corrected_bear_case?: string[];
}

export interface ProtocolEntry {
  agent: string;
  status: "ok" | "warning" | "skipped";
  detail: string;
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
  analyzed_at: string;
  from_cache: boolean;
  protocol: ProtocolEntry[];
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

async function runFundamentalAgent(s: AssetSnapshot, edgar: EdgarFacts | null, peerContext?: string, focus?: string): Promise<FundamentalAnalysis> {
  const client = getClient();
  const edgarSection = formatEdgarTrend(edgar);
  const peerSection = peerContext ? `\n\nBRANCHEN-VERGLEICH:\n${peerContext}\nBewerte KGV, Wachstum und Verschuldung relativ zu diesen Peer-Werten.` : "";
  const focusNote = focus ? `\n\nBesonderer Fokus für diesen Durchlauf: ${focus}` : "";
  const prompt = `Bewerte diese Aktie für einen wachstumsorientierten Investor:\n\n${formatMetrics(s)}${edgarSection ? "\n\n" + edgarSection : ""}${peerSection}${focusNote}\n\nJSON-Format:\n{"growth_rating":<1-10>,"key_positives":["..."],"key_risks":["..."],"valuation_comment":"..."}`;

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
    system:
      "Du bist ein Finanz-Nachrichtenanalyst. Artikel von Quellen mit [★] sind besonders zuverlässig und sollen stärker gewichtet werden. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach.",
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

  const context = `AKTIE: ${symbol}
KENNZAHLEN:
${formatMetrics(s)}
${analystSection ? "\nANALYSTEN-KONSENS:\n" + analystSection : ""}
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
      "Du bist ein erfahrener Investment-Analyst spezialisiert auf Wachstumsaktien. Erstelle eine präzise, faktenbasierte Investmentempfehlung auf Deutsch. WICHTIG: Beziehe dich ausschließlich auf die bereitgestellten Daten. Erwähne keine Firmennamen, Deals, Produkte oder Ereignisse, die nicht explizit in den Daten enthalten sind. Berechne konkrete Kursziele (price_levels): entry als idealen Einstieg (nahe MA50 oder -3% bei RSI>50), target als Kursziel (Analysten-Konsens bevorzugt, sonst +15-25%), stop_loss als -8-12% unter entry. Nutze null wenn Datenlage unklar. Antworte ausschließlich mit validem JSON, ohne Text davor oder danach.",
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
): Promise<{ result: SynthesisResult; entry: ProtocolEntry }> {
  const client = getClient();

  const newsSection = googleNews.slice(0, 10).map(n => {
    const excerpt = n.description ? `\n   Excerpt: ${n.description}` : "";
    return `- ${n.title} (${n.source})${excerpt}`;
  }).join("\n") || "Keine Schlagzeilen verfügbar";

  const analystSection = formatAnalystData(analystData) || "Keine Analysten-Daten verfügbar";

  const draftText = `Empfehlung: ${synthesis.recommendation} (Überzeugung: ${synthesis.conviction}/10)
Zusammenfassung: ${synthesis.summary}
Bull-Case: ${synthesis.bull_case.join(" | ")}
Bear-Case: ${synthesis.bear_case.join(" | ")}
Wachstumsausblick: ${synthesis.growth_outlook}`;

  const prompt = `Du prüfst eine KI-generierte Aktienanalyse für ${symbol} auf Faktengenauigkeit.

VERFÜGBARE FAKTEN:
${analystSection}

AKTUELLE NACHRICHTEN (mit Artikel-Auszügen):
${newsSection}

ZU PRÜFENDE ANALYSE:
${draftText}

Prüfe ob Aussagen in der Analyse durch die obigen Fakten und Artikel-Auszüge belegbar sind. Korrigiere NUR nachweisliche Fehler (erfundene Deals, falsche Zahlen, nicht belegte Ereignisse). Wenn Bull-Case oder Bear-Case unbelegte Behauptungen enthalten, liefere korrigierte Versionen.

JSON-Format:
{"corrections":["konkrete Korrektur, oder leeres Array"],"verified_claims":["verifizierte Aussagen"],"confidence_adjustment":<-3 bis 0>,"corrected_summary":"(nur wenn Summary falsche Fakten enthält, sonst null)","corrected_bull_case":["(nur bei unbelegten Punkten ersetzen, belegte Punkte unverändert übernehmen)"],"corrected_bear_case":["(analog)"]}`;

  const fallbackEntry: ProtocolEntry = { agent: "Vera", status: "skipped", detail: "Fact-Check nicht verfügbar" };

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: "Du bist ein kritischer Fact-Checker für Finanzanalysen. Korrigiere nur was durch die gelieferten Daten nachweislich falsch ist. Antworte ausschließlich mit validem JSON.",
      messages: [{ role: "user", content: prompt }],
    });

    const factCheck = parseJSON<FactCheckResult>(extractText(response.content));
    const corrections = (factCheck.corrections ?? []).filter(c => c.length > 0);
    const convictionNew = Math.max(1, Math.min(10,
      synthesis.conviction + (factCheck.confidence_adjustment ?? 0)
    ));

    const result: SynthesisResult = {
      ...synthesis,
      conviction: convictionNew,
      summary: factCheck.corrected_summary ?? synthesis.summary,
      bull_case: factCheck.corrected_bull_case ?? synthesis.bull_case,
      bear_case: factCheck.corrected_bear_case ?? synthesis.bear_case,
    };

    const entry: ProtocolEntry = corrections.length > 0
      ? {
          agent: "Vera",
          status: "warning",
          detail: `${corrections.length} Korrektur${corrections.length > 1 ? "en" : ""}: ${corrections.join(" · ")}${factCheck.confidence_adjustment ? ` · Conviction ${synthesis.conviction}→${convictionNew}` : ""}`,
        }
      : {
          agent: "Vera",
          status: "ok",
          detail: `${(factCheck.verified_claims ?? []).length} Aussagen verifiziert — keine Korrekturen nötig`,
        };

    return { result, entry };
  } catch {
    return { result: synthesis, entry: fallbackEntry };
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
}

async function runOrchestrator(
  symbol: string,
  snapshot: AssetSnapshot,
  googleNews: NewsItemWithDesc[],
  edgarFacts: EdgarFacts | null,
  insiderTrades: InsiderTrade[],
  trends: TrendPoint[],
  institutional: InstitutionalData | null,
  analystData: AnalystData | null,
  peerContext?: string,
): Promise<OrchestratorResult> {
  const client = getClient();
  let fundamental: FundamentalAnalysis | null = null;
  let sentiment: SentimentAnalysis | null = null;
  let marketIntel: MarketIntelAnalysis | null = null;
  const protocol: ProtocolEntry[] = [];

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
          entry: { type: "number", description: "Idealer Einstiegskurs" },
          target: { type: "number", description: "12-Monats-Kursziel" },
          stop_loss: { type: "number", description: "Stop-Loss-Marke" },
          entry_rationale: { type: "string" },
          target_rationale: { type: "string" },
        },
        required: ["recommendation", "conviction", "summary", "bull_case", "bear_case", "growth_outlook"],
      },
    },
  ];

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: `Führe eine vollständige Investmentanalyse für ${symbol} durch.

DATENVERFÜGBARKEIT:
${dataAvailability}

KENNZAHLEN:
${formatMetrics(snapshot)}${analystData ? "\n\n" + formatAnalystData(analystData) : ""}

Vorgehen: Starte mit Fundamental- und Sentiment-Analyse. Rufe Markt-Intelligenz ab wenn Daten vorhanden. Bei widersprüchlichen Signalen oder unzureichenden Ergebnissen: vertiefe die relevante Analyse mit spezifischem Fokus. Schließe mit complete_analysis ab.`,
    },
  ];

  for (let i = 0; i < 10; i++) {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      system: `Du bist Opus, der leitende Investment-Stratege. Du koordinierst dein Analyse-Team:
- Felix (analyze_fundamentals): Fundamental-Analyst, kann mit Fokus mehrfach aufgerufen werden
- Nina (analyze_sentiment): Sentiment-Analystin
- Marco (analyze_market_intelligence): Markt-Intelligence-Spezialist

Du erkennst widersprüchliche Signale, hinterfragst unzureichende Ergebnisse und entscheidest selbst welche Analysen du benötigst. Erstelle faktenbasierte, präzise Empfehlungen auf Deutsch. Beziehe dich ausschließlich auf bereitgestellte Daten.`,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "end_turn") break;

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) break;

    // complete_analysis → run Vera, then return
    const completeCall = toolUses.find(t => t.name === "complete_analysis");
    if (completeCall) {
      const inp = completeCall.input as {
        recommendation: string; conviction: number; summary: string;
        bull_case: string[]; bear_case: string[]; growth_outlook: string;
        entry?: number | null; target?: number | null; stop_loss?: number | null;
        entry_rationale?: string; target_rationale?: string;
      };

      const rawResult: SynthesisResult = {
        recommendation: inp.recommendation,
        conviction: Math.min(10, Math.max(1, Math.round(inp.conviction))),
        summary: inp.summary,
        bull_case: inp.bull_case ?? [],
        bear_case: inp.bear_case ?? [],
        growth_outlook: inp.growth_outlook,
        price_levels: (inp.entry != null || inp.target != null || inp.stop_loss != null) ? {
          entry: inp.entry ?? null, target: inp.target ?? null, stop_loss: inp.stop_loss ?? null,
          entry_rationale: inp.entry_rationale ?? "", target_rationale: inp.target_rationale ?? "",
        } : null,
      };

      protocol.push({
        agent: "Opus",
        status: "ok",
        detail: `Synthese: ${rawResult.recommendation} · Conviction ${rawResult.conviction}/10 · Adaptive Thinking aktiv`,
      });

      const { result: verified, entry: veraEntry } = await runFactCheckAgent(symbol, rawResult, analystData, googleNews);
      protocol.push(veraEntry);

      return {
        ...verified,
        price_levels: verified.price_levels ?? null,
        fundamental: fundamental ?? { growth_rating: 5, key_positives: [], key_risks: [], valuation_comment: "" },
        sentiment: sentiment ?? { sentiment: "neutral", key_themes: [], sentiment_summary: "" },
        market_intel: marketIntel,
        protocol,
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

  // Fallback: Orchestrator hat nicht sauber abgeschlossen → alte Pipeline
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
  const rawSynthesis = await runSynthesisAgent(symbol, snapshot, fb_f, fb_s, fb_m, analystData);
  protocol.push({ agent: "Opus", status: "ok", detail: `Synthese (Fallback): ${rawSynthesis.recommendation} · Conviction ${rawSynthesis.conviction}/10` });
  const { result: synthesis, entry: veraEntry } = await runFactCheckAgent(symbol, rawSynthesis, analystData, googleNews);
  protocol.push(veraEntry);
  return { ...synthesis, price_levels: synthesis.price_levels ?? null, fundamental: fb_f, sentiment: fb_s, market_intel: fb_m, protocol };
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
      price_levels: (data.extra_data as Record<string, unknown>)?.price_levels as PriceLevels | null ?? null,
      protocol: (data.extra_data as Record<string, unknown>)?.protocol as ProtocolEntry[] ?? [],
      analyzed_at: data.analyzed_at,
      from_cache: true,
    };
  } catch {
    return null;
  }
}

async function saveOutcome(result: AIAnalysisResult): Promise<void> {
  try {
    const supabase = await createClient();
    const checkAt = new Date(result.analyzed_at);
    checkAt.setDate(checkAt.getDate() + 30);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("analysis_outcomes").insert({
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
      extra_data: ({
        ...(result.market_intel ? { market_intel: result.market_intel } : {}),
        ...(result.price_levels ? { price_levels: result.price_levels } : {}),
        protocol: result.protocol,
      }) as unknown as import("@/types/database").Json,
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

    // Enrich news with article descriptions for Nina's deeper sentiment analysis
    const googleNewsEnriched = await enrichWithDescriptions(googleNews).catch(() => googleNews);

    const peerContext = await fetchPeerContext(symbol).catch(() => "");
    const orchestrated = await runOrchestrator(
      symbol, snapshot, googleNewsEnriched, edgarFacts, insiderTrades, trends, institutional, analystData, peerContext,
    );

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
      protocol: orchestrated.protocol,
      analyzed_at: new Date().toISOString(),
      from_cache: false,
    };

    await saveAnalysis(result);
    void saveOutcome(result);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json(
      { error: `KI-Analyse fehlgeschlagen: ${message}` },
      { status: 503 },
    );
  }
}
