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

import { NextRequest, NextResponse } from "next/server";
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
import type { AssetSnapshot, Database, Json } from "@/types/database";

export const maxDuration = 10;

const ENRICH_MAX_ARTICLES = 6;
const ENRICH_TIMEOUT_MS = 8_000;
const VERA_MAX_TURNS = 3;
const DEFERRED_VERA_TIMEOUT_MS = 25_000;
const VERA_FAST_NEWS_LIMIT = 5;
const VERA_FULL_NEWS_LIMIT = 10;
const EUR_USD_FALLBACK = 1.08;
// Opus ist die qualitative Hauptsynthese. Keine SDK-Retries: Ein sauberer
// Versuch, danach Haiku-Fallback statt versteckter 3x-Timeouts.
const SYNTHESIS_OPUS_MODEL = "claude-opus-4-7";
const SYNTHESIS_OPUS_TIMEOUT_MS = 90_000;

type AIAnalysisInsert = Database["public"]["Tables"]["ai_analyses"]["Insert"];

const CACHE_TTL_HOURS = 6;

// --- Validation constants ---

const ALLOWED_RECOMMENDATIONS = [
  "Kaufen", "Leicht kaufen", "Halten", "Leicht verkaufen", "Verkaufen",
] as const;
type AllowedRecommendation = typeof ALLOWED_RECOMMENDATIONS[number];

const THESIS_TYPES = [
  "Quality Compounder", "Story Growth", "Turnaround", "Cyclical", "Momentum", "Speculative",
] as const;

const ENTRY_QUALITY_LABELS = [
  "attraktiv", "fair", "überhitzt", "Rücksetzer abwarten", "nicht hinterherrennen", "nur spekulativ",
] as const;

const VALUATION_CONFIDENCE = ["high", "medium", "low"] as const;

const ClaimSchema = z.object({
  claim: z.string().min(1),
  evidence: z.string().min(1),
  source_type: z.enum(["metrics", "news", "analyst", "market_intel", "inference"]),
  confidence: z.number().min(1).max(10),
});

const PriceLevelsSchema = z.object({
  entry: z.number().nullable().optional(),
  target: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  entry_rationale: z.string().optional(),
  target_rationale: z.string().optional(),
}).nullable().optional();

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
  thesis_type: z.enum(THESIS_TYPES).optional(),
  time_horizon_view: z.object({
    short_term: z.string().min(1),
    medium_term: z.string().min(1),
    long_term: z.string().min(1),
  }).optional(),
  entry_quality: z.object({
    label: z.enum(ENTRY_QUALITY_LABELS),
    rationale: z.string().min(1),
  }).optional(),
  valuation_confidence: z.enum(VALUATION_CONFIDENCE).optional(),
  valuation_range: z.object({
    currency: z.string().length(3).optional(),
    bear: z.number().nullable(),
    base: z.number().nullable(),
    bull: z.number().nullable(),
    rationale: z.string().min(1),
  }).nullable().optional(),
  data_quality_guardrails: z.array(z.string()).optional(),
  claims: z.array(ClaimSchema).max(6).optional(),
});
type CompleteAnalysisInput = z.infer<typeof CompleteAnalysisSchema>;

const SynthesisOutputSchema = CompleteAnalysisSchema.extend({
  price_levels: PriceLevelsSchema,
});

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

export type ThesisType = typeof THESIS_TYPES[number];
export type EntryQualityLabel = typeof ENTRY_QUALITY_LABELS[number];
export type ValuationConfidence = typeof VALUATION_CONFIDENCE[number];

export interface TimeHorizonView {
  short_term: string;
  medium_term: string;
  long_term: string;
}

export interface EntryQuality {
  label: EntryQualityLabel;
  rationale: string;
}

export interface MoneyRange {
  bear: number | null;
  base: number | null;
  bull: number | null;
}

export interface ValuationRange extends MoneyRange {
  currency: string;
  rationale: string;
  usd?: MoneyRange | null;
  eur?: MoneyRange | null;
  fx_rate_eur_usd?: number | null;
  fx_rate_source?: "finance_api" | "fallback" | null;
  fx_rate_as_of?: string | null;
}

export interface AnalysisClaim {
  claim: string;
  evidence: string;
  source_type: "metrics" | "news" | "analyst" | "market_intel" | "inference";
  confidence: number;
}

interface SynthesisResult {
  recommendation: string;
  conviction: number;
  summary: string;
  bull_case: string[];
  bear_case: string[];
  growth_outlook: string;
  price_levels?: PriceLevels | null;
  thesis_type?: ThesisType | null;
  time_horizon_view?: TimeHorizonView | null;
  entry_quality?: EntryQuality | null;
  valuation_confidence?: ValuationConfidence | null;
  valuation_range?: ValuationRange | null;
  data_quality_guardrails?: string[];
  claims?: AnalysisClaim[];
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

export interface AnalysisTraceEntry {
  step: string;
  label: string;
  status: "running" | "ok" | "warning" | "error" | "timeout";
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  detail?: string;
  error?: string;
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
  thesis_type?: ThesisType | null;
  time_horizon_view?: TimeHorizonView | null;
  entry_quality?: EntryQuality | null;
  valuation_confidence?: ValuationConfidence | null;
  valuation_range?: ValuationRange | null;
  data_quality_guardrails?: string[];
  claims?: AnalysisClaim[];
  data_quality: DianaQualityReport | null;
  analyzed_at: string;
  from_cache: boolean;
  protocol: ProtocolEntry[];
  trace?: AnalysisTraceEntry[];
}

interface OrchestratorResult {
  recommendation: string;
  conviction: number;
  summary: string;
  bull_case: string[];
  bear_case: string[];
  growth_outlook: string;
  price_levels: PriceLevels | null;
  thesis_type?: ThesisType | null;
  time_horizon_view?: TimeHorizonView | null;
  entry_quality?: EntryQuality | null;
  valuation_confidence?: ValuationConfidence | null;
  valuation_range?: ValuationRange | null;
  data_quality_guardrails?: string[];
  claims?: AnalysisClaim[];
  fundamental: FundamentalAnalysis;
  sentiment: SentimentAnalysis;
  market_intel: MarketIntelAnalysis | null;
  protocol: ProtocolEntry[];
  findings: StructuredFinding[];
}

// --- Helpers ---

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 55_000 });
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
  return !!(r.symbol?.trim() && r.summary?.trim() && r.recommendation?.trim())
    && getSynthesisQualityIssues(r).filter(issue => issue.severity === "blocker").length === 0;
}

function cloneTrace(trace: AnalysisTraceEntry[]): AnalysisTraceEntry[] {
  return trace.map(entry => ({ ...entry }));
}

function tracePayload(trace: AnalysisTraceEntry[]): Json {
  return { trace: cloneTrace(trace) } as unknown as Json;
}

function normalizeSynthesisFromUnknown(raw: unknown, fallbackCurrency: string): SynthesisResult {
  const parsed = SynthesisOutputSchema.parse(raw);
  const priceLevelSource = parsed.price_levels ?? (
    parsed.entry != null || parsed.target != null || parsed.stop_loss != null
      ? {
          entry: parsed.entry,
          target: parsed.target,
          stop_loss: parsed.stop_loss,
          entry_rationale: parsed.entry_rationale,
          target_rationale: parsed.target_rationale,
        }
      : null
  );
  const priceLevels: PriceLevels | null = priceLevelSource
    ? {
        entry: priceLevelSource.entry ?? null,
        target: priceLevelSource.target ?? null,
        stop_loss: priceLevelSource.stop_loss ?? null,
        entry_rationale: priceLevelSource.entry_rationale ?? "",
        target_rationale: priceLevelSource.target_rationale ?? "",
      }
    : null;
  const valuationRange = parsed.valuation_range
    ? {
        currency: normalizeCurrency(parsed.valuation_range.currency ?? fallbackCurrency),
        bear: parsed.valuation_range.bear,
        base: parsed.valuation_range.base,
        bull: parsed.valuation_range.bull,
        rationale: parsed.valuation_range.rationale,
      }
    : parsed.valuation_range;

  return {
    recommendation: parsed.recommendation,
    conviction: parsed.conviction,
    summary: parsed.summary,
    bull_case: parsed.bull_case,
    bear_case: parsed.bear_case,
    growth_outlook: parsed.growth_outlook,
    price_levels: priceLevels,
    thesis_type: parsed.thesis_type ?? null,
    time_horizon_view: parsed.time_horizon_view ?? null,
    entry_quality: parsed.entry_quality ?? null,
    valuation_confidence: parsed.valuation_confidence ?? null,
    valuation_range: valuationRange ?? null,
    data_quality_guardrails: parsed.data_quality_guardrails ?? [],
    claims: parsed.claims ?? [],
  };
}

function parseSynthesisFromText(rawText: string, fallbackCurrency: string): SynthesisResult {
  return normalizeSynthesisFromUnknown(parseJSON<unknown>(rawText), fallbackCurrency);
}

function getSynthesisQualityIssues(result: Pick<SynthesisResult, "summary" | "bull_case" | "bear_case" | "growth_outlook">): { severity: "blocker" | "warning"; message: string }[] {
  const issues: { severity: "blocker" | "warning"; message: string }[] = [];
  const summary = String(result.summary ?? "").trim();
  const growth = String(result.growth_outlook ?? "").trim();
  const combined = `${summary} ${growth}`.toLowerCase();
  const failureMarkers = [
    "analyse konnte nicht erstellt",
    "analyse konnte nicht vollständig erstellt",
    "konnte nicht verarbeitet",
    "keine ausreichenden timing-daten",
  ];

  if (failureMarkers.some(marker => combined.includes(marker))) {
    issues.push({ severity: "blocker", message: "Synthese enthält generische Fallback-Texte." });
  }
  if (growth.toLowerCase() === "nicht verfügbar") {
    issues.push({ severity: "blocker", message: "Wachstumsausblick fehlt." });
  }
  if (summary.length < 80) {
    issues.push({ severity: "blocker", message: "Zusammenfassung ist zu dünn für eine belastbare Analyse." });
  }
  if (!Array.isArray(result.bull_case) || result.bull_case.filter(Boolean).length < 2) {
    issues.push({ severity: "blocker", message: "Bull-Case enthält zu wenige substanzielle Punkte." });
  }
  if (!Array.isArray(result.bear_case) || result.bear_case.filter(Boolean).length < 2) {
    issues.push({ severity: "blocker", message: "Bear-Case enthält zu wenige substanzielle Punkte." });
  }
  if (growth.length < 60) {
    issues.push({ severity: "warning", message: "Wachstumsausblick ist knapp." });
  }

  return issues;
}

function assertSynthesisQuality(result: SynthesisResult, source: string): void {
  const blockers = getSynthesisQualityIssues(result).filter(issue => issue.severity === "blocker");
  if (blockers.length) {
    throw new Error(`${source} quality gate failed: ${blockers.map(i => i.message).join(" ")}`);
  }
}

function roundMoney(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
}

function normalizeCurrency(currency: string | null | undefined): string {
  return (currency || "USD").toUpperCase();
}

function convertMoney(value: number | null, from: string, to: string, eurUsd: number): number | null {
  if (value == null) return null;
  const src = normalizeCurrency(from);
  const dst = normalizeCurrency(to);
  if (src === dst) return roundMoney(value);
  if (src === "USD" && dst === "EUR") return roundMoney(value / eurUsd);
  if (src === "EUR" && dst === "USD") return roundMoney(value * eurUsd);
  return null;
}

function convertRange(range: MoneyRange, from: string, to: string, eurUsd: number): MoneyRange | null {
  const converted = {
    bear: convertMoney(range.bear, from, to, eurUsd),
    base: convertMoney(range.base, from, to, eurUsd),
    bull: convertMoney(range.bull, from, to, eurUsd),
  };
  return converted.bear != null || converted.base != null || converted.bull != null ? converted : null;
}

function hasAnyRangeValue(range: MoneyRange | null | undefined): boolean {
  return !!range && (range.bear != null || range.base != null || range.bull != null);
}

function inferThesisType(s: AssetSnapshot, marketIntel: MarketIntelAnalysis | null): ThesisType {
  const revenueGrowth = s.revenue_growth ?? 0;
  const freeCashflow = s.free_cashflow ?? 0;
  const rsi = s.rsi ?? 50;
  const aboveMa50 = s.price != null && s.moving_average_50 != null && s.price > s.moving_average_50 * 1.12;

  if (freeCashflow > 0 && revenueGrowth > 0.05 && (s.debt_to_equity == null || s.debt_to_equity < 120)) {
    return "Quality Compounder";
  }
  if (revenueGrowth > 0.15 && freeCashflow <= 0) return "Story Growth";
  if (revenueGrowth < 0 && freeCashflow <= 0) return "Turnaround";
  if (rsi >= 70 || aboveMa50 || marketIntel?.trends_momentum === "rising") return "Momentum";
  // Hohe Debt/Equity allein macht keine Aktie spekulativ — Finanzkonglomerate (Versicherungen, Banken)
  // haben strukturell hohe Verschuldungsquoten. Ohne negative FCF und negatives Wachstum → Cyclical.
  if (s.debt_to_equity != null && s.debt_to_equity > 180 && freeCashflow <= 0 && revenueGrowth < 0) return "Speculative";
  return "Cyclical";
}

function inferEntryQuality(s: AssetSnapshot): EntryQuality {
  const rsi = s.rsi;
  const price = s.price;
  const ma50 = s.moving_average_50;
  const ma200 = s.moving_average_200;
  const dist50 = price != null && ma50 != null ? (price - ma50) / ma50 : null;
  const dist200 = price != null && ma200 != null ? (price - ma200) / ma200 : null;

  if ((rsi != null && rsi >= 78) || (dist50 != null && dist50 > 0.18)) {
    return { label: "nicht hinterherrennen", rationale: "Kurzfristig deutlich überkauft oder weit über dem 50-Tage-Durchschnitt." };
  }
  if ((rsi != null && rsi >= 70) || (dist50 != null && dist50 > 0.10)) {
    return { label: "Rücksetzer abwarten", rationale: "Momentum ist stark, aber das Chance/Risiko für Neueinstiege wirkt kurzfristig angespannt." };
  }
  if (rsi != null && rsi >= 45 && rsi <= 62 && dist50 != null && Math.abs(dist50) <= 0.06) {
    return { label: "attraktiv", rationale: "Timing wirkt ausgewogen: moderater RSI und Nähe zum 50-Tage-Durchschnitt." };
  }
  if (dist200 != null && dist200 < -0.20) {
    return { label: "nur spekulativ", rationale: "Der Kurs liegt klar unter dem langfristigen Trend; Einstieg nur mit erhöhtem Risiko." };
  }
  return { label: "fair", rationale: "Kein extremes Timing-Signal; Einstieg hängt stärker von These und Risikotoleranz ab." };
}

function inferValuationConfidence(
  s: AssetSnapshot,
  analystData: AnalystData | null,
  dataQuality: DianaQualityReport | null | undefined,
): ValuationConfidence {
  if ((dataQuality?.completeness_score ?? 100) < 60) return "low";
  if (s.pe_ratio == null && s.free_cashflow == null && analystData?.mean_target == null) return "low";
  if (analystData?.mean_target != null && s.pe_ratio != null && s.free_cashflow != null) return "high";
  return "medium";
}

function buildDataQualityGuardrails(
  dataQuality: DianaQualityReport | null | undefined,
  valuationConfidence: ValuationConfidence,
): string[] {
  const guardrails: string[] = [];
  if (!dataQuality) return guardrails;

  if (dataQuality.analysis_confidence_cap < 10) {
    guardrails.push(`Conviction auf maximal ${dataQuality.analysis_confidence_cap}/10 begrenzt.`);
  }
  if (dataQuality.completeness_score < 70) {
    guardrails.push("Datenbasis lückenhaft: präzise Kursziele vermeiden und nur Szenario-Spannen verwenden.");
  }
  if (dataQuality.missing_fields.length) {
    guardrails.push(`Fehlende Daten: ${dataQuality.missing_fields.slice(0, 4).join(", ")}.`);
  }
  if (valuationConfidence === "low") {
    guardrails.push("Bewertungskonfidenz niedrig: Kursbereich nur als grobe Orientierung interpretieren.");
  }
  return guardrails;
}

function buildDefaultTimeHorizonView(s: AssetSnapshot, entry: EntryQuality, thesis: ThesisType): TimeHorizonView {
  const rsiText = s.rsi != null ? `RSI ${s.rsi.toFixed(0)}` : "begrenzten technischen Daten";
  return {
    short_term: `${entry.label === "attraktiv" ? "Kurzfristig ist das Timing konstruktiv" : "Kurzfristig bleibt das Timing selektiv"} (${rsiText}). ${entry.rationale}`,
    medium_term: "Mittelfristig hängt die Entwicklung davon ab, ob Wachstum, Margen und Nachrichtenlage die aktuelle Bewertung stützen.",
    long_term: `Langfristig ist die Aktie vor allem als ${thesis}-These zu bewerten; entscheidend sind belastbare Fundamentaldaten und Execution.`,
  };
}

function buildDefaultClaims(
  s: AssetSnapshot,
  result: SynthesisResult,
  entry: EntryQuality,
  valuationConfidence: ValuationConfidence,
): AnalysisClaim[] {
  const claims: AnalysisClaim[] = [
    {
      claim: `Empfehlung ${result.recommendation} mit Conviction ${result.conviction}/10`,
      evidence: "Abgeleitet aus Fundamentalbewertung, News-Sentiment, Markt-Intelligenz und Diana-Datenqualitätscap.",
      source_type: "inference",
      confidence: Math.min(8, result.conviction),
    },
    {
      claim: `Entry Quality: ${entry.label}`,
      evidence: `RSI ${s.rsi?.toFixed(1) ?? "N/A"}, Kurs ${s.price?.toFixed(2) ?? "N/A"}, MA50 ${s.moving_average_50?.toFixed(2) ?? "N/A"}, MA200 ${s.moving_average_200?.toFixed(2) ?? "N/A"}.`,
      source_type: "metrics",
      confidence: 8,
    },
    {
      claim: `Bewertungskonfidenz: ${valuationConfidence}`,
      evidence: "Ergibt sich aus Datenvollständigkeit, Analysten-Konsens und verfügbaren Bewertungskennzahlen.",
      source_type: "inference",
      confidence: valuationConfidence === "high" ? 8 : valuationConfidence === "medium" ? 6 : 4,
    },
  ];
  return claims;
}

function buildHeuristicSynthesis(
  symbol: string,
  s: AssetSnapshot,
  fundamental: FundamentalAnalysis,
  sentiment: SentimentAnalysis,
  marketIntel: MarketIntelAnalysis | null,
  analystData: AnalystData | null,
  dataQuality: DianaQualityReport | null | undefined,
  reason: string,
): SynthesisResult {
  const thesis = inferThesisType(s, marketIntel);
  const entry = inferEntryQuality(s);
  const valuationConfidence = inferValuationConfidence(s, analystData, dataQuality);
  const positives = fundamental.key_positives.filter(Boolean);
  const risks = fundamental.key_risks.filter(Boolean);
  const bullishNews = sentiment.sentiment === "bullish";
  const bearishSignals = [
    sentiment.sentiment === "bearish",
    marketIntel?.insider_signal === "bearish",
    marketIntel?.trends_momentum === "declining",
    entry.label === "nicht hinterherrennen",
    entry.label === "nur spekulativ",
  ].filter(Boolean).length;
  const constructiveSignals = [
    fundamental.growth_rating >= 7,
    bullishNews,
    s.free_cashflow != null && s.free_cashflow > 0,
    s.revenue_growth != null && s.revenue_growth > 0.05,
    entry.label === "attraktiv",
  ].filter(Boolean).length;
  const recommendation: AllowedRecommendation =
    constructiveSignals >= 4 && bearishSignals <= 1 ? "Leicht kaufen"
    : bearishSignals >= 3 && constructiveSignals <= 2 ? "Leicht verkaufen"
    : "Halten";
  const convictionBase = recommendation === "Halten" ? 5 : 6;
  const conviction = Math.min(dataQuality?.analysis_confidence_cap ?? 10, convictionBase);
  const bullCase = (positives.length ? positives : [
    s.free_cashflow != null && s.free_cashflow > 0 ? "Positiver Free Cashflow stützt die finanzielle Qualität." : null,
    s.revenue_growth != null && s.revenue_growth > 0 ? `Umsatzwachstum von ${(s.revenue_growth * 100).toFixed(1)}% spricht für Nachfrage oder Preissetzung.` : null,
    bullishNews ? "Nachrichtenlage wirkt aktuell konstruktiv." : null,
  ].filter((item): item is string => !!item)).slice(0, 4);
  const bearCase = (risks.length ? risks : [
    s.pe_ratio != null && s.pe_ratio > 35 ? `Hohes KGV von ${s.pe_ratio.toFixed(1)} erhöht Bewertungsrisiko.` : null,
    s.price != null && s.moving_average_200 != null && s.price < s.moving_average_200 ? "Kurs liegt unter dem 200-Tage-Durchschnitt; langfristiger Trend ist noch nicht bestätigt." : null,
    marketIntel?.trends_momentum === "declining" ? "Retail-Interesse laut Google Trends rückläufig; nur schwaches Zusatzsignal." : null,
  ].filter((item): item is string => !!item)).slice(0, 4);

  while (bullCase.length < 2) bullCase.push("Fundamentaldaten liefern zumindest eine prüfbare Basis für weitere Research-Arbeit.");
  while (bearCase.length < 2) bearCase.push("Bewertung und operative Entwicklung müssen gegen aktuelle Erwartungen validiert werden.");

  const sentimentLabel = sentiment.sentiment === "bullish" ? "positiver" : sentiment.sentiment === "bearish" ? "negativer" : "neutraler";
  const summary = `${symbol} wird konservativ mit ${recommendation} und Conviction ${conviction}/10 eingestuft, weil die primäre Opus-Synthese nicht belastbar verarbeitet werden konnte (${reason}). Die Einschätzung basiert daher regelbasiert auf Fundamentalbewertung ${fundamental.growth_rating}/10, ${sentimentLabel} Nachrichtenlage, technischen Timing-Daten und verfügbaren Markt-Signalen.`;
  const growthOutlook = fundamental.valuation_comment?.trim().length > 60
    ? fundamental.valuation_comment
    : `Mittelfristig hängt die These davon ab, ob ${symbol} Wachstum, Margen und Free Cashflow gegen die aktuelle Bewertung verteidigen kann; diese Einschätzung ersetzt kein vollständiges Bewertungsmodell.`;

  return {
    recommendation,
    conviction,
    summary,
    bull_case: bullCase,
    bear_case: bearCase,
    growth_outlook: growthOutlook,
    price_levels: {
      entry: s.price ?? null,
      target: null,
      stop_loss: s.price != null ? roundMoney(s.price * 0.9) : null,
      entry_rationale: "Aktuelles Niveau als Beobachtungsmarke",
      target_rationale: "Kein präzises Ziel im Fallback",
    },
    thesis_type: thesis,
    time_horizon_view: buildDefaultTimeHorizonView(s, entry, thesis),
    entry_quality: entry,
    valuation_confidence: valuationConfidence === "high" ? "medium" : valuationConfidence,
    valuation_range: null,
    data_quality_guardrails: [
      `Synthese-Fallback: ${reason}. Ergebnis konservativ interpretieren.`,
      "Keine personalisierte Anlageberatung; bei Unsicherheit Datenlage manuell prüfen.",
    ],
    claims: [],
  };
}

function buildValuationRange(
  rawRange: ValuationRange | null | undefined,
  s: AssetSnapshot,
  analystData: AnalystData | null,
  priceLevels: PriceLevels | null | undefined,
  valuationConfidence: ValuationConfidence,
  fx: FxContext,
): ValuationRange | null {
  const quoteCurrency = normalizeCurrency(rawRange?.currency ?? s.currency ?? "USD");
  let baseRange: ValuationRange | null = rawRange && hasAnyRangeValue(rawRange)
    ? {
        currency: quoteCurrency,
        bear: roundMoney(rawRange.bear),
        base: roundMoney(rawRange.base),
        bull: roundMoney(rawRange.bull),
        rationale: rawRange.rationale || "Szenario-Spanne aus KI-Analyse.",
      }
    : null;

  if (!baseRange && analystData?.mean_target != null) {
    baseRange = {
      currency: "USD",
      bear: roundMoney(analystData.low_target ?? analystData.mean_target * 0.85),
      base: roundMoney(analystData.mean_target),
      bull: roundMoney(analystData.high_target ?? analystData.mean_target * 1.15),
      rationale: "Analystenkonsens als grobe Szenario-Spanne; keine Garantie und kein Bewertungsmodell.",
    };
  }

  if (!baseRange && priceLevels?.target != null) {
    const target = priceLevels.target;
    const spread = valuationConfidence === "low" ? 0.25 : 0.15;
    baseRange = {
      currency: normalizeCurrency(s.currency ?? "USD"),
      bear: roundMoney(target * (1 - spread)),
      base: roundMoney(target),
      bull: roundMoney(target * (1 + spread)),
      rationale: "Grobe Szenario-Spanne um das KI-Ziel; wegen begrenzter Daten nicht als präzises Kursziel verstehen.",
    };
  }

  if (!baseRange) return null;

  const native = {
    bear: baseRange.bear,
    base: baseRange.base,
    bull: baseRange.bull,
  };

  return {
    ...baseRange,
    usd: convertRange(native, baseRange.currency, "USD", fx.eurUsd),
    eur: convertRange(native, baseRange.currency, "EUR", fx.eurUsd),
    fx_rate_eur_usd: fx.eurUsd,
    fx_rate_source: fx.source,
    fx_rate_as_of: fx.asOf,
  };
}

interface FxContext {
  eurUsd: number;
  source: "finance_api" | "fallback";
  asOf: string;
}

async function fetchFxContext(): Promise<FxContext> {
  try {
    const fx = await fetchAssetData("EURUSD=X");
    const price = typeof fx.price === "number" && Number.isFinite(fx.price) ? fx.price : null;
    if (price && price > 0) {
      return { eurUsd: price, source: "finance_api", asOf: fx.fetched_at ?? new Date().toISOString() };
    }
  } catch {
    // Fallback below keeps the UI usable if the FX ticker is unavailable.
  }
  return { eurUsd: EUR_USD_FALLBACK, source: "fallback", asOf: new Date().toISOString() };
}

function completeResearchFields(
  raw: SynthesisResult,
  s: AssetSnapshot,
  marketIntel: MarketIntelAnalysis | null,
  analystData: AnalystData | null,
  dataQuality: DianaQualityReport | null | undefined,
  fx: FxContext,
): SynthesisResult {
  const thesis = raw.thesis_type ?? inferThesisType(s, marketIntel);
  const entry = raw.entry_quality ?? inferEntryQuality(s);
  const valuationConfidence = raw.valuation_confidence ?? inferValuationConfidence(s, analystData, dataQuality);
  const guardrails = [
    ...(raw.data_quality_guardrails ?? []),
    ...buildDataQualityGuardrails(dataQuality, valuationConfidence),
  ].filter((item, index, arr) => item.trim() && arr.indexOf(item) === index);

  const timeHorizon = raw.time_horizon_view ?? buildDefaultTimeHorizonView(s, entry, thesis);
  const valuationRange = buildValuationRange(
    raw.valuation_range ?? null,
    s,
    analystData,
    raw.price_levels ?? null,
    valuationConfidence,
    fx,
  );

  const confidenceIsLow = valuationConfidence === "low" || (dataQuality?.completeness_score ?? 100) < 70;
  const priceLevels = confidenceIsLow && raw.price_levels
    ? {
        ...raw.price_levels,
        target: null,
        target_rationale: "Kein präzises Kursziel wegen eingeschränkter Datenbasis",
      }
    : raw.price_levels ?? null;

  const claims = (raw.claims?.length ? raw.claims : buildDefaultClaims(s, raw, entry, valuationConfidence))
    .slice(0, 6)
    .map(claim => ({
      claim: String(claim.claim ?? "").trim() || "Unbenannte Behauptung",
      evidence: String(claim.evidence ?? "").trim() || "Keine Evidenz angegeben.",
      source_type: claim.source_type ?? "inference",
      confidence: clampConviction(Number.isFinite(claim.confidence) ? claim.confidence : 5),
    }));

  return {
    ...raw,
    thesis_type: thesis,
    time_horizon_view: timeHorizon,
    entry_quality: entry,
    valuation_confidence: valuationConfidence,
    valuation_range: valuationRange,
    data_quality_guardrails: guardrails,
    claims,
    price_levels: priceLevels,
  };
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
  dataQuality?: DianaQualityReport | null,
): Promise<SynthesisResult> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: SYNTHESIS_OPUS_TIMEOUT_MS,
    maxRetries: 0,
  });

  const marketIntelSection = marketIntel
    ? `\nMARKT-INTELLIGENZ:
Insider-Signal: ${marketIntel.insider_signal.toUpperCase()}
Institutioneller Trend: ${marketIntel.institutional_trend.toUpperCase()}
Google Trends: ${marketIntel.trends_momentum.toUpperCase()}
Beobachtungen: ${marketIntel.key_observations.join(" | ")}
Hinweis: Google Trends ist nur ein schwaches Retail-Sentiment-Signal, kein Kernargument.`
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
${sentiment.sentiment_summary}${marketIntelSection}
${dataQuality ? `\nDATENQUALITÄT: ${dataQuality.completeness_score}/100 · Conviction-Cap ${dataQuality.analysis_confidence_cap}/10 · Fehlend: ${dataQuality.missing_fields.join(", ") || "keine"}\n` : ""}`;

  const response = await client.messages.create({
    model: SYNTHESIS_OPUS_MODEL,
    max_tokens: 2200,
    system: `Du bist ein erfahrener Investment-Analyst spezialisiert auf Wachstumsaktien. Erstelle eine präzise, faktenbasierte Research-Einschätzung auf Deutsch.

WICHTIG:
- Trenne langfristige Investment-These, kurzfristiges Timing, Entry-Qualität und Datenqualität.
- Beziehe dich ausschließlich auf die bereitgestellten Daten. Erfinde keine Deals, Produkte, Margen oder Ereignisse.
- Google Trends ist nur ein schwaches Retail-Sentiment-Signal. Verwende es nie als Kernargument.
- Wenn Datenqualität lückenhaft ist: Conviction begrenzen, valuation_confidence niedrig/mittel setzen und keine pseudo-präzisen Kursziele formulieren.
- Valuation bitte als Szenario-Spanne (bear/base/bull), nicht als punktgenaues Versprechen. Nutze null, wenn keine belastbare Grundlage vorhanden ist.
- price_levels.entry und stop_loss dürfen als Timing-/Risikomarken gesetzt werden; price_levels.target nur wenn valuation_confidence nicht low ist.
- claims müssen konkrete, prüfbare Aussagen sein, jeweils mit Evidenz aus Kennzahlen, News, Analysten oder Inferenz.
- Keine Anlageberatung, keine Garantien.

Antworte ausschließlich mit validem JSON, ohne Text davor oder danach.`,
    messages: [
      {
        role: "user",
        content: `Erstelle eine strukturierte Research-Analyse:\n\n${context}\n\nJSON-Format:\n{"recommendation":"Kaufen"|"Leicht kaufen"|"Halten"|"Leicht verkaufen"|"Verkaufen","conviction":<1-10>,"summary":"2-3 Sätze","bull_case":["...","...","..."],"bear_case":["...","..."],"growth_outlook":"Ausblick","price_levels":{"entry":<Zahl|null>,"target":<Zahl|null>,"stop_loss":<Zahl|null>,"entry_rationale":"Kurzbegründung","target_rationale":"Kurzbegründung"},"thesis_type":"Quality Compounder"|"Story Growth"|"Turnaround"|"Cyclical"|"Momentum"|"Speculative","time_horizon_view":{"short_term":"...","medium_term":"...","long_term":"..."},"entry_quality":{"label":"attraktiv"|"fair"|"überhitzt"|"Rücksetzer abwarten"|"nicht hinterherrennen"|"nur spekulativ","rationale":"..."},"valuation_confidence":"high"|"medium"|"low","valuation_range":null|{"currency":"${s.currency ?? "USD"}","bear":<Zahl|null>,"base":<Zahl|null>,"bull":<Zahl|null>,"rationale":"Warum diese Spanne belastbar oder unsicher ist"},"data_quality_guardrails":["..."],"claims":[{"claim":"konkrete prüfbare Aussage","evidence":"konkreter Datenbeleg","source_type":"metrics"|"news"|"analyst"|"market_intel"|"inference","confidence":<1-10>}]}`,
      },
    ],
  });

  const parsed = parseSynthesisFromText(extractText(response.content), s.currency ?? "USD");
  assertSynthesisQuality(parsed, "Opus");
  return parsed;
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

  const newsLimit = skipArticleFetch ? VERA_FAST_NEWS_LIMIT : VERA_FULL_NEWS_LIMIT;
  const maxExcerptLength = skipArticleFetch ? 450 : 900;
  const newsSection = googleNews.slice(0, newsLimit).map(n => {
    const days = articleAgeDays(n.published);
    const ageLabel = days === null ? "" : days === 0 ? " (heute)" : days === 1 ? " (gestern)" : ` (vor ${days} Tagen)`;
    const desc = n.description && n.description.length > maxExcerptLength
      ? `${n.description.slice(0, maxExcerptLength)}...`
      : n.description;
    const excerpt = desc ? `\n   Excerpt: ${desc}` : "";
    return `- [${n.url ?? "keine URL"}] ${n.title} (${n.source}${ageLabel})${excerpt}`;
  }).join("\n") || "Keine Schlagzeilen verfügbar";

  const analystSection = formatAnalystData(analystData) || "Keine Analysten-Daten verfügbar";

  const draftText = `Empfehlung: ${synthesis.recommendation} (Überzeugung: ${synthesis.conviction}/10)
Zusammenfassung: ${synthesis.summary}
Bull-Case: ${synthesis.bull_case.join(" | ")}
Bear-Case: ${synthesis.bear_case.join(" | ")}
Wachstumsausblick: ${synthesis.growth_outlook}
Thesis Type: ${synthesis.thesis_type ?? "N/A"}
Kurzfristig: ${synthesis.time_horizon_view?.short_term ?? "N/A"}
Mittelfristig: ${synthesis.time_horizon_view?.medium_term ?? "N/A"}
Langfristig: ${synthesis.time_horizon_view?.long_term ?? "N/A"}
Entry Quality: ${synthesis.entry_quality?.label ?? "N/A"} — ${synthesis.entry_quality?.rationale ?? "N/A"}
Valuation Confidence: ${synthesis.valuation_confidence ?? "N/A"}
Valuation Range: ${synthesis.valuation_range ? `${synthesis.valuation_range.currency} Bear ${synthesis.valuation_range.bear ?? "N/A"} / Base ${synthesis.valuation_range.base ?? "N/A"} / Bull ${synthesis.valuation_range.bull ?? "N/A"} — ${synthesis.valuation_range.rationale}` : "N/A"}
Claims:
${(synthesis.claims ?? []).map(c => `- ${c.claim} | Evidence: ${c.evidence} | Confidence ${c.confidence}/10`).join("\n") || "- Keine strukturierten Claims"}`;

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

  const toolInstruction = skipArticleFetch
    ? "Du hast in diesem Lauf kein fetch_article Tool. Nutze nur die gelieferten Finance-API-Daten, Analysten-Daten und News-Excerpts. Wenn ein Claim damit nicht belegbar ist, korrigiere ihn nur bei klarem Widerspruch; sonst vermerke höchstens niedrige Evidenz."
    : "Du kannst mit fetch_article (max. 3 Aufrufe) vollständige Artikel abrufen um strittige Behauptungen zu verifizieren.";

  const systemPrompt = `Du bist Vera, eine kritische Fact-Checkerin für Finanzanalysen. ${toolInstruction} Korrigiere nur was durch die gelieferten Fakten nachweislich falsch ist. Antworte am Ende ausschließlich mit kompaktem validem JSON.

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
5. Währungsumrechnung bei Analysten-Kurszielen: Finance API liefert Kursziele immer in USD. Bei Aktien die nicht in USD notieren darf Opus diese in die lokale Notierungswährung umrechnen — das ist kein Fehler.
6. Konsistenzprüfung: Prüfe, ob Empfehlung, RSI, Abstand zu MA50/MA200, Datenqualität, Entry Quality und valuation_range logisch zusammenpassen.
7. Wenn die Datenbasis lückenhaft ist, sind hohe Conviction und präzise Kursziele verdächtig. Eine breite Szenario-Spanne ist dagegen zulässig.
8. Google Trends ist nur ein schwaches Retail-Sentiment-Signal und darf keine Kernthese stützen.`;

  const fetchArticleLine = skipArticleFetch
    ? "Kein Artikel-Nachladen in diesem Lauf. Prüfe nur gegen die gelieferten Excerpts und autoritativen Daten."
    : "Wenn ein Excerpt zu kurz ist um eine Behauptung zu verifizieren: nutze fetch_article für den relevantesten Artikel.";

  const userContent = `Prüfe diese KI-Analyse für ${symbol} auf Faktengenauigkeit.

AUTORITATIVE MARKTDATEN (Finance API, live — Vorrang vor Nachrichtenartikeln):
${authFacts}

ANALYSTEN-KONSENS (Zukunftsprognosen):
${analystSection}

NACHRICHTEN (Alter in Klammern — beachte Altersregeln; Preisangaben in Artikeln sind historisch):
${newsSection}

ZU PRÜFENDE ANALYSE:
${draftText}

${fetchArticleLine}

Abschließendes JSON-Format:
{"corrections":["max. 3 kurze Korrekturen, oder leeres Array"],"verified_claims":["max. 3 verifizierte Claims"],"confidence_adjustment":<-3 bis 0>,"corrected_summary":"<nur bei Faktenfehler, sonst null>","corrected_bull_case":["<korrigierte Liste>"],"corrected_bear_case":["<korrigierte Liste>"],"findings":[{"claim":"<betroffene konkrete Behauptung>","issue_type":"unbelegt_guidance|uebertriebener_konsens|falsche_zahl|erfundenes_event|fehlende_evidenz|sonstiges","correction":"<Korrektur>","severity":"low|medium|high","evidence_urls":["<URL>"],"confidence":<1-10>}]}`;

  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userContent }];
  const fallbackEntry: ProtocolEntry = { agent: "Vera", status: "skipped", detail: "Fact-Check nicht verfügbar" };
  let fetchCount = 0;
  let factCheck: FactCheckResult | null = null;

  // Im schnellen Modus (Background-Job): Haiku + kein fetch_article → ein einziger schneller Call
  const activeTools = skipArticleFetch ? [] : [veraTool];
  const maxTurns = skipArticleFetch ? 1 : VERA_MAX_TURNS;
  const veraModel = skipArticleFetch ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";
  const veraMaxTokens = skipArticleFetch ? 900 : 4000;

  try {
    for (let i = 0; i < maxTurns; i++) {
      const response = await client.messages.create({
        model: veraModel,
        max_tokens: veraMaxTokens,
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

function sanitizeMarketIntelAnalysis(
  result: MarketIntelAnalysis,
  trades: InsiderTrade[],
): MarketIntelAnalysis {
  const hasActualInsiderTrades = trades.length > 0;
  const insiderSignal = !hasActualInsiderTrades && result.insider_signal === "bearish"
    ? "neutral"
    : result.insider_signal;
  const key_observations = result.key_observations.map(obs => {
    let next = obs
      .replace(/fehlende Management-Conviction/gi, "kein harter Beleg für Management-Conviction")
      .replace(/klassisches Bearish-Signal/gi, "schwaches Kontextsignal")
      .replace(/konsistenter Retail-Interest-Rückgang/gi, "schwaches Retail-Sentiment-Signal");
    if (/BlackRock|Vanguard|State Street/i.test(next) && !/passiv|Index|ETF/i.test(next)) {
      next += " Passive Index-/ETF-Flüsse nicht überinterpretieren.";
    }
    return next;
  });
  if (!hasActualInsiderTrades && result.insider_signal === "bearish") {
    key_observations.unshift("Keine aktuellen Insider-Transaktionen: niedrige Insider-Ownership allein wird nicht als stark bearish gewertet.");
  }

  return { ...result, insider_signal: insiderSignal, key_observations };
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
    system: `Du bist ein vorsichtiger Marktanalyse-Experte. Bewerte Insider-Aktivität und institutionelle Positionierung nüchtern.
Regeln:
- Niedrige Insider-Ownership ist bei Mega-Caps und Gründer-/Index-getriebenen Unternehmen NICHT automatisch bearish.
- BlackRock, Vanguard, State Street und ähnliche Top-Holder sind meist passive Index-/ETF-Positionen; nicht als aktive Conviction interpretieren.
- Insider-Verkäufe sind nur stark bearish, wenn sie groß, gehäuft und nicht plausibel planbasiert sind.
- Google Trends ist nur ein schwaches Retail-Sentiment-Signal und darf nie als Kernargument gewertet werden.
- Formuliere Beobachtungen als "Hinweis" oder "schwaches Signal", wenn die Daten keine harte Aussage tragen.
Antworte ausschließlich mit validem JSON.`,
    messages: [
      {
        role: "user",
        content: `Analysiere diese Markt-Signale:\n\n${context}\n\nJSON-Format:\n{"insider_signal":"bullish"|"neutral"|"bearish","institutional_trend":"accumulating"|"stable"|"reducing","trends_momentum":"rising"|"stable"|"declining","key_observations":["..."]}`,
      },
    ],
  });

  try {
    return sanitizeMarketIntelAnalysis(parseJSON<MarketIntelAnalysis>(extractText(response.content)), trades);
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

// ─── Synthese-Fallback (Haiku) ────────────────────────────────────────────────
// Wird verwendet wenn Opus das Zeitbudget überschreitet.
// Kürzerer Prompt, Haiku-Modell → typisch ~6-10s.

async function runSynthesisFastAgent(
  symbol: string,
  s: AssetSnapshot,
  fundamental: FundamentalAnalysis,
  sentiment: SentimentAnalysis,
  marketIntel: MarketIntelAnalysis | null,
  analystData: AnalystData | null,
  dataQuality?: DianaQualityReport | null,
): Promise<SynthesisResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 12_000, maxRetries: 0 });

  const analystLine = analystData?.mean_target != null
    ? `Analysten-Kursziel: Ø $${analystData.mean_target.toFixed(2)}`
    : "";
  const priceLine = s.price != null ? `Kurs: ${s.price.toFixed(2)} ${s.currency ?? "USD"}` : "";
  const miLine = marketIntel
    ? `Insider: ${marketIntel.insider_signal} | Institutionen: ${marketIntel.institutional_trend}`
    : "";
  const dianaLine = dataQuality
    ? `Datenbasis: ${dataQuality.completeness_score}/100, Cap: ${dataQuality.analysis_confidence_cap}/10`
    : "";

  const context = [
    `${symbol} | ${priceLine}`,
    `Wachstum: ${fundamental.growth_rating}/10 | ${fundamental.key_positives.slice(0, 2).join(", ")}`,
    `Risiken: ${fundamental.key_risks.slice(0, 2).join(", ")}`,
    `Sentiment: ${sentiment.sentiment.toUpperCase()} | ${sentiment.sentiment_summary.slice(0, 120)}`,
    analystLine, miLine, dianaLine,
  ].filter(Boolean).join("\n");

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: "Du bist ein Aktienanalyst. Erstelle eine kurze Einschätzung auf Deutsch. Antworte ausschließlich mit validem JSON, ohne Text davor oder danach.",
      messages: [{
        role: "user",
        content: `Analysiere:\n\n${context}\n\nJSON:\n{"recommendation":"Kaufen"|"Leicht kaufen"|"Halten"|"Leicht verkaufen"|"Verkaufen","conviction":<1-10>,"summary":"2 Sätze","bull_case":["...","...","..."],"bear_case":["...","..."],"growth_outlook":"1 Satz","price_levels":{"entry":${s.price != null ? s.price.toFixed(2) : null},"target":null,"stop_loss":null,"entry_rationale":"aktuelles Kursniveau","target_rationale":""}}`,
      }],
    });

    const parsed = parseSynthesisFromText(extractText(response.content), s.currency ?? "USD");
    assertSynthesisQuality(parsed, "Haiku-Fallback");
    return {
      ...parsed,
      valuation_confidence: parsed.valuation_confidence === "high" ? "medium" : parsed.valuation_confidence ?? "medium",
      data_quality_guardrails: [
        ...(parsed.data_quality_guardrails ?? []),
        "Schnell-Analyse (Haiku-Fallback): Opus überschritt das Zeitbudget.",
      ],
    };
  } catch (err) {
    return buildHeuristicSynthesis(
      symbol,
      s,
      fundamental,
      sentiment,
      marketIntel,
      analystData,
      dataQuality,
      err instanceof Error ? err.message : "Haiku-Fallback nicht verwertbar",
    );
  }
}

// ─── Optimierte Pipeline (ersetzt runOrchestrator) ───────────────────────────

type TraceStepRunner = <T>(
  step: string,
  label: string,
  progress: number,
  fn: () => Promise<T>,
) => Promise<T>;

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
  dataQuality: DianaQualityReport | null,
  peerContext: string,
  serviceClient: SbClient,
  fxContext: FxContext,
  onSynthesisStart?: () => Promise<void>,
  _onVeraStart?: () => Promise<void>,
  traceStep?: TraceStepRunner,
): Promise<OrchestratorResult> {
  const protocol: ProtocolEntry[] = [];
  const runStep: TraceStepRunner = traceStep ?? ((_step, _label, _progress, fn) => fn());
  const guardrails = await runStep(
    "load_guardrails",
    "Historische Guardrails laden",
    42,
    () => fetchGuardrails(symbol, serviceClient).catch(() => ""),
  );

  // Felix + Nina + Marco parallel (alle Haiku — schnell)
  const [fundamental, sentiment, marketIntel] = await runStep(
    "run_agents",
    "Felix, Nina & Marco analysieren",
    45,
    () => Promise.all([
      runFundamentalAgent(snapshot, edgarFacts, peerContext),
      runSentimentAgent(googleNews),
      runMarketIntelAgent(insiderTrades, trends, institutional),
    ]),
  );

  const withExcerpts = googleNews.filter(n => n.description).length;
  const noMarcoData = marketIntel.key_observations[0] === "Keine Markt-Intelligenz-Daten verfügbar";

  protocol.push({ agent: "Felix", status: "ok", detail: `Wachstumsbewertung ${fundamental.growth_rating}/10 · ${fundamental.key_positives.length} Stärken, ${fundamental.key_risks.length} Risiken${peerContext ? " · Peer-Kontext vorhanden" : ""}` });
  protocol.push({ agent: "Nina", status: "ok", detail: `Sentiment: ${sentiment.sentiment} · ${sentiment.key_themes.length} Themen · ${withExcerpts}/${googleNews.length} Artikel mit Jina-Excerpt` });
  protocol.push({ agent: "Marco", status: noMarcoData ? "skipped" : "ok", detail: noMarcoData ? "Keine Daten verfügbar (nur für US-Aktien)" : `Insider: ${marketIntel.insider_signal} · Institutionen: ${marketIntel.institutional_trend} · Trends: ${marketIntel.trends_momentum}` });

  // Synthese: Opus als qualitative Hauptsynthese → bei Timeout Haiku-Fallback (~8s)
  if (onSynthesisStart) await onSynthesisStart().catch(() => {});
  let rawSynthesisBase: SynthesisResult;
  let usedFallback = false;
  try {
    rawSynthesisBase = await runStep(
      "run_synthesis",
      "Opus Synthese erstellen",
      65,
      () => runSynthesisAgent(symbol, snapshot, fundamental, sentiment, marketIntel, analystData, dataQuality),
    );
  } catch {
    console.log(`[PIPELINE][${symbol}] Opus-Timeout → Haiku-Fallback`);
    rawSynthesisBase = await runStep(
      "fast_synthesis",
      "Haiku-Fallback erstellen",
      72,
      () => runSynthesisFastAgent(symbol, snapshot, fundamental, sentiment, marketIntel, analystData, dataQuality),
    );
    usedFallback = true;
  }
  const rawSynthesis = await runStep(
    "research_guardrails",
    "Research-Guardrails anwenden",
    78,
    async () => completeResearchFields(rawSynthesisBase, snapshot, marketIntel, analystData, dataQuality, fxContext),
  );
  assertSynthesisQuality(rawSynthesis, usedFallback ? "Fallback-Synthese" : "Opus-Synthese");
  const rawConviction = clampConviction(rawSynthesis.conviction);
  const cappedConviction = Math.min(rawConviction, confidenceCap);
  const capNote = rawConviction > confidenceCap ? ` · Conviction ${rawConviction}→${cappedConviction} (Diana-Cap)` : "";
  const fallbackNote = usedFallback ? " · Haiku-Fallback (Opus-Timeout)" : "";
  protocol.push({ agent: "Opus", status: usedFallback ? "warning" : "ok", detail: `Synthese: ${rawSynthesis.recommendation} · Conviction ${cappedConviction}/10${capNote}${guardrails ? " · Guardrails aktiv" : ""}${fallbackNote}` });

  const cappedSynthesis = { ...rawSynthesis, conviction: cappedConviction };
  protocol.push({
    agent: "Vera",
    status: "skipped",
    detail: "Fact-Check läuft nachgelagert und blockiert die Analyse nicht",
  });

  return {
    ...cappedSynthesis,
    conviction: Math.min(cappedSynthesis.conviction, confidenceCap),
    price_levels: cappedSynthesis.price_levels ?? null,
    thesis_type: cappedSynthesis.thesis_type ?? null,
    time_horizon_view: cappedSynthesis.time_horizon_view ?? null,
    entry_quality: cappedSynthesis.entry_quality ?? null,
    valuation_confidence: cappedSynthesis.valuation_confidence ?? null,
    valuation_range: cappedSynthesis.valuation_range ?? null,
    data_quality_guardrails: cappedSynthesis.data_quality_guardrails ?? [],
    claims: cappedSynthesis.claims ?? [],
    fundamental,
    sentiment,
    market_intel: marketIntel,
    protocol,
    findings: [],
  };
}

function replaceVeraProtocolEntry(entries: ProtocolEntry[], entry: ProtocolEntry): ProtocolEntry[] {
  const pendingIndex = entries.findIndex(
    item => item.agent === "Vera" && item.detail.includes("nachgelagert"),
  );
  if (pendingIndex === -1) return [...entries, entry];
  return entries.map((item, index) => index === pendingIndex ? entry : item);
}

function buildAnalysisExtraData(result: AIAnalysisResult): import("@/types/database").Json {
  return ({
    ...(result.market_intel ? { market_intel: result.market_intel } : {}),
    ...(result.price_levels ? { price_levels: result.price_levels } : {}),
    ...(result.thesis_type ? { thesis_type: result.thesis_type } : {}),
    ...(result.time_horizon_view ? { time_horizon_view: result.time_horizon_view } : {}),
    ...(result.entry_quality ? { entry_quality: result.entry_quality } : {}),
    ...(result.valuation_confidence ? { valuation_confidence: result.valuation_confidence } : {}),
    ...(result.valuation_range ? { valuation_range: result.valuation_range } : {}),
    ...(result.data_quality_guardrails ? { data_quality_guardrails: result.data_quality_guardrails } : {}),
    ...(result.claims ? { claims: result.claims } : {}),
    ...(result.data_quality ? { data_quality: result.data_quality } : {}),
    ...(result.trace ? { analysis_trace: result.trace } : {}),
    protocol: result.protocol,
  }) as unknown as import("@/types/database").Json;
}

async function runDeferredVeraCheck({
  analysisId,
  jobId,
  userId,
  symbol,
  result,
  analystData,
  googleNews,
  snapshot,
  confidenceCap,
  serviceClient,
  startTrace,
  finishTrace,
  getTrace,
}: {
  analysisId: string | null;
  jobId: string;
  userId: string;
  symbol: string;
  result: AIAnalysisResult;
  analystData: AnalystData | null;
  googleNews: NewsItemWithDesc[];
  snapshot: AssetSnapshot;
  confidenceCap: number;
  serviceClient: ReturnType<typeof createServiceClient>;
  startTrace?: (step: string, label: string, progress: number) => Promise<AnalysisTraceEntry>;
  finishTrace?: (entry: AnalysisTraceEntry, status: AnalysisTraceEntry["status"], detail?: string, error?: string) => Promise<void>;
  getTrace?: () => AnalysisTraceEntry[];
}): Promise<void> {
  const ts = () => new Date().toISOString();

  const completeWith = async (finalResult: AIAnalysisResult) => {
    if (analysisId) {
      await serviceClient.from("ai_analyses").update({
        recommendation: finalResult.recommendation,
        conviction: finalResult.conviction,
        summary: finalResult.summary,
        bull_case: finalResult.bull_case,
        bear_case: finalResult.bear_case,
        growth_outlook: finalResult.growth_outlook,
        extra_data: buildAnalysisExtraData(finalResult),
      }).eq("id", analysisId);
    }

    await serviceClient.from("analysis_jobs").update({
      status: "completed",
      current_step: "completed",
      progress: 100,
      result: finalResult as unknown as import("@/types/database").Json,
      updated_at: ts(),
    }).eq("id", jobId).eq("user_id", userId);
  };

  const veraTrace = startTrace
    ? await startTrace("vera_fact_check", "Vera Faktencheck", 98).catch(() => null)
    : null;
  const timeoutResult = Symbol("vera-timeout");
  const factCheckPromise = runFactCheckAgent(
    symbol, result, analystData, googleNews, snapshot, true,
  ).catch(() => null);

  const factCheck = await Promise.race([
    factCheckPromise,
    new Promise<typeof timeoutResult>(resolve =>
      setTimeout(() => resolve(timeoutResult), DEFERRED_VERA_TIMEOUT_MS),
    ),
  ]);

  if (!factCheck || factCheck === timeoutResult) {
    if (veraTrace && finishTrace) {
      await finishTrace(veraTrace, "timeout", "Vera überschritt das nachgelagerte Zeitbudget").catch(() => {});
    }
    const skippedResult: AIAnalysisResult = {
      ...result,
      trace: getTrace ? getTrace() : result.trace,
      protocol: replaceVeraProtocolEntry(result.protocol, {
        agent: "Vera",
        status: "skipped",
        detail: "Fact-Check wegen Timeout übersprungen",
      }),
    };
    await completeWith(skippedResult);
    return;
  }

  if (veraTrace && finishTrace) {
    const veraUnavailable = factCheck.entry.status === "skipped";
    await finishTrace(
      veraTrace,
      veraUnavailable ? "warning" : factCheck.findings.length ? "warning" : "ok",
      veraUnavailable
        ? factCheck.entry.detail
        : factCheck.findings.length
        ? `${factCheck.findings.length} Korrektur(en) oder Findings`
        : "Keine belegten Fehler gefunden",
    ).catch(() => {});
  }

  const verifiedResult: AIAnalysisResult = {
    ...result,
    recommendation: factCheck.result.recommendation,
    conviction: Math.min(factCheck.result.conviction, confidenceCap),
    summary: factCheck.result.summary,
    bull_case: factCheck.result.bull_case,
    bear_case: factCheck.result.bear_case,
    growth_outlook: factCheck.result.growth_outlook,
    price_levels: factCheck.result.price_levels ?? result.price_levels,
    thesis_type: factCheck.result.thesis_type ?? result.thesis_type,
    time_horizon_view: factCheck.result.time_horizon_view ?? result.time_horizon_view,
    entry_quality: factCheck.result.entry_quality ?? result.entry_quality,
    valuation_confidence: factCheck.result.valuation_confidence ?? result.valuation_confidence,
    valuation_range: factCheck.result.valuation_range ?? result.valuation_range,
    data_quality_guardrails: factCheck.result.data_quality_guardrails ?? result.data_quality_guardrails,
    claims: factCheck.result.claims ?? result.claims,
    trace: getTrace ? getTrace() : result.trace,
    protocol: replaceVeraProtocolEntry(result.protocol, factCheck.entry),
  };

  if (analysisId && factCheck.findings.length) {
    void saveFactCheckFindings(analysisId, symbol, factCheck.findings, serviceClient);
  }

  await completeWith(verifiedResult);
}

// ─── Background Job ───────────────────────────────────────────────────────────

export async function runAnalysisJob(
  jobId: string,
  symbol: string,
  userId: string,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<void> {
  const ts = () => new Date().toISOString();
  const _start = Date.now();
  const tlog = (label: string) =>
    console.log(`[JOB:${jobId.slice(0, 8)}][${symbol}] ${label}: ${Date.now() - _start}ms`);
  const trace: AnalysisTraceEntry[] = [];

  const publishTrace = async (
    fields: Database["public"]["Tables"]["analysis_jobs"]["Update"] = {},
  ) => {
    await serviceClient.from("analysis_jobs").update({
      result: tracePayload(trace),
      updated_at: ts(),
      ...fields,
    }).eq("id", jobId).eq("user_id", userId);
  };

  const updateStep = async (step: string, progress: number) => {
    await publishTrace({
      status: "running",
      current_step: step,
      progress,
    });
  };

  const getTrace = () => cloneTrace(trace);

  const startTrace = async (
    step: string,
    label: string,
    progress: number,
  ): Promise<AnalysisTraceEntry> => {
    const entry: AnalysisTraceEntry = {
      step,
      label,
      status: "running",
      started_at: ts(),
      finished_at: null,
      duration_ms: null,
    };
    trace.push(entry);
    console.log(JSON.stringify({
      event: "analysis_trace_start",
      job_id: jobId,
      symbol,
      step,
      label,
      elapsed_ms: Date.now() - _start,
    }));
    await publishTrace({
      status: step === "vera_fact_check" ? "reviewing" : "running",
      current_step: step,
      progress,
    });
    return entry;
  };

  const finishTrace = async (
    entry: AnalysisTraceEntry,
    status: AnalysisTraceEntry["status"],
    detail?: string,
    error?: string,
  ) => {
    const finishedAt = ts();
    entry.status = status;
    entry.finished_at = finishedAt;
    entry.duration_ms = Math.max(0, new Date(finishedAt).getTime() - new Date(entry.started_at).getTime());
    if (detail) entry.detail = detail;
    if (error) entry.error = error;
    console.log(JSON.stringify({
      event: "analysis_trace_finish",
      job_id: jobId,
      symbol,
      step: entry.step,
      status,
      duration_ms: entry.duration_ms,
      detail,
      error,
      elapsed_ms: Date.now() - _start,
    }));
    await publishTrace();
  };

  const traceStep: TraceStepRunner = async (step, label, progress, fn) => {
    const entry = await startTrace(step, label, progress);
    try {
      const result = await fn();
      await finishTrace(entry, "ok");
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await finishTrace(entry, "error", undefined, message).catch(() => {});
      throw err;
    }
  };

  const markRunningTraceAsTimeout = async (detail: string) => {
    const now = ts();
    for (const entry of trace) {
      if (entry.status !== "running") continue;
      entry.status = "timeout";
      entry.finished_at = now;
      entry.duration_ms = Math.max(0, new Date(now).getTime() - new Date(entry.started_at).getTime());
      entry.detail = detail;
    }
    await publishTrace({ result: tracePayload(trace) }).catch(() => {});
  };

  // Sicherheits-Wrapper: bricht vor Vercels 300s-Limit ab, damit wir sauber speichern.
  const JOB_SAFETY_MS = 280_000;
  let _safetyTimer: ReturnType<typeof setTimeout> | null = null;
  const _safetyPromise = new Promise<never>((_, reject) => {
    _safetyTimer = setTimeout(() => reject(new Error(`Pipeline-Timeout nach ${JOB_SAFETY_MS / 1000}s`)), JOB_SAFETY_MS);
  });

  const _runJob = async () => {

  try {
    tlog("start");
    const [assetData, googleNews, edgarFacts, insiderTrades, trends, institutional, analystData, fxContext] =
      await traceStep("fetch_data", "Markt-, News- und Zusatzdaten laden", 10, () => Promise.all([
        fetchAssetData(symbol),
        fetchGoogleNews(symbol).catch(() => [] as GoogleNewsItem[]),
        fetchEdgarFacts(symbol).catch(() => null),
        fetchInsiderTrades(symbol).catch(() => [] as InsiderTrade[]),
        fetchTrends(symbol).catch(() => [] as TrendPoint[]),
        fetchInstitutional(symbol).catch(() => null),
        fetchAnalystData(symbol).catch(() => null as AnalystData | null),
        fetchFxContext().catch(() => ({ eurUsd: EUR_USD_FALLBACK, source: "fallback" as const, asOf: new Date().toISOString() })),
      ]));
    tlog("after Promise.all data fetch");

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

    const googleNewsLimited = googleNews.slice(0, ENRICH_MAX_ARTICLES);
    const googleNewsEnriched = await traceStep("enrich_news", "News-Excerpts per Jina anreichern", 20, () => Promise.race([
      enrichWithDescriptions(googleNewsLimited),
      new Promise<typeof googleNewsLimited>(resolve =>
        setTimeout(() => resolve(googleNewsLimited), ENRICH_TIMEOUT_MS),
      ),
    ]).catch(() => googleNewsLimited));
    tlog("after enrichWithDescriptions");

    const peerContext = await traceStep(
      "peer_context",
      "Peer-Kontext laden",
      26,
      () => fetchPeerContext(symbol, serviceClient).catch(() => ""),
    );
    tlog("after fetchPeerContext");

    const diana = await traceStep(
      "diana_check",
      "Diana Datenqualität prüfen",
      30,
      async () => runDianaCheck(snapshot, googleNewsEnriched, edgarFacts, analystData, peerContext),
    );
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

    tlog("starting runAnalysisPipeline");

    const orchestrated = await runAnalysisPipeline(
      symbol, snapshot, googleNewsEnriched, edgarFacts, insiderTrades, trends, institutional, analystData,
      diana.analysis_confidence_cap, diana, peerContext, serviceClient, fxContext,
      () => { tlog("synthesis start"); return updateStep("run_synthesis", 65); },
      () => updateStep("run_vera", 80),
      traceStep,
    );
    tlog("after runAnalysisPipeline");

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
      thesis_type: orchestrated.thesis_type ?? null,
      time_horizon_view: orchestrated.time_horizon_view ?? null,
      entry_quality: orchestrated.entry_quality ?? null,
      valuation_confidence: orchestrated.valuation_confidence ?? null,
      valuation_range: orchestrated.valuation_range ?? null,
      data_quality_guardrails: orchestrated.data_quality_guardrails ?? [],
      claims: orchestrated.claims ?? [],
      data_quality: diana,
      protocol: [dianaEntry, ...orchestrated.protocol],
      analyzed_at: new Date().toISOString(),
      from_cache: false,
      trace: getTrace(),
    };

    let analysisId: string | null = null;
    await traceStep("save_result", "Analyse speichern", 95, async () => {
      result.trace = getTrace();
      analysisId = await saveAnalysis(result, serviceClient);
      void saveOutcome(result, serviceClient);
    });
    result.trace = getTrace();
    tlog("after saveAnalysis");

    await serviceClient.from("analysis_jobs").update({
      status: "reviewing",
      current_step: "vera_pending",
      progress: 100,
      result: { ...result, trace: getTrace() } as unknown as import("@/types/database").Json,
      updated_at: ts(),
    }).eq("id", jobId).eq("user_id", userId);
    tlog("starting runDeferredVeraCheck");

    await runDeferredVeraCheck({
      analysisId,
      jobId,
      userId,
      symbol,
      result,
      analystData,
      googleNews: googleNewsEnriched,
      snapshot,
      confidenceCap: diana.analysis_confidence_cap,
      serviceClient,
      startTrace,
      finishTrace,
      getTrace,
    }).catch(async () => {
      await markRunningTraceAsTimeout("Vera konnte nicht abgeschlossen werden").catch(() => {});
      const skippedResult: AIAnalysisResult = {
        ...result,
        trace: getTrace(),
        protocol: replaceVeraProtocolEntry(result.protocol, {
          agent: "Vera",
          status: "skipped",
          detail: "Fact-Check konnte nachgelagert nicht abgeschlossen werden",
        }),
      };

      try {
        await serviceClient.from("analysis_jobs").update({
          status: "completed",
          current_step: "completed",
          progress: 100,
          result: skippedResult as unknown as import("@/types/database").Json,
          updated_at: ts(),
        }).eq("id", jobId).eq("user_id", userId);
      } catch {
        // The main result is already stored; Vera must never flip the job to failed.
      }
    });
    tlog("completed");

  } catch (err) {
    tlog(`error: ${err instanceof Error ? err.message : String(err)}`);
    await markRunningTraceAsTimeout("Analyse wurde mit Fehler beendet").catch(() => {});
    await serviceClient.from("analysis_jobs").update({
      status: "failed",
      error: err instanceof Error ? err.message : "Unbekannter Fehler",
      result: tracePayload(trace),
      updated_at: ts(),
    }).eq("id", jobId).eq("user_id", userId);
  }

  }; // end _runJob

  try {
    await Promise.race([_runJob(), _safetyPromise]);
  } catch (err) {
    tlog(`safety-catch: ${err instanceof Error ? err.message : String(err)}`);
    try {
      await markRunningTraceAsTimeout("Pipeline-Sicherheitslimit erreicht").catch(() => {});
      await serviceClient.from("analysis_jobs").update({
        status: "failed",
        error: err instanceof Error ? err.message : "Analyse-Timeout",
        result: tracePayload(trace),
        updated_at: ts(),
      }).eq("id", jobId).eq("user_id", userId);
    } catch { /* ignore */ }
  } finally {
    if (_safetyTimer) clearTimeout(_safetyTimer);
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

    const extra = (data.extra_data as Record<string, unknown>) ?? {};

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
      market_intel: extra.market_intel as MarketIntelAnalysis | null ?? null,
      price_levels: extra.price_levels as PriceLevels | null ?? null,
      thesis_type: extra.thesis_type as ThesisType | null ?? null,
      time_horizon_view: extra.time_horizon_view as TimeHorizonView | null ?? null,
      entry_quality: extra.entry_quality as EntryQuality | null ?? null,
      valuation_confidence: extra.valuation_confidence as ValuationConfidence | null ?? null,
      valuation_range: extra.valuation_range as ValuationRange | null ?? null,
      data_quality_guardrails: extra.data_quality_guardrails as string[] ?? [],
      claims: extra.claims as AnalysisClaim[] ?? [],
      data_quality: extra.data_quality as DianaQualityReport | null ?? null,
      protocol: extra.protocol as ProtocolEntry[] ?? [],
      trace: extra.analysis_trace as AnalysisTraceEntry[] ?? [],
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
      extra_data: buildAnalysisExtraData(result),
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

  return NextResponse.json({ status: "queued", job_id: job.id, symbol });
}
