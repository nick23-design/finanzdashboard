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
import { getEurUsd, type FxSource } from "@/lib/fx";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/rate-limit";
import { getConfiguredPeers } from "@/lib/peer-utils";
import { enrichWithDescriptions, fetchArticleDescription } from "@/lib/article-fetch";
import { loadCachedResearchData } from "@/lib/research-cache";
import {
  buildAnalystConsensusValuation,
  buildBusinessDriverAnalysis,
  buildOwnModelValuation,
  type BusinessDriverAnalysis,
  type RawValuationRange,
  type ValueDriver,
} from "@/lib/ai-analysis/valuation-model";
import { computeDcfScenarios } from "@/lib/ai-analysis/dcf-pipeline";
import type { DcfScenariosOutput } from "@/lib/ai-analysis/dcf";
import { calculateAlphaFramework, type AlphaFrameworkOutput } from "@/lib/ai-analysis/alpha-framework";
import {
  FELIX_SYSTEM_PROMPT,
  NINA_SYSTEM_PROMPT,
  MARCO_SYSTEM_PROMPT,
  buildOpusSynthesisSystemPrompt,
  buildVeraFactCheckSystemPrompt,
} from "@/lib/ai-analysis/agent-prompts";
import {
  DEFAULT_GROWTH_OUTLOOK,
  logSynthesisNormalizationEvents,
  normalizeClaimConfidenceValue,
  normalizeGrowthOutlookValue,
  normalizeSynthesisForSchema,
  repairGermanVisibleText,
  validateAndRepairSynthesis,
  SynthesisValidationSchema,
} from "@/lib/ai-analysis/synthesis-validator";
import {
  buildValuationDivergence,
  type DivergenceResult,
} from "@/lib/ai-analysis/divergence";
import {
  routeCompanyType,
  selectValuationModels,
  type CompanyTypeClassification,
  type ModelSelectionOutput,
} from "@/lib/ai-analysis/company-type-router";
import {
  analyzeValuationDivergence,
  evaluateDcfPlausibility,
  evaluateReverseDcfPlausibility,
  type DcfPlausibilityOutput,
  type ReverseDcfPlausibilityOutput,
  type ValuationDivergenceOutput,
} from "@/lib/ai-analysis/valuation-plausibility";
import {
  buildAnalysisDebugSnapshot,
  buildConfidenceBreakdown,
  buildThesisChangeTriggers,
  type AnalysisConfidenceBreakdown,
  type AnalysisDebugSnapshot,
  type ThesisChangeTriggers,
} from "@/lib/ai-analysis/analysis-explainability";
import {
  runGuardrailEngine,
  ALL_LIGHTWEIGHT_RULES,
  type GuardrailAnalysis,
  type GuardrailContext,
} from "@/lib/ai-analysis/guardrails";
import {
  detectAvailableModelInputs,
  buildModelSelectionPlan,
  type ModelSelectionPlan,
} from "@/lib/ai-analysis/model-selector";
import {
  buildStructuredSynthesisInput,
  formatStructuredBriefingForPrompt,
  formatSectorSynthesisTemplate,
  buildGrowthOutlookToolDescription,
  type StructuredSynthesisInput,
} from "@/lib/ai-analysis/structured-synthesis-input";
import {
  runReitAffoNav,
  runBankValuation,
  runCommodityEnergyMidcycle,
  runPlatformSotp,
  runCyclicalHardwareNormalized,
  runSoftwareRuleOf40,
  runSemiconductorCycle,
  runAiExposureNarrativeScore,
  formatSpecializedValuationsForPrompt,
  type SpecializedValuations,
} from "@/lib/ai-analysis/models/specialized-models";
import type { StructuredSynthesisDebug } from "@/lib/ai-analysis/analysis-explainability";
import type { AssetSnapshot, Database, Json } from "@/types/database";

export const maxDuration = 10;

const ENRICH_MAX_ARTICLES = 6;
const ENRICH_TIMEOUT_MS = 8_000;
const VERA_MAX_TURNS = 3;
const DEFERRED_VERA_TIMEOUT_MS = 25_000;
const VERA_FAST_NEWS_LIMIT = 5;
const VERA_FULL_NEWS_LIMIT = 10;
// Nur noch Error-Path-Default; der echte Kurs kommt aus getEurUsd (@/lib/fx).
const EUR_USD_FALLBACK = 1.16;
// Opus ist die qualitative Hauptsynthese. Keine SDK-Retries: Ein sauberer
// Versuch, danach Haiku-Fallback statt versteckter 3x-Timeouts.
const SYNTHESIS_OPUS_MODEL = "claude-opus-4-7";
const SYNTHESIS_OPUS_TIMEOUT_MS = 150_000;

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
  confidence: z.preprocess(
    normalizeClaimConfidenceValue,
    z.number().int().min(1).max(5),
  ),
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
  growth_outlook: z.preprocess(
    normalizeGrowthOutlookValue,
    z.string().min(1),
  ),
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
  const peers = getConfiguredPeers(symbol);
  if (!peers?.length) return "";

  const supabase = client ?? await createClient();
  const selectFields = "symbol, pe_ratio, revenue_growth, debt_to_equity, market_cap, fetched_at";
  const freshCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let stale = false;
  let { data } = await supabase
    .from("asset_snapshots")
    .select(selectFields)
    .in("symbol", peers)
    .gte("fetched_at", freshCutoff)
    .order("fetched_at", { ascending: false });

  if (!data || data.length === 0) {
    const staleResult = await supabase
      .from("asset_snapshots")
      .select(selectFields)
      .in("symbol", peers)
      .gte("fetched_at", staleCutoff)
      .order("fetched_at", { ascending: false });
    data = staleResult.data;
    stale = Boolean(data?.length);
  }

  if (!data || data.length === 0) return "";

  const seen = new Set<string>();
  const rows = (data as { symbol: string; pe_ratio: number | null; revenue_growth: number | null; debt_to_equity: number | null; market_cap: number | null; fetched_at: string }[])
    .filter(r => { if (seen.has(r.symbol)) return false; seen.add(r.symbol); return true; });

  if (rows.length === 0) return "";

  const peValues = rows.map(r => r.pe_ratio).filter((v): v is number => v != null);
  const growthValues = rows.map(r => r.revenue_growth).filter((v): v is number => v != null);
  const deValues = rows.map(r => r.debt_to_equity).filter((v): v is number => v != null);

  const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const peAvg = avg(peValues);
  const growthAvg = avg(growthValues);
  const deAvg = avg(deValues);

  const lines = [
    `Vergleich mit ${rows.map(r => r.symbol).join(", ")} (Branchen-Peers${stale ? ", Snapshot älter als 24h" : ""}):`,
  ];
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
  source?: "analyst_consensus" | "own_model" | "synthesis" | "dcf";
  confidence?: ValuationConfidence | null;
  methods?: string[];
  limitations?: string[];
  usd?: MoneyRange | null;
  eur?: MoneyRange | null;
  fx_rate_eur_usd?: number | null;
  fx_rate_source?: FxSource | null;
  fx_rate_as_of?: string | null;
}

export interface AnalysisClaim {
  claim: string;
  evidence: string;
  source_type: "metrics" | "news" | "analyst" | "market_intel" | "inference";
  confidence: number;
}

/** Re-exported so components can import the type from route without touching the lib path. */
export type { DivergenceResult };

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
  analyst_consensus_range?: ValuationRange | null;
  model_valuation_range?: ValuationRange | null;
  dcf_valuation_range?: ValuationRange | null;
  valuation_divergence?: DivergenceResult | null;
  business_drivers?: BusinessDriverAnalysis | null;
  alpha_framework?: AlphaFrameworkOutput | null;
  thesis_change_triggers?: ThesisChangeTriggers | null;
  confidence_breakdown?: AnalysisConfidenceBreakdown | null;
  analysis_debug?: AnalysisDebugSnapshot | null;
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

interface OptionalFetchResult<T> {
  data: T;
  error: string | null;
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
  analyst_consensus_range?: ValuationRange | null;
  model_valuation_range?: ValuationRange | null;
  dcf_valuation_range?: ValuationRange | null;
  valuation_divergence?: DivergenceResult | null;
  business_drivers?: BusinessDriverAnalysis | null;
  alpha_framework?: AlphaFrameworkOutput | null;
  thesis_change_triggers?: ThesisChangeTriggers | null;
  confidence_breakdown?: AnalysisConfidenceBreakdown | null;
  analysis_debug?: AnalysisDebugSnapshot | null;
  data_quality_guardrails?: string[];
  claims?: AnalysisClaim[];
  data_quality: DianaQualityReport | null;
  analyzed_at: string;
  from_cache: boolean;
  protocol: ProtocolEntry[];
  fact_check_status?: string | null;
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
  analyst_consensus_range?: ValuationRange | null;
  model_valuation_range?: ValuationRange | null;
  dcf_valuation_range?: ValuationRange | null;
  valuation_divergence?: DivergenceResult | null;
  business_drivers?: BusinessDriverAnalysis | null;
  alpha_framework?: AlphaFrameworkOutput | null;
  thesis_change_triggers?: ThesisChangeTriggers | null;
  confidence_breakdown?: AnalysisConfidenceBreakdown | null;
  analysis_debug?: AnalysisDebugSnapshot | null;
  data_quality_guardrails?: string[];
  claims?: AnalysisClaim[];
  fundamental: FundamentalAnalysis;
  sentiment: SentimentAnalysis;
  market_intel: MarketIntelAnalysis | null;
  protocol: ProtocolEntry[];
  findings: StructuredFinding[];
}

interface ValuationContext {
  businessDrivers: BusinessDriverAnalysis;
  companyTypeClassification: CompanyTypeClassification;
  modelSelection: ModelSelectionOutput;
  modelSelectionPlan: ModelSelectionPlan;
  analystConsensusRange: ValuationRange | null;
  modelValuationRange: ValuationRange | null;
  dcfValuationRange: ValuationRange | null;
  dcfScenarios: DcfScenariosOutput | null;
  dcfPlausibility: DcfPlausibilityOutput | null;
  reverseDcfPlausibility: ReverseDcfPlausibilityOutput | null;
  valuationDivergenceAnalysis: ValuationDivergenceOutput | null;
  thesisChangeTriggers: ThesisChangeTriggers;
  confidenceBreakdown: AnalysisConfidenceBreakdown;
  analysisDebug: AnalysisDebugSnapshot;
  /** Always defined — status field encodes all edge cases. */
  valuationDivergence: DivergenceResult;
  /** Current price in USD — needed by V6 safety-net and divergence upside display. */
  currentPriceUsd: number | null;
  alphaFramework: AlphaFrameworkOutput | null;
  structuredSynthesisInput: StructuredSynthesisInput;
  specializedValuations: SpecializedValuations;
  growthOutlookSeed: string;
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

function clampFiveConfidence(n: number): AnalysisConfidenceBreakdown["finalRatingConfidence"] {
  const rounded = Math.round(n);
  if (rounded >= 5) return 5;
  if (rounded >= 4) return 4;
  if (rounded >= 3) return 3;
  if (rounded >= 2) return 2;
  return 1;
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

async function captureOptionalFetch<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<OptionalFetchResult<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    return {
      data: fallback,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeSynthesisFromUnknown(raw: unknown, fallbackCurrency: string): SynthesisResult {
  const normalized = normalizeSynthesisForSchema(raw);
  logSynthesisNormalizationEvents(normalized.events);
  const parsed = SynthesisOutputSchema.parse(normalized.value);
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
  const growthOutlook = parsed.growth_outlook?.trim()
    || parsed.time_horizon_view?.long_term?.trim()
    || parsed.time_horizon_view?.medium_term?.trim()
    || DEFAULT_GROWTH_OUTLOOK;

  return {
    recommendation: parsed.recommendation,
    conviction: parsed.conviction,
    summary: parsed.summary,
    bull_case: parsed.bull_case,
    bear_case: parsed.bear_case,
    growth_outlook: growthOutlook,
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

function extractToolInput<T>(content: Anthropic.Messages.ContentBlock[], toolName: string): T | null {
  const toolUse = content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use" && block.name === toolName,
  );
  return toolUse ? toolUse.input as T : null;
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
  if (collectEnglishVisibleTextLeaks(result).length > 0) {
    issues.push({ severity: "blocker", message: "Synthese enthält englische nutzersichtbare Textfelder." });
  }

  return issues;
}

function assertSynthesisQuality(result: SynthesisResult, source: string): void {
  const blockers = getSynthesisQualityIssues(result).filter(issue => issue.severity === "blocker");
  if (blockers.length) {
    throw new Error(`${source} quality gate failed: ${blockers.map(i => i.message).join(" ")}`);
  }
}

type VisibleTextCandidate = { path: string; text: string };

function collectVisibleSynthesisTexts(result: Pick<SynthesisResult, "summary" | "bull_case" | "bear_case" | "growth_outlook"> & Partial<SynthesisResult>): VisibleTextCandidate[] {
  const items: VisibleTextCandidate[] = [];
  const add = (path: string, value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) {
      items.push({ path, text: value.trim() });
    }
  };
  add("summary", result.summary);
  add("growth_outlook", result.growth_outlook);
  result.bull_case?.forEach((value, index) => add(`bull_case.${index}`, value));
  result.bear_case?.forEach((value, index) => add(`bear_case.${index}`, value));
  add("time_horizon_view.short_term", result.time_horizon_view?.short_term);
  add("time_horizon_view.medium_term", result.time_horizon_view?.medium_term);
  add("time_horizon_view.long_term", result.time_horizon_view?.long_term);
  add("entry_quality.rationale", result.entry_quality?.rationale);
  add("valuation_range.rationale", result.valuation_range?.rationale);
  result.data_quality_guardrails?.forEach((value, index) => add(`data_quality_guardrails.${index}`, value));
  result.claims?.forEach((claim, index) => {
    add(`claims.${index}.claim`, claim.claim);
    add(`claims.${index}.evidence`, claim.evidence);
  });
  return items;
}

function looksLikeEnglishVisibleText(text: string): boolean {
  const lower = text.toLowerCase();
  const hardMarkers = [
    "insufficient reliable data",
    "high-conviction growth outlook",
    "analysis could not",
    "could not be created",
    "not available",
    "growth outlook",
    "valuation confidence",
    "fair value range",
    "current price",
    "revenue growth",
    "free cash flow",
    "market sentiment",
  ];
  if (hardMarkers.some(marker => lower.includes(marker))) return true;

  const englishTokens = lower.match(/\b(the|and|with|without|because|growth|risk|market|valuation|company|stock|data|revenue|margin|cash|flow|outlook|investment|confidence|available)\b/g)?.length ?? 0;
  const germanTokens = lower.match(/\b(und|mit|ohne|weil|wachstum|risiko|markt|bewertung|unternehmen|aktie|daten|umsatz|marge|cashflow|ausblick|investition|konfidenz|verfügbar|nicht)\b/g)?.length ?? 0;

  return text.length > 80 && englishTokens >= 6 && englishTokens > germanTokens * 2;
}

function collectEnglishVisibleTextLeaks(result: Pick<SynthesisResult, "summary" | "bull_case" | "bear_case" | "growth_outlook"> & Partial<SynthesisResult>): VisibleTextCandidate[] {
  return collectVisibleSynthesisTexts(result).filter(item => looksLikeEnglishVisibleText(item.text));
}

async function repairGermanLanguageIfNeeded(
  rawCandidate: unknown,
  parsed: SynthesisResult,
  fallbackCurrency: string,
): Promise<SynthesisResult> {
  const leaks = collectEnglishVisibleTextLeaks(parsed);
  if (leaks.length === 0) return parsed;
  const repaired = await repairGermanVisibleText(
    rawCandidate,
    process.env.ANTHROPIC_API_KEY ?? "",
  );
  const repairedParsed = normalizeSynthesisFromUnknown(repaired, fallbackCurrency);
  assertSynthesisQuality(repairedParsed, "Sprach-Repair");
  return repairedParsed;
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
  if (s.pe_ratio != null && s.free_cashflow != null && (dataQuality?.completeness_score ?? 100) >= 85) return "high";
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
    guardrails.push("Datenbasis lückenhaft: als Datenprovider-/Ingestion-Limitation behandeln, präzise Kursziele vermeiden und nur Szenario-Spannen verwenden.");
  }
  if (dataQuality.missing_fields.length) {
    guardrails.push(`Fehlende Providerdaten: ${dataQuality.missing_fields.slice(0, 4).join(", ")}. Nicht als operatives Unternehmensrisiko werten.`);
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
      confidence: Math.min(4, Math.ceil(result.conviction / 2)),
    },
    {
      claim: `Entry Quality: ${entry.label}`,
      evidence: `RSI ${s.rsi?.toFixed(1) ?? "N/A"}, Kurs ${s.price?.toFixed(2) ?? "N/A"}, MA50 ${s.moving_average_50?.toFixed(2) ?? "N/A"}, MA200 ${s.moving_average_200?.toFixed(2) ?? "N/A"}.`,
      source_type: "metrics",
      confidence: 4,
    },
    {
      claim: `Bewertungskonfidenz: ${valuationConfidence}`,
      evidence: "Ergibt sich aus Datenvollständigkeit, Analysten-Konsens und verfügbaren Bewertungskennzahlen.",
      source_type: "inference",
      confidence: valuationConfidence === "high" ? 4 : valuationConfidence === "medium" ? 3 : 2,
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
  source: FxSource;
  asOf: string;
}

async function fetchFxContext(): Promise<FxContext> {
  // Quellen-Kaskade (yfinance → EZB → Cache → Fallback) liegt zentral in @/lib/fx.
  return getEurUsd();
}

function enrichRawValuationRange(raw: RawValuationRange | null, fx: FxContext): ValuationRange | null {
  if (!raw || !hasAnyRangeValue(raw)) return null;
  const native = {
    bear: roundMoney(raw.bear),
    base: roundMoney(raw.base),
    bull: roundMoney(raw.bull),
  };
  const currency = normalizeCurrency(raw.currency);
  return {
    currency,
    bear: native.bear,
    base: native.base,
    bull: native.bull,
    rationale: raw.rationale,
    source: raw.source,
    confidence: raw.confidence,
    methods: raw.methods,
    limitations: raw.limitations,
    usd: convertRange(native, currency, "USD", fx.eurUsd),
    eur: convertRange(native, currency, "EUR", fx.eurUsd),
    fx_rate_eur_usd: fx.eurUsd,
    fx_rate_source: fx.source,
    fx_rate_as_of: fx.asOf,
  };
}

/** Extract USD-denominated base/bear/bull from an enriched ValuationRange. */
function getUsdMoneyRange(range: ValuationRange | null): { bear: number | null; base: number | null; bull: number | null } | null {
  if (!range) return null;
  if (range.usd) return range.usd;
  if (range.currency === "USD") return { bear: range.bear, base: range.base, bull: range.bull };
  return null;
}

function buildDcfValuationRange(
  scenarios: DcfScenariosOutput,
  currency: string,
  fx: FxContext,
): ValuationRange {
  const eurUsd = fx.eurUsd;
  const toEur = (v: number | null) => (v != null && currency === "USD" ? v / eurUsd : null);
  const toUsd = (v: number | null) => (v != null && currency === "EUR" ? v * eurUsd : null);

  const bear = scenarios.bear.fairValuePerShare;
  const base = scenarios.base.fairValuePerShare;
  const bull = scenarios.bull.fairValuePerShare;

  const usdRange: MoneyRange = currency === "USD"
    ? { bear, base, bull }
    : { bear: toUsd(bear), base: toUsd(base), bull: toUsd(bull) };
  const eurRange: MoneyRange = currency === "EUR"
    ? { bear, base, bull }
    : { bear: toEur(bear), base: toEur(base), bull: toEur(bull) };

  const allLimitations = Array.from(new Set(scenarios.limitations));

  const a = scenarios.base.assumptions;
  const tv = scenarios.base.terminalValue;
  const pvTv = scenarios.base.presentValueOfTerminalValue;
  const ev = scenarios.base.enterpriseValue;
  const rationale = `FCFF-DCF · WACC ${(a.wacc * 100).toFixed(1)}% · Terminales Wachstum ${(a.terminalGrowthRate * 100).toFixed(1)}% · Op.-Marge ${(a.operatingMarginRates[0] * 100).toFixed(0)}% (Sektortemplate) · Terminal Value ${(tv / 1e9).toFixed(0)} Mrd. / PV(TV) ${(pvTv / 1e9).toFixed(0)} Mrd. · EV ${(ev / 1e9).toFixed(0)} Mrd. · Nettoverschuldung mit 0 angenähert.`;

  return {
    currency,
    bear,
    base,
    bull,
    rationale,
    source: "dcf",
    confidence: "medium",
    methods: ["FCFF DCF", "WACC-Sektortemplates", "Gordon Growth Terminal Value"],
    limitations: allLimitations,
    usd: usdRange,
    eur: eurRange,
    fx_rate_eur_usd: fx.eurUsd,
    fx_rate_source: fx.source,
    fx_rate_as_of: fx.asOf,
  };
}

function estimateTtmRevenue(facts: EdgarFacts | null): number | null {
  if (!facts || facts.revenue.length < 4) return null;
  const total = facts.revenue.slice(0, 4).reduce((sum, row) => sum + row.value, 0);
  return total > 0 ? total : null;
}

function ratioToPct(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function deriveSharesOutstanding(snapshot: AssetSnapshot): number | undefined {
  if (
    snapshot.market_cap != null &&
    snapshot.price != null &&
    Number.isFinite(snapshot.market_cap) &&
    Number.isFinite(snapshot.price) &&
    snapshot.market_cap > 0 &&
    snapshot.price > 0
  ) {
    return snapshot.market_cap / snapshot.price;
  }
  return undefined;
}

function deriveFcfMarginPct(snapshot: AssetSnapshot, ttmRevenue: number | null): number | undefined {
  if (
    snapshot.free_cashflow != null &&
    ttmRevenue != null &&
    Number.isFinite(snapshot.free_cashflow) &&
    Number.isFinite(ttmRevenue) &&
    ttmRevenue > 0
  ) {
    return snapshot.free_cashflow / ttmRevenue * 100;
  }
  return undefined;
}

function mentionsAi(text: string): boolean {
  return /\b(ai|artificial intelligence|machine learning|gpu|accelerator|data center|datacenter|hyperscaler|neural|llm)\b/i.test(text);
}

function formatGrowthPct(value: number | undefined): string {
  return value == null ? "nicht verfügbar" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatBigCurrency(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "nicht verfügbar";
  const abs = Math.abs(value);
  const unit = abs >= 1e12
    ? `${(value / 1e12).toFixed(2)} Bio.`
    : abs >= 1e9
      ? `${(value / 1e9).toFixed(2)} Mrd.`
      : abs >= 1e6
        ? `${(value / 1e6).toFixed(2)} Mio.`
        : value.toFixed(0);
  return `${unit} ${currency ?? "USD"}`;
}

function buildGrowthOutlookSeed(input: {
  symbol: string;
  snapshot: AssetSnapshot;
  businessDrivers: BusinessDriverAnalysis;
  structuredSynthesisInput: StructuredSynthesisInput;
  dataQuality: DianaQualityReport | null | undefined;
  revenueGrowthPct?: number;
  fcfMarginPct?: number;
  ttmRevenue: number | null;
  dcfScenarios: DcfScenariosOutput | null;
  specializedValuations: SpecializedValuations;
}): string {
  const sectorBrief = input.structuredSynthesisInput.sectorBrief;
  const growthDrivers = sectorBrief.growthDrivers.slice(0, 4);
  const riskDrivers = sectorBrief.riskDrivers.slice(0, 3);
  const keyMetrics = sectorBrief.keyMetricsToWatch.slice(0, 5);
  const dcfGrowth = input.dcfScenarios?.base.assumptions.revenueGrowthRates[0];
  const aiOverlay = input.specializedValuations.aiExposureNarrative;
  const aiLine = aiOverlay && aiOverlay.status === "success"
    ? `AI-Overlay: ${aiOverlay.classification.exposureLevel} Exposure, Monetarisierung ${aiOverlay.classification.monetizationStage}, Narrative-Risiko ${aiOverlay.scores.narrativeRiskScore}/100.`
    : null;
  const dataQualityLine = input.dataQuality
    ? `Datenqualität: ${input.dataQuality.completeness_score}/100, Conviction-Cap ${input.dataQuality.analysis_confidence_cap}/10, fehlende Providerdaten: ${input.dataQuality.missing_fields.join(", ") || "keine"}.`
    : "Datenqualität: kein Diana-Report verfügbar; Aussagen vorsichtig formulieren.";

  return [
    `Deutscher Wachstumsausblick-Seed für ${input.symbol}: Nutze diesen Seed als Mindestinhalt, aber schreibe daraus einen flüssigen deutschen Absatz.`,
    `Aktuelle Wachstumsdaten: Umsatzwachstum ${formatGrowthPct(input.revenueGrowthPct)}, TTM-Umsatz ${formatBigCurrency(input.ttmRevenue, input.snapshot.currency)}, Free Cashflow ${formatBigCurrency(input.snapshot.free_cashflow, input.snapshot.currency)}, FCF-Marge ${formatGrowthPct(input.fcfMarginPct)}.`,
    dcfGrowth != null ? `DCF-Basisannahme Jahr 1: Umsatzwachstum ${(dcfGrowth * 100).toFixed(1)}%; nicht als Garantie formulieren.` : null,
    `Sektor-/Unternehmenstyp: ${sectorBrief.sectorFamily}; Treiber: ${growthDrivers.join(" | ") || input.businessDrivers.revenue_drivers.slice(0, 3).map(d => d.driver).join(" | ") || "nicht ausreichend spezifiziert"}.`,
    `Wichtige Risiken für den Wachstumsausblick: ${riskDrivers.join(" | ") || input.businessDrivers.red_flags.slice(0, 3).join(" | ") || "Datenlage begrenzt"}.`,
    `Zu beobachtende Kennzahlen: ${keyMetrics.join(" | ") || input.businessDrivers.sector_specific_kpis.slice(0, 5).join(" | ") || "Umsatzwachstum, Margen, Free Cashflow"}.`,
    aiLine,
    dataQualityLine,
    "Formuliere keinen englischen Fallback. Wenn die Daten dünn sind, schreibe auf Deutsch, welche Wachstumstreiber plausibel sind und warum die Konfidenz begrenzt bleibt.",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function buildValuationContext(
  symbol: string,
  snapshot: AssetSnapshot,
  analystData: AnalystData | null,
  dataQuality: DianaQualityReport | null | undefined,
  fx: FxContext,
  edgarFacts: EdgarFacts | null = null,
): ValuationContext {
  const businessDrivers = buildBusinessDriverAnalysis(symbol, snapshot);
  const analystConsensusRange = enrichRawValuationRange(
    buildAnalystConsensusValuation(analystData),
    fx,
  );
  const modelValuationRange = enrichRawValuationRange(
    buildOwnModelValuation(snapshot, businessDrivers, dataQuality),
    fx,
  );

  // DCF scenarios — deterministic, no LLM
  const dcfScenarios = computeDcfScenarios(snapshot, edgarFacts, businessDrivers.sector_template);
  const dcfValuationRange = dcfScenarios
    ? buildDcfValuationRange(dcfScenarios, snapshot.currency ?? "USD", fx)
    : null;

  const alphaFramework = calculateAlphaFramework({
    snapshot,
    edgarFacts,
    analystData,
    sectorTemplate: businessDrivers.sector_template,
    dataQuality: dataQuality ?? null,
  });

  const ttmRevenue = estimateTtmRevenue(edgarFacts);
  const derivedSharesOutstanding = deriveSharesOutstanding(snapshot);
  const revenueGrowthPct = ratioToPct(snapshot.revenue_growth);
  const fcfMarginPct = deriveFcfMarginPct(snapshot, ttmRevenue);
  const descriptionText = [
    snapshot.description ?? "",
    businessDrivers.business_model_type,
    businessDrivers.secondary_types.join(" "),
    businessDrivers.sector_specific_kpis.join(" "),
  ].join(" ");
  const companyTypeClassification = routeCompanyType({
    sectorTemplate: businessDrivers.sector_template,
    description: descriptionText,
    revenueGrowth: snapshot.revenue_growth,
    fcfMargin: ttmRevenue && snapshot.free_cashflow != null ? snapshot.free_cashflow / ttmRevenue : null,
    debtToEquity: snapshot.debt_to_equity,
    peRatio: snapshot.pe_ratio,
    freeCashFlow: snapshot.free_cashflow,
    marketCap: snapshot.market_cap,
    hasDurableFcf: snapshot.free_cashflow != null ? snapshot.free_cashflow > 0 : null,
    segmentDataAvailable: false,
    alpha: {
      qualityScore: alphaFramework.quality.score,
      moatScore: alphaFramework.moat.score,
      riskScore: alphaFramework.risk.score,
      valuationScore: alphaFramework.relativeValuation.score,
    },
  });
  const modelSelection = selectValuationModels(companyTypeClassification, {
    hasSegmentData: false,
    hasStressCase: false,
    hasBookValueData: false,
    hasNavData: false,
    hasNormalizedCycleData: false,
  });

  // Current price converted to USD for upside calculations
  const priceUsd: number | null =
    snapshot.price != null
      ? snapshot.currency === "EUR"
        ? snapshot.price * fx.eurUsd
        : snapshot.currency === "USD" || !snapshot.currency
        ? snapshot.price
        : null // unknown currency — skip conversion
      : null;

  const consensusUsd = getUsdMoneyRange(analystConsensusRange);
  const modelUsd = getUsdMoneyRange(modelValuationRange);
  const dcfUsd = getUsdMoneyRange(dcfValuationRange);

  const dcfPlausibility = dcfScenarios
    ? evaluateDcfPlausibility({
        companyType: companyTypeClassification,
        dcf: dcfScenarios.base,
        currentPrice: snapshot.price ?? null,
        analystConsensusFairValue: analystConsensusRange?.base ?? null,
        ownModelFairValue: modelValuationRange?.base ?? null,
        hasSegmentData: false,
        hasWorkingCapitalStress: false,
        hasNormalizedMargins: false,
        limitations: dcfValuationRange?.limitations ?? [],
      })
    : null;

  const baseGrowthAssumption = dcfScenarios?.base.assumptions.revenueGrowthRates[0] ?? snapshot.revenue_growth ?? null;
  const reverseDcfPlausibility = alphaFramework.reverseDcf
    ? evaluateReverseDcfPlausibility({
        reverseDcf: alphaFramework.reverseDcf,
        baseDcfFairValue: dcfValuationRange?.base ?? null,
        baseGrowthAssumption,
        currentPrice: snapshot.price ?? null,
      })
    : null;

  const valuationDivergence = buildValuationDivergence({
    currentPrice: priceUsd ?? undefined,
    analystConsensus: analystConsensusRange
      ? {
          bear: consensusUsd?.bear ?? null,
          base: consensusUsd?.base ?? null,
          bull: consensusUsd?.bull ?? null,
          source: "structured_consensus",
          available: true,
        }
      : { available: false },
    ownModel: modelValuationRange
      ? {
          bear: modelUsd?.bear ?? null,
          base: modelUsd?.base ?? null,
          bull: modelUsd?.bull ?? null,
          confidence: modelValuationRange.confidence ?? undefined,
          method: modelValuationRange.methods ?? [],
          available: true,
        }
      : { available: false },
  });

  const valuationDivergenceAnalysis = analyzeValuationDivergence({
    companyType: companyTypeClassification,
    modelSelection,
    currentPrice: priceUsd,
    ownModel: modelUsd,
    dcf: dcfUsd,
    analystConsensus: consensusUsd,
    dcfPlausibility,
    reverseDcfPlausibility,
    relativeValuationScore: alphaFramework.relativeValuation.score,
    alphaValuationScore: alphaFramework.alphaScore,
  });

  // Build model selection plan (deterministic, no LLM)
  const availableModelInputs = detectAvailableModelInputs({
    financials: {
      price: snapshot.price,
      market_cap: snapshot.market_cap,
      revenue: ttmRevenue,
      free_cashflow: snapshot.free_cashflow,
      fcfMargin: fcfMarginPct,
      revenue_growth: snapshot.revenue_growth,
      pe_ratio: snapshot.pe_ratio,
      debt_to_equity: snapshot.debt_to_equity,
      sharesOutstanding: derivedSharesOutstanding,
    },
    marketData: { price: snapshot.price, market_cap: snapshot.market_cap },
    analystData: analystData ?? undefined,
    companyProfile: {
      sector: businessDrivers.sector_template,
      industry: businessDrivers.business_model_type,
      description: descriptionText,
    },
    existingOutputs: {
      quality_score: alphaFramework.quality,
      moat_score: alphaFramework.moat,
      capital_allocation_score: alphaFramework.capitalAllocation,
      momentum_score: alphaFramework.momentum,
      revision_momentum: alphaFramework.revisionMomentum,
      risk_score: alphaFramework.risk,
      relative_valuation: alphaFramework.relativeValuation,
      reverse_dcf: alphaFramework.reverseDcf,
      ...(dcfScenarios ? { dcf_scenarios: dcfScenarios } : {}),
      ...(dcfPlausibility ? { dcf_plausibility: dcfPlausibility } : {}),
      ...(reverseDcfPlausibility ? { reverse_dcf_plausibility: reverseDcfPlausibility } : {}),
      ...(valuationDivergenceAnalysis ? { valuation_divergence: valuationDivergenceAnalysis } : {}),
    },
  });

  const modelSelectionPlan = buildModelSelectionPlan({
    companyType: companyTypeClassification,
    availableInputs: availableModelInputs,
    existingOutputs: {
      quality_score: alphaFramework.quality,
      moat_score: alphaFramework.moat,
      capital_allocation_score: alphaFramework.capitalAllocation,
      momentum_score: alphaFramework.momentum,
      revision_momentum: alphaFramework.revisionMomentum,
      risk_score: alphaFramework.risk,
      relative_valuation: alphaFramework.relativeValuation,
      reverse_dcf: alphaFramework.reverseDcf,
      ...(dcfScenarios ? { dcf_scenarios: dcfScenarios } : {}),
      ...(dcfPlausibility ? { dcf_plausibility: dcfPlausibility } : {}),
      ...(reverseDcfPlausibility ? { reverse_dcf_plausibility: reverseDcfPlausibility } : {}),
      ...(valuationDivergenceAnalysis ? { valuation_divergence: valuationDivergenceAnalysis } : {}),
    },
  });

  // Build structured synthesis input (deterministic, no LLM)
  const thesisChangeTriggersPre = buildThesisChangeTriggers({
    companyTypeClassification,
    modelSelection,
  });
  const structuredSynthesisInput = buildStructuredSynthesisInput({
    ticker: symbol,
    sector: businessDrivers.sector_template,
    companyType: companyTypeClassification,
    modelSelectionPlan,
    valuation: {
      analystConsensus: analystConsensusRange
        ? `${analystConsensusRange.currency} Base ${analystConsensusRange.base ?? "N/A"}`
        : null,
      ownModel: modelValuationRange
        ? `${modelValuationRange.currency} Base ${modelValuationRange.base ?? "N/A"}`
        : null,
      dcf: dcfValuationRange
        ? `${dcfValuationRange.currency} Base ${dcfValuationRange.base ?? "N/A"}`
        : null,
      divergenceStatus: valuationDivergence.status,
    },
    alphaFramework: alphaFramework
      ? {
          alphaScore: alphaFramework.alphaScore,
          qualityScore: alphaFramework.quality.score,
          moatScore: alphaFramework.moat.score,
          riskScore: alphaFramework.risk.score,
        }
      : null,
    currentPrice: snapshot.price ?? undefined,
    guardrailsTriggered: [],
    thesisChangeTriggers: thesisChangeTriggersPre,
  });

  const structuredSynthesisDebug: StructuredSynthesisDebug = {
    sectorFamily: structuredSynthesisInput.sectorBrief.sectorFamily,
    primaryValuationLogic: structuredSynthesisInput.sectorBrief.primaryValuationLogic,
    weakValuationMethods: structuredSynthesisInput.sectorBrief.weakValuationMethods,
    growthDrivers: structuredSynthesisInput.sectorBrief.growthDrivers,
    riskDrivers: structuredSynthesisInput.sectorBrief.riskDrivers,
    keyMetricsToWatch: structuredSynthesisInput.sectorBrief.keyMetricsToWatch,
    synthesisWarnings: structuredSynthesisInput.sectorBrief.synthesisWarnings,
    requiredDisclosures: structuredSynthesisInput.sectorBrief.requiredDisclosures,
    modelSelectionSummary: structuredSynthesisInput.modelSelectionSummary,
  };

  // Run specialized deterministic models based on company type
  const primaryType = companyTypeClassification.primaryType;
  const specializedValuations: SpecializedValuations = {};

  if (primaryType === "reit") {
    specializedValuations.reitAffoNav = runReitAffoNav({
      currentPrice: snapshot.price ?? undefined,
      // Per-share values not available in snapshot — model returns not_run_missing_inputs
    });
  }

  if (primaryType === "financial") {
    specializedValuations.bankValuation = runBankValuation({
      currentPrice: snapshot.price ?? undefined,
      // TBV/BV not available in snapshot — model returns not_run_missing_inputs
    });
  }

  if (primaryType === "commodity_cyclical") {
    specializedValuations.commodityEnergyMidcycle = runCommodityEnergyMidcycle({
      currentPrice: snapshot.price ?? undefined,
      freeCashFlow: snapshot.free_cashflow ?? undefined,
      marketCap: snapshot.market_cap ?? undefined,
    });
  }

  if (primaryType === "platform_conglomerate") {
    specializedValuations.platformSotp = runPlatformSotp({
      ticker: symbol,
      currentPrice: snapshot.price ?? undefined,
      marketCap: snapshot.market_cap ?? undefined,
      sharesOutstanding: derivedSharesOutstanding,
      segments: [],
    });
  }

  if (primaryType === "cyclical_hardware") {
    specializedValuations.cyclicalHardwareNormalized = runCyclicalHardwareNormalized({
      ticker: symbol,
      currentPrice: snapshot.price ?? undefined,
      marketCap: snapshot.market_cap ?? undefined,
      sharesOutstanding: derivedSharesOutstanding,
      revenue: ttmRevenue ?? undefined,
      freeCashFlow: snapshot.free_cashflow ?? undefined,
      revenueGrowthPct,
    });
    specializedValuations.semiconductorCycle = runSemiconductorCycle({
      ticker: symbol,
      currentPrice: snapshot.price ?? undefined,
      marketCap: snapshot.market_cap ?? undefined,
      sharesOutstanding: derivedSharesOutstanding,
      revenue: ttmRevenue ?? undefined,
      revenueGrowthPct,
      freeCashFlow: snapshot.free_cashflow ?? undefined,
      pe: snapshot.pe_ratio ?? undefined,
    });
  }

  if (primaryType === "hypergrowth_software") {
    specializedValuations.softwareRuleOf40 = runSoftwareRuleOf40({
      ticker: symbol,
      currentPrice: snapshot.price ?? undefined,
      marketCap: snapshot.market_cap ?? undefined,
      revenue: ttmRevenue ?? undefined,
      revenueGrowthPct,
      freeCashFlowMarginPct: fcfMarginPct,
    });
  }

  specializedValuations.aiExposureNarrative = runAiExposureNarrativeScore({
    ticker: symbol,
    sector: businessDrivers.sector_template,
    industry: businessDrivers.business_model_type,
    companyDescription: descriptionText,
    revenueGrowthPct,
    freeCashFlowMarginPct: fcfMarginPct,
    marketCap: snapshot.market_cap ?? undefined,
    mentionsAiInDescription: mentionsAi(descriptionText),
  });

  const growthOutlookSeed = buildGrowthOutlookSeed({
    symbol,
    snapshot,
    businessDrivers,
    structuredSynthesisInput,
    dataQuality,
    revenueGrowthPct,
    fcfMarginPct,
    ttmRevenue,
    dcfScenarios,
    specializedValuations,
  });

  const explainabilityInput = {
    ticker: symbol,
    companyTypeClassification,
    modelSelection,
    modelSelectionPlan,
    structuredSynthesisInput: structuredSynthesisDebug,
    specializedValuations,
    dcfPlausibility,
    reverseDcfPlausibility,
    valuationDivergenceAnalysis,
    alphaFramework,
    dataQuality: dataQuality ?? null,
    currentPrice: snapshot.price,
    rsi: snapshot.rsi,
    movingAverage50: snapshot.moving_average_50,
    movingAverage200: snapshot.moving_average_200,
  };
  const thesisChangeTriggers = buildThesisChangeTriggers(explainabilityInput);
  const confidenceBreakdown = buildConfidenceBreakdown(explainabilityInput);
  const analysisDebug = buildAnalysisDebugSnapshot(explainabilityInput);

  return {
    businessDrivers,
    companyTypeClassification,
    modelSelection,
    modelSelectionPlan,
    structuredSynthesisInput,
    specializedValuations,
    analystConsensusRange,
    modelValuationRange,
    dcfValuationRange,
    dcfScenarios,
    dcfPlausibility,
    reverseDcfPlausibility,
    valuationDivergenceAnalysis,
    thesisChangeTriggers,
    confidenceBreakdown,
    analysisDebug,
    valuationDivergence,
    currentPriceUsd: priceUsd,
    alphaFramework,
    growthOutlookSeed,
  };
}

function formatRangeForPrompt(range: ValuationRange | null): string {
  if (!range) return "nicht verfügbar";
  const usd = range.usd ?? (range.currency === "USD" ? range : null);
  const native = `${range.currency} Bear ${range.bear ?? "N/A"} / Base ${range.base ?? "N/A"} / Bull ${range.bull ?? "N/A"}`;
  const usdLine = usd && range.currency !== "USD"
    ? ` | USD Bear ${usd.bear ?? "N/A"} / Base ${usd.base ?? "N/A"} / Bull ${usd.bull ?? "N/A"}`
    : "";
  const methods = range.methods?.length ? ` | Methoden: ${range.methods.join(", ")}` : "";
  const confidence = range.confidence ? ` | Konfidenz: ${range.confidence}` : "";
  return `${native}${usdLine}${confidence}${methods}. ${range.rationale}`;
}

function formatBusinessDriversForPrompt(drivers: BusinessDriverAnalysis): string {
  const fmtDrivers = (items: ValueDriver[]) => items.slice(0, 3)
    .map(item => `- ${item.driver}: ${item.why_it_matters} (KPIs: ${item.metrics.slice(0, 3).join(", ")})`)
    .join("\n");

  return [
    `Unternehmenstyp: ${drivers.business_model_type}`,
    `Template: ${drivers.sector_template} · Konfidenz: ${drivers.classification_confidence}`,
    drivers.secondary_types.length ? `Sekundärtypen: ${drivers.secondary_types.join(", ")}` : "",
    drivers.classification_reasoning.length ? `Klassifizierung: ${drivers.classification_reasoning.join(" | ")}` : "",
    "Umsatztreiber:",
    fmtDrivers(drivers.revenue_drivers),
    "Margentreiber:",
    fmtDrivers(drivers.margin_drivers),
    "Cashflow-Treiber:",
    fmtDrivers(drivers.cash_flow_drivers),
    `Bewertungsmethoden: ${drivers.model_instructions.valuation_methods.join(", ")}`,
    `Red Flags: ${drivers.red_flags.slice(0, 4).join(" | ")}`,
  ].filter(Boolean).join("\n");
}

function formatModelFitForPrompt(ctx: ValuationContext): string {
  const models = ctx.modelSelection.recommendedModels
    .slice(0, 4)
    .map(model => `- ${model.model}: ${model.fit}, Konfidenz ${model.confidence}/5. ${model.reason}`)
    .join("\n");
  const dcf = ctx.dcfPlausibility
    ? `DCF-Fit: ${ctx.dcfPlausibility.fit}, Konfidenz ${ctx.dcfPlausibility.confidence}/5${ctx.dcfPlausibility.warnings.length ? ` · Warnungen: ${ctx.dcfPlausibility.warnings.join(" | ")}` : ""}`
    : "DCF-Fit: nicht verfügbar";
  const reverseDcf = ctx.reverseDcfPlausibility
    ? `Reverse DCF: ${ctx.reverseDcfPlausibility.status}, Konfidenz ${ctx.reverseDcfPlausibility.confidence}/5${ctx.reverseDcfPlausibility.warnings.length ? ` · Warnungen: ${ctx.reverseDcfPlausibility.warnings.join(" | ")}` : ""}`
    : "Reverse DCF: nicht verfügbar";
  const divergence = ctx.valuationDivergenceAnalysis
    ? `Divergenz-Analyzer: ${ctx.valuationDivergenceAnalysis.divergenceLevel}, Konfidenz ${ctx.valuationDivergenceAnalysis.confidence}/5. ${ctx.valuationDivergenceAnalysis.summary}${ctx.valuationDivergenceAnalysis.ratingImpact.avoidHardBuySell ? " · Harte Buy/Sell-Ratings vermeiden." : ""}`
    : "Divergenz-Analyzer: nicht verfügbar";

  return [
    `Deterministischer Unternehmenstyp: ${ctx.companyTypeClassification.primaryType} · Konfidenz ${ctx.companyTypeClassification.confidence}/5`,
    ctx.companyTypeClassification.secondaryTypes.length ? `Sekundärtypen: ${ctx.companyTypeClassification.secondaryTypes.join(", ")}` : "",
    `Rationale: ${ctx.companyTypeClassification.rationale}`,
    `Primäres Bewertungsmodell: ${ctx.modelSelection.primaryValuationModel.model} (${ctx.modelSelection.primaryValuationModel.fit}, Konfidenz ${ctx.modelSelection.primaryValuationModel.confidence}/5)`,
    ctx.modelSelection.warnings.length ? `Model-Selection-Warnungen: ${ctx.modelSelection.warnings.join(" | ")}` : "",
    "Empfohlene Bewertungsmodelle:",
    models,
    dcf,
    reverseDcf,
    divergence,
  ].filter(Boolean).join("\n");
}

function formatThesisChangeTriggersForPrompt(triggers: ThesisChangeTriggers): string {
  return [
    `Bullishe Trigger: ${triggers.bullishTriggers.join(" | ")}`,
    `Bearishe Trigger: ${triggers.bearishTriggers.join(" | ")}`,
    `Zu beobachtende Kennzahlen: ${triggers.keyMetricsToWatch.join(" | ")}`,
  ].join("\n");
}

function formatConfidenceBreakdownForPrompt(confidence: AnalysisConfidenceBreakdown): string {
  return [
    `Daten: ${confidence.dataConfidence}/5`,
    `Bewertung: ${confidence.valuationConfidence}/5`,
    `Business-Qualität: ${confidence.businessQualityConfidence}/5`,
    `Timing: ${confidence.timingConfidence}/5`,
    `Finales Rating: ${confidence.finalRatingConfidence}/5`,
    confidence.reasons.length ? `Gründe: ${confidence.reasons.join(" | ")}` : "",
  ].filter(Boolean).join("\n");
}

function completeResearchFields(
  raw: SynthesisResult,
  s: AssetSnapshot,
  marketIntel: MarketIntelAnalysis | null,
  analystData: AnalystData | null,
  dataQuality: DianaQualityReport | null | undefined,
  fx: FxContext,
  valuationContext: ValuationContext,
): SynthesisResult {
  const thesis = raw.thesis_type ?? inferThesisType(s, marketIntel);
  const entry = raw.entry_quality ?? inferEntryQuality(s);
  const valuationConfidence =
    valuationContext.modelValuationRange?.confidence ??
    raw.valuation_confidence ??
    inferValuationConfidence(s, analystData, dataQuality);
  const guardrails = [
    ...(raw.data_quality_guardrails ?? []),
    ...buildDataQualityGuardrails(dataQuality, valuationConfidence),
    ...(valuationContext.modelValuationRange?.limitations ?? []),
    ...(!valuationContext.modelValuationRange && valuationContext.analystConsensusRange
      ? ["Kein belastbares eigenes Modell: Analystenkonsens nur als Marktmeinung anzeigen."]
      : []),
  ].filter((item, index, arr) => item.trim() && arr.indexOf(item) === index);

  const timeHorizon = raw.time_horizon_view ?? buildDefaultTimeHorizonView(s, entry, thesis);
  const synthesisRange = buildValuationRange(
    raw.valuation_range ?? null,
    s,
    null,
    null,
    valuationConfidence,
    fx,
  );
  const valuationRange =
    valuationContext.modelValuationRange ??
    synthesisRange ??
    valuationContext.analystConsensusRange;

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
      confidence: normalizeClaimConfidenceValue(claim.confidence),
    }));

  return {
    ...raw,
    thesis_type: thesis,
    time_horizon_view: timeHorizon,
    entry_quality: entry,
    valuation_confidence: valuationConfidence,
    valuation_range: valuationRange,
    analyst_consensus_range: valuationContext.analystConsensusRange,
    model_valuation_range: valuationContext.modelValuationRange,
    dcf_valuation_range: valuationContext.dcfValuationRange,
    valuation_divergence: valuationContext.valuationDivergence,
    business_drivers: valuationContext.businessDrivers,
    alpha_framework: valuationContext.alphaFramework,
    thesis_change_triggers: valuationContext.thesisChangeTriggers,
    confidence_breakdown: valuationContext.confidenceBreakdown,
    analysis_debug: valuationContext.analysisDebug,
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
  const hasYfFallback = hasYahooFilingFallback(facts);
  const source = sourceLabel(facts.source);
  const sourceName = source || (hasYfFallback ? "Quartalsdaten (Yahoo-Financials-Fallback)" : "SEC EDGAR");
  const fmtVal = (v: number) => {
    if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)} Mrd.`;
    return `$${(v / 1e6).toFixed(1)} Mio.`;
  };
  const lines: string[] = [];
  if (facts.revenue.length > 0) {
    lines.push(`${sourceName} Umsatz (letzte Quartale): ` +
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
    system: FELIX_SYSTEM_PROMPT,
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

function hasAnalystConsensusData(data: AnalystData | null): boolean {
  const ratingCount =
    (data?.strong_buy ?? 0) +
    (data?.buy ?? 0) +
    (data?.hold ?? 0) +
    (data?.sell ?? 0) +
    (data?.strong_sell ?? 0);
  return data != null && (data.mean_target != null || ratingCount > 0 || (data.rating_count ?? 0) > 0);
}

function hasQuarterlyFacts(data: EdgarFacts | null): boolean {
  return Boolean(
    data &&
    (data.revenue.length > 0 || data.net_income.length > 0 || data.gross_profit.length > 0),
  );
}

function hasYahooFilingFallback(data: EdgarFacts | null): boolean {
  if (!data) return false;
  return [
    ...data.revenue,
    ...data.net_income,
    ...data.gross_profit,
  ].some(item => String(item.form ?? "").startsWith("YF"));
}

function sourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  return source
    .replace("sec_finance_api_cache", "SEC-Cache")
    .replace("finance_api_yahoo_fallback_cache", "Yahoo-Cache")
    .replace("finance_api_cache", "Finance-API-Cache")
    .replace("fmp_cache", "FMP-Cache")
    .replace("fmp", "FMP")
    .replace("finance_api", "Finance-API");
}

type ProviderFieldDiagnostic = {
  field: string;
  status: "ok" | "missing" | "error" | "skipped";
  provider: string;
  detail: string | null;
  fetched_at: string;
};

async function fetchProviderFieldDiagnostics(
  symbol: string,
  client: SbClient,
): Promise<ProviderFieldDiagnostic[]> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("provider_field_status")
    .select("field, status, provider, detail, fetched_at")
    .eq("symbol", symbol.toUpperCase())
    .gte("fetched_at", cutoff)
    .in("field", ["asset_snapshot", "analyst_consensus", "institutional_ownership", "quarterly_facts"])
    .order("fetched_at", { ascending: false })
    .limit(20);

  if (error || !data) return [];
  return data as ProviderFieldDiagnostic[];
}

function latestProviderFieldStatus(
  diagnostics: ProviderFieldDiagnostic[],
  field: string,
): ProviderFieldDiagnostic | null {
  return diagnostics.find(item => item.field === field) ?? null;
}

function providerMissingReason(
  diagnostics: ProviderFieldDiagnostic[],
  field: string,
): string {
  const latest = latestProviderFieldStatus(diagnostics, field);
  if (!latest) return "kein Cron-Status";
  const provider = sourceLabel(latest.provider) || latest.provider;
  const detail = latest.detail ? `: ${latest.detail}` : "";
  return `${latest.status} ${provider}${detail}`;
}

function buildDataDiagnostics(
  symbol: string,
  snapshot: AssetSnapshot,
  googleNews: NewsItemWithDesc[],
  edgarFacts: EdgarFacts | null,
  insiderTrades: InsiderTrade[],
  trends: TrendPoint[],
  institutional: InstitutionalData | null,
  analystData: AnalystData | null,
  peerContext: string,
  fetchErrors: Record<string, string | null>,
  fxContext: FxContext,
  providerDiagnostics: ProviderFieldDiagnostic[],
): { status: AnalysisTraceEntry["status"]; detail: string } {
  const missingCore = [
    snapshot.pe_ratio == null ? "KGV" : null,
    snapshot.debt_to_equity == null ? "Debt/Equity" : null,
    snapshot.free_cashflow == null ? "FCF" : null,
    snapshot.revenue_growth == null ? "Umsatzwachstum" : null,
  ].filter((item): item is string => item != null);

  const edgarRows =
    (edgarFacts?.revenue.length ?? 0) +
    (edgarFacts?.net_income.length ?? 0) +
    (edgarFacts?.gross_profit.length ?? 0);
  const factSource = sourceLabel(edgarFacts?.source);
  const hasYfFilingFallback = hasYahooFilingFallback(edgarFacts);
  const edgarLabel = edgarRows > 0
    ? `${edgarFacts?.revenue.length ?? 0} Umsatz-Q${factSource ? ` (${factSource})` : hasYfFilingFallback ? " (Yahoo-Fallback)" : " (SEC)"}`
    : "fehlt";

  const analystRatings =
    (analystData?.strong_buy ?? 0) +
    (analystData?.buy ?? 0) +
    (analystData?.hold ?? 0) +
    (analystData?.sell ?? 0) +
    (analystData?.strong_sell ?? 0);
  const hasAnalystConsensus = hasAnalystConsensusData(analystData);
  const institutionalCount = institutional?.top_holders.length ?? 0;
  const hasInstitutional = institutional != null &&
    (institutional.pct_institutions != null || institutional.pct_insider != null || institutionalCount > 0);
  const newsWithExcerpt = googleNews.filter(n => n.description).length;
  const configuredPeers = getConfiguredPeers(symbol);
  const analystLabel = hasAnalystConsensus
    ? `Ziel ${analystData?.mean_target?.toFixed(2) ?? "N/A"}, ${analystRatings > 0 ? `${analystRatings} Ratings (B/H/S)` : (analystData?.rating_count ?? 0) > 0 ? `${analystData!.rating_count} Analysten (kein B/H/S)` : "Anzahl unbekannt"}${sourceLabel(analystData?.source) ? ` (${sourceLabel(analystData?.source)})` : ""}`
    : `fehlt (${providerMissingReason(providerDiagnostics, "analyst_consensus")})`;
  const institutionalLabel = hasInstitutional
    ? `${institutionalCount || "Quote"}${sourceLabel(institutional?.source) ? ` (${sourceLabel(institutional?.source)})` : ""}`
    : `fehlt (${providerMissingReason(providerDiagnostics, "institutional_ownership")})`;
  const peerLabel = peerContext
    ? (peerContext.includes("Snapshot älter als 24h") ? "vorhanden (älter als 24h)" : "vorhanden")
    : configuredPeers.length
      ? `keine Snapshots im Cache (${configuredPeers.join(", ")})`
      : "keine Peer-Map";

  const diagnostics = [
    `Asset: ${missingCore.length ? `fehlend ${missingCore.join(", ")}` : "Kernkennzahlen ok"}`,
    `EDGAR/Quartal: ${edgarLabel}`,
    `Analysten: ${analystLabel}`,
    `Marco-Inputs: Insider ${insiderTrades.length}, Institutionen ${institutionalLabel}, Trends ${trends.length}`,
    `News: ${googleNews.length}, Excerpts ${newsWithExcerpt}`,
    `Peers: ${peerLabel}`,
    `FX: ${fxContext.source}`,
  ];

  const errors = Object.entries(fetchErrors)
    .filter(([, error]) => Boolean(error))
    .map(([source, error]) => `${source}: ${String(error).slice(0, 140)}`);

  const warnings = [
    missingCore.length > 0,
    edgarRows === 0,
    !hasAnalystConsensus,
    !hasMarketIntelData(insiderTrades, trends, institutional),
    !peerContext,
    errors.length > 0,
  ].some(Boolean);

  return {
    status: warnings ? "warning" : "ok",
    detail: errors.length
      ? `${diagnostics.join(" · ")} · Fehler: ${errors.join(" | ")}`
      : diagnostics.join(" · "),
  };
}

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
    system: NINA_SYSTEM_PROMPT,
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
  valuationContext: ValuationContext,
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
  const driverSection = formatBusinessDriversForPrompt(valuationContext.businessDrivers);
  const modelFitSection = formatModelFitForPrompt(valuationContext);
  const thesisTriggerSection = formatThesisChangeTriggersForPrompt(valuationContext.thesisChangeTriggers);
  const confidenceSection = formatConfidenceBreakdownForPrompt(valuationContext.confidenceBreakdown);
  const structuredBriefingSection = formatStructuredBriefingForPrompt(valuationContext.structuredSynthesisInput);
  const sectorSynthesisTemplate = formatSectorSynthesisTemplate(valuationContext.structuredSynthesisInput);
  const growthOutlookDesc = buildGrowthOutlookToolDescription(valuationContext.structuredSynthesisInput, DEFAULT_GROWTH_OUTLOOK);
  const specializedValuationsSection = Object.keys(valuationContext.specializedValuations).length > 0
    ? formatSpecializedValuationsForPrompt(valuationContext.specializedValuations)
    : "";
  const dcfSection = valuationContext.dcfValuationRange
    ? `\nDCF-FAIRER-WERT (FCFF-Modell, deterministisch — erkläre qualitativ auf Deutsch, rechne NICHT nach):
${formatRangeForPrompt(valuationContext.dcfValuationRange)}
HINWEIS: Negativer DCF-Upside bedeutet NICHT automatisch Verkaufen. Premium-Qualitätsunternehmen werden oft oberhalb ihres DCF-Fairen-Werts gehandelt, weil der Markt strategische Optionalität einpreist, die das rein zahlungsstrombasierte Modell nicht erfasst.`
    : "";

  const af = valuationContext.alphaFramework;
  const alphaSection = af ? `
ALPHA-FRAMEWORK (deterministisch — beziehe dich auf die Scores, rechne sie NICHT nach):
Typ: ${af.classification.primaryType} · Alpha-Score: ${af.alphaScore}/100 · Grade: ${af.alphaGrade}
Qualität: ${af.quality.score}/100 (${af.quality.grade}) · Moat: ${af.moat.score}/100 (${af.moat.grade}) · Kapitalallokation: ${af.capitalAllocation.score}/100 (${af.capitalAllocation.grade})
Bewertung (relativ): ${af.relativeValuation.score}/100 (${af.relativeValuation.valuationState}) · Risikoeinschätzung: ${af.risk.score}/100 (${af.risk.level})
Revisions-Momentum: ${af.revisionMomentum.score}/100 (${af.revisionMomentum.direction}) · Kurs-Momentum: ${af.momentum.score}/100 (${af.momentum.trend})${af.reverseDcf.impliedGrowthRate != null ? `\nImpliziertes Wachstum (Reverse DCF): ${(af.reverseDcf.impliedGrowthRate * 100).toFixed(1)}% · Plausibilität: ${af.reverseDcf.plausibility}` : ""}
Stärken: ${af.keyPositiveDrivers.slice(0, 3).join(" | ") || "keine"}
Risiken: ${af.keyNegativeDrivers.slice(0, 3).join(" | ") || "keine"}
HINWEIS: Alpha-Score und Typ sind Hilfsinformationen — du triffst die finale qualitative Einschätzung eigenständig.` : "";

  const valuationSection = `ANALYSTENKONSENS (Marktmeinung, kein eigenes Modell):
${formatRangeForPrompt(valuationContext.analystConsensusRange)}

EIGENES BEWERTUNGSMODELL (deterministisch):
${formatRangeForPrompt(valuationContext.modelValuationRange)}${dcfSection}

DIVERGENZ (deterministisch berechnet — erkläre dies auf Deutsch, rechne NICHT nach):
Status: ${valuationContext.valuationDivergence.status}
${valuationContext.valuationDivergence.explanationSeed}${valuationContext.valuationDivergence.warnings.length ? `\nWARNUNGEN: ${valuationContext.valuationDivergence.warnings.join(" | ")}` : ""}`;
  const synthesisTool: Anthropic.Messages.Tool = {
    name: "complete_synthesis",
    description: "Gibt die finale, strukturierte Research-Synthese zurück. Muss vollständig und inhaltlich substantiell sein.",
    input_schema: {
      type: "object" as const,
      properties: {
        recommendation: {
          type: "string",
          enum: ["Kaufen", "Leicht kaufen", "Halten", "Leicht verkaufen", "Verkaufen"],
        },
        conviction: { type: "number", description: "Überzeugung 1-10, nie höher als Datenqualitäts-Cap." },
        summary: { type: "string", description: "2-3 konkrete Sätze, keine generischen Fallback-Texte." },
        bull_case: { type: "array", items: { type: "string" }, description: "Mindestens 2 substanzielle Pro-Argumente." },
        bear_case: { type: "array", items: { type: "string" }, description: "Mindestens 2 substanzielle Contra-Argumente." },
        growth_outlook: {
          type: "string",
          description: growthOutlookDesc,
        },
        price_levels: {
          type: "object",
          properties: {
            entry: { anyOf: [{ type: "number" }, { type: "null" }] },
            target: { anyOf: [{ type: "number" }, { type: "null" }] },
            stop_loss: { anyOf: [{ type: "number" }, { type: "null" }] },
            entry_rationale: { type: "string" },
            target_rationale: { type: "string" },
          },
        },
        thesis_type: { type: "string", enum: THESIS_TYPES },
        time_horizon_view: {
          type: "object",
          properties: {
            short_term: { type: "string" },
            medium_term: { type: "string" },
            long_term: { type: "string" },
          },
          required: ["short_term", "medium_term", "long_term"],
        },
        entry_quality: {
          type: "object",
          properties: {
            label: { type: "string", enum: ENTRY_QUALITY_LABELS },
            rationale: { type: "string" },
          },
          required: ["label", "rationale"],
        },
        valuation_confidence: { type: "string", enum: VALUATION_CONFIDENCE },
        valuation_range: {
          anyOf: [
            {
              type: "object",
              properties: {
                currency: { type: "string" },
                bear: { anyOf: [{ type: "number" }, { type: "null" }] },
                base: { anyOf: [{ type: "number" }, { type: "null" }] },
                bull: { anyOf: [{ type: "number" }, { type: "null" }] },
                rationale: { type: "string" },
              },
              required: ["currency", "bear", "base", "bull", "rationale"],
            },
            { type: "null" },
          ],
        },
        data_quality_guardrails: { type: "array", items: { type: "string" } },
        claims: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              claim: { type: "string" },
              evidence: { type: "string" },
              source_type: { type: "string", enum: ["metrics", "news", "analyst", "market_intel", "inference"] },
              confidence: {
                type: "number",
                minimum: 1,
                maximum: 5,
                multipleOf: 1,
                description: "Claim-Konfidenz als ganze Zahl von 1 bis 5. Nie 0, nie Dezimalzahl, nie null; bei Unsicherheit 1 oder 2.",
              },
            },
            required: ["claim", "evidence", "source_type", "confidence"],
          },
        },
      },
      required: [
        "recommendation",
        "conviction",
        "summary",
        "bull_case",
        "bear_case",
        "growth_outlook",
        "thesis_type",
        "time_horizon_view",
        "entry_quality",
        "valuation_confidence",
        "valuation_range",
        "data_quality_guardrails",
        "claims",
      ],
    },
  };

  const currentPriceRef = s.price != null ? `AKTUELLER KURS: ${s.price.toFixed(2)} ${s.currency ?? "USD"} (nicht mit Kurszielen verwechseln)\n\n` : "";
  const context = `AKTIE: ${symbol}
${currentPriceRef}KENNZAHLEN (aktuelle Marktdaten):
${formatMetrics(s)}
${analystSection ? "\nANALYSTEN-KONSENS (Zukunftsprognosen, kein aktueller Kurs):\n" + analystSection : ""}
STRUKTURIERTES ANALYSTEN-BRIEFING (deterministisch — höchste Priorität, benutze als Source of Truth):
${structuredBriefingSection}

DEUTSCHER WACHSTUMSAUSBLICK-SEED (deterministisch — als Mindestinhalt für growth_outlook verwenden, nicht wörtlich kopieren):
${valuationContext.growthOutlookSeed}

${sectorSynthesisTemplate}
${specializedValuationsSection ? `\nSPEZIALISIERTE BEWERTUNGSMODELLE (deterministisch — benutze als primäre Bewertungsquelle wenn Status "success"):\n${specializedValuationsSection}` : ""}

SEKTOR- UND WERTTREIBER-MODELL:
${driverSection}

COMPANY-TYPE ROUTER, MODELL-FIT UND PLAUSIBILITÄT (deterministisch — Source of Truth, rechne NICHT nach):
${modelFitSection}

THESIS-CHANGE-TRIGGER (deterministisch — für "was müsste sich ändern?"):
${thesisTriggerSection}

CONFIDENCE BREAKDOWN (deterministisch 1-5 — nicht überschreiben, nur erklären):
${confidenceSection}

BEWERTUNGSTRENNUNG:
${valuationSection}${alphaSection}

WACHSTUMSBEWERTUNG: ${fundamental.growth_rating}/10
Stärken: ${fundamental.key_positives.join(" | ")}
Risiken: ${fundamental.key_risks.join(" | ")}
Bewertungskommentar: ${fundamental.valuation_comment}

NACHRICHTENSTIMMUNG: ${sentiment.sentiment.toUpperCase()}
Themen: ${sentiment.key_themes.join(", ")}
${sentiment.sentiment_summary}${marketIntelSection}
${dataQuality ? `\nDATENQUALITÄT: ${dataQuality.completeness_score}/100 · Conviction-Cap ${dataQuality.analysis_confidence_cap}/10 · Providerdaten fehlen: ${dataQuality.missing_fields.join(", ") || "keine"}\n` : ""}`;

  const response = await client.messages.create({
    model: SYNTHESIS_OPUS_MODEL,
    max_tokens: 2200,
    system: buildOpusSynthesisSystemPrompt({ defaultGrowthOutlook: DEFAULT_GROWTH_OUTLOOK }),
    tools: [synthesisTool],
    tool_choice: { type: "tool", name: "complete_synthesis" } as Anthropic.Messages.ToolChoiceTool,
    messages: [
      {
        role: "user",
        content: `Erstelle eine strukturierte Research-Analyse und rufe danach zwingend das Tool complete_synthesis auf.\n\n${context}\n\nQUALITÄTS- UND SEKTOR-PFLICHTANFORDERUNGEN:\n- Das Sektor-Briefing hat HÖCHSTE PRIORITÄT. Nutze Sektor-Familie und sektorspezifische Treiber als primären Rahmen.\n- Alle nutzer sichtbaren Felder müssen auf Deutsch sein. Keine englischen Fallback-Sätze.\n- Nutze den DEUTSCHEN WACHSTUMSAUSBLICK-SEED, um growth_outlook konkret zu machen.\n- growth_outlook MUSS die sektorspezifischen Pflichtthemen enthalten (siehe SEKTOR-SYNTHESE-PFLICHTEN oben).\n- Wenn fehlende Modelle aufgelistet sind: als Limitationen nennen und valuation_confidence auf max "medium" setzen.\n- Wenn schwache Bewertungsmethoden aufgelistet sind: explizit erklären warum diese für diesen Unternehmenstyp schwach sind.\n- Summary, Bull-Case, Bear-Case und Wachstumsausblick müssen substantiell und sektorspezifisch sein.\n- Alle Pflichtfelder müssen vorhanden sein; growth_outlook darf nie fehlen.\n- Claim-Confidence: Integer 1-5, nie 0/null/dezimal.\n- Trenne Analystenkonsens, eigenes Bewertungsmodell, Timing und langfristige These klar.\n- Wenn kein belastbares eigenes Modell möglich ist: valuation_confidence auf low/medium, valuation_range null und Konsens nur als Marktmeinung erwähnen.\n- Entry Quality muss aus RSI, Kurs relativ zu MA50/MA200 und These abgeleitet sein.\n- Keine Fallback-Sätze wie "Analyse konnte nicht erstellt werden" oder "Nicht verfügbar".\n- Keine generischen Formulierungen wenn Sektor-Kontext vorliegt.`,
      },
    ],
  });

  const toolInput = extractToolInput<unknown>(response.content, "complete_synthesis");
  const rawText = extractText(response.content);
  const fallbackCurrency = s.currency ?? "USD";

  // Try the tool-input path first (structured response from Opus)
  if (toolInput) {
    try {
      const parsed = normalizeSynthesisFromUnknown(toolInput, fallbackCurrency);
      const germanParsed = await repairGermanLanguageIfNeeded(toolInput, parsed, fallbackCurrency);
      assertSynthesisQuality(germanParsed, "Opus");
      return germanParsed;
    } catch {
      // Tool input failed validation → fall through to repair pipeline below
    }
  }

  // Text path (or tool input failed): run validation + repair pipeline
  // We use a minimal schema subset to validate the core fields; full normalization
  // runs via normalizeSynthesisFromUnknown after a successful validation.
  const { result: repairResult, source } = await validateAndRepairSynthesis(
    rawText || (toolInput ? JSON.stringify(toolInput) : ""),
    SynthesisValidationSchema as z.ZodSchema<unknown>,
    () => runSynthesisFastAgent(symbol, s, fundamental, sentiment, marketIntel, analystData, dataQuality),
    process.env.ANTHROPIC_API_KEY ?? "",
  );

  if (source === "opus" || source === "repaired") {
    // Parse into the full SynthesisResult shape
    try {
      const fullParsed = normalizeSynthesisFromUnknown(repairResult, fallbackCurrency);
      const germanParsed = await repairGermanLanguageIfNeeded(repairResult, fullParsed, fallbackCurrency);
      assertSynthesisQuality(germanParsed, source === "repaired" ? "Repair-Agent" : "Opus");
      return germanParsed;
    } catch {
      // normalizeSynthesisFromUnknown threw → build a minimal result from validated fields
    }
    const minimalObj = repairResult as Record<string, unknown>;
    return {
      recommendation: String(minimalObj.recommendation ?? "Halten"),
      conviction: typeof minimalObj.conviction === "number" ? minimalObj.conviction : 4,
      summary: String(minimalObj.summary ?? ""),
      bull_case: Array.isArray(minimalObj.bull_case) ? (minimalObj.bull_case as string[]) : [],
      bear_case: Array.isArray(minimalObj.bear_case) ? (minimalObj.bear_case as string[]) : [],
      growth_outlook: normalizeGrowthOutlookValue(minimalObj.growth_outlook),
      price_levels: null,
      data_quality_guardrails: [
        `Synthese-Quelle: ${source}. Vollständige Feldnormalisierung nicht möglich.`,
      ],
      claims: [],
    };
  }

  // haiku_fallback or deterministic_fallback: already a SynthesisResult-compatible object
  return repairResult as unknown as SynthesisResult;
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
Analystenkonsens: ${formatRangeForPrompt(synthesis.analyst_consensus_range ?? null)}
Eigenes Bewertungsmodell: ${formatRangeForPrompt(synthesis.model_valuation_range ?? null)}
Valuation Divergence: ${synthesis.valuation_divergence ? `[${synthesis.valuation_divergence.status}] ${synthesis.valuation_divergence.explanationSeed}` : "N/A"}
Valuation Range im Bericht: ${synthesis.valuation_range ? `${synthesis.valuation_range.currency} Bear ${synthesis.valuation_range.bear ?? "N/A"} / Base ${synthesis.valuation_range.base ?? "N/A"} / Bull ${synthesis.valuation_range.bull ?? "N/A"} — ${synthesis.valuation_range.rationale}` : "N/A"}
Business Drivers: ${synthesis.business_drivers ? `${synthesis.business_drivers.business_model_type}; KPIs: ${synthesis.business_drivers.sector_specific_kpis.slice(0, 5).join(", ")}; Red Flags: ${synthesis.business_drivers.red_flags.slice(0, 3).join(" | ")}` : "N/A"}
Claims:
${(synthesis.claims ?? []).map(c => `- ${c.claim} | Evidence: ${c.evidence} | Confidence ${c.confidence}/5`).join("\n") || "- Keine strukturierten Claims"}`;

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

  const systemPrompt = buildVeraFactCheckSystemPrompt({ toolInstruction });

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

function hasMarketIntelData(
  trades: InsiderTrade[],
  trends: TrendPoint[],
  institutional: InstitutionalData | null,
): boolean {
  return (
    trades.length > 0 ||
    trends.length > 0 ||
    (institutional != null &&
      (institutional.pct_institutions != null ||
        institutional.pct_insider != null ||
        institutional.top_holders.length > 0))
  );
}

function buildMarcoProtocolDetail(
  marketIntel: MarketIntelAnalysis,
  hasData: boolean,
): { status: ProtocolEntry["status"]; detail: string } {
  if (!hasData || marketIntel.key_observations[0] === "Keine Markt-Intelligenz-Daten verfügbar") {
    return {
      status: "skipped",
      detail: "Keine Market-Intelligence-Daten geliefert (Provider/Ingestion)",
    };
  }
  return {
    status: "ok",
    detail: `Insider: ${marketIntel.insider_signal} · Institutionen: ${marketIntel.institutional_trend} · Trends: ${marketIntel.trends_momentum}`,
  };
}

async function runMarketIntelAgent(
  trades: InsiderTrade[],
  trends: TrendPoint[],
  institutional: InstitutionalData | null,
): Promise<MarketIntelAnalysis> {
  if (!hasMarketIntelData(trades, trends, institutional)) {
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
    system: MARCO_SYSTEM_PROMPT,
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
    score -= 5; warnings.push(`Provider liefert nur ${edgarFacts.revenue.length} EDGAR-Quartale`);
  }

  if (googleNews.length === 0) {
    score -= 10; missing.push("Aktuelle News");
  } else {
    const withExcerpts = googleNews.filter(n => n.description).length;
    if (withExcerpts < 2) {
      score -= 5; warnings.push(`Nur ${withExcerpts}/${googleNews.length} News mit Jina-Auszug`);
    }
  }

  const hasAnalystData = analystData && (
    analystData.mean_target != null ||
    analystData.strong_buy + analystData.buy + analystData.hold + analystData.sell + analystData.strong_sell > 0
  );
  if (!hasAnalystData) { score -= 10; missing.push("Analysten-Konsens"); }

  if (!peerContext) { score -= 5; warnings.push("Peer-Daten nicht verfügbar (Provider/Ingestion)"); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const cap = score >= 85 ? 10 : score >= 70 ? 8 : score >= 55 ? 7 : score >= 40 ? 6 : score >= 25 ? 5 : 4;

  return { completeness_score: score, missing_fields: missing, stale_fields: stale, warnings, analysis_confidence_cap: cap };
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
        content: `Analysiere:\n\n${context}\n\nJSON:\n{"recommendation":"Kaufen"|"Leicht kaufen"|"Halten"|"Leicht verkaufen"|"Verkaufen","conviction":<1-10>,"summary":"2 Sätze","bull_case":["...","...","..."],"bear_case":["...","..."],"growth_outlook":"1 Satz; falls nicht belastbar: ${DEFAULT_GROWTH_OUTLOOK}","price_levels":{"entry":${s.price != null ? s.price.toFixed(2) : null},"target":null,"stop_loss":null,"entry_rationale":"aktuelles Kursniveau","target_rationale":""}}`,
      }],
    });

    const parsed = parseSynthesisFromText(extractText(response.content), s.currency ?? "USD");
    const haikuIssues = getSynthesisQualityIssues(parsed).filter(i => i.severity === "blocker");
    if (haikuIssues.length > 0) {
      console.warn(`[PIPELINE] Haiku-Fallback quality: ${haikuIssues.map(i => i.message).join(" ")}`);
    }
    return {
      ...parsed,
      conviction: haikuIssues.length > 0 ? Math.min(parsed.conviction, 3) : parsed.conviction,
      valuation_confidence: parsed.valuation_confidence === "high" ? "medium" : parsed.valuation_confidence ?? "medium",
      data_quality_guardrails: [
        ...(parsed.data_quality_guardrails ?? []),
        "Schnell-Analyse (Haiku-Fallback): Opus überschritt das Zeitbudget.",
        ...(haikuIssues.length > 0 ? [`Synthesequalität eingeschränkt: ${haikuIssues.map(i => i.message).join(" ")}`] : []),
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
  const marcoProtocol = buildMarcoProtocolDetail(
    marketIntel,
    hasMarketIntelData(insiderTrades, trends, institutional),
  );

  protocol.push({ agent: "Felix", status: "ok", detail: `Wachstumsbewertung ${fundamental.growth_rating}/10 · ${fundamental.key_positives.length} Stärken, ${fundamental.key_risks.length} Risiken${peerContext ? " · Peer-Kontext vorhanden" : ""}` });
  protocol.push({ agent: "Nina", status: "ok", detail: `Sentiment: ${sentiment.sentiment} · ${sentiment.key_themes.length} Themen · ${withExcerpts}/${googleNews.length} Artikel mit Jina-Excerpt` });
  protocol.push({ agent: "Marco", ...marcoProtocol });

  const valuationContext = await runStep(
    "valuation_model",
    "Werttreiber & Bewertungsmodell vorbereiten",
    58,
    async () => buildValuationContext(symbol, snapshot, analystData, dataQuality, fxContext, edgarFacts),
  );
  protocol.push({
    agent: "Driver",
    status: valuationContext.modelValuationRange ? "ok" : "warning",
    detail: `${valuationContext.businessDrivers.sector_template} · eigenes Modell ${valuationContext.modelValuationRange ? valuationContext.modelValuationRange.confidence ?? "medium" : "nicht verfügbar"} · Divergenz ${valuationContext.valuationDivergence.status}${valuationContext.valuationDivergence.baseGapPct != null ? ` (${valuationContext.valuationDivergence.baseGapPct > 0 ? "+" : ""}${valuationContext.valuationDivergence.baseGapPct}%)` : ""}`,
  });

  // Synthese: Opus als qualitative Hauptsynthese → bei Timeout Haiku-Fallback (~8s)
  if (onSynthesisStart) await onSynthesisStart().catch(() => {});
  let rawSynthesisBase: SynthesisResult;
  let usedFallback = false;
  try {
    rawSynthesisBase = await runStep(
      "run_synthesis",
      "Opus Synthese erstellen",
      65,
      () => runSynthesisAgent(symbol, snapshot, fundamental, sentiment, marketIntel, analystData, valuationContext, dataQuality),
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
  const completedSynthesis = await runStep(
    "research_guardrails",
    "Research-Guardrails anwenden",
    78,
    async () => completeResearchFields(rawSynthesisBase, snapshot, marketIntel, analystData, dataQuality, fxContext, valuationContext),
  );
  const rawSynthesis = runLightweightGuardrails(completedSynthesis, dataQuality, valuationContext, {
    marketCapUsd: snapshot.market_cap ?? null,
    hasInsiderData: insiderTrades.length > 0,
    hasInstitutionalData: institutional != null,
  });
  const qualityIssues = getSynthesisQualityIssues(rawSynthesis).filter(i => i.severity === "blocker");
  if (qualityIssues.length > 0) {
    const qualityNote = `Synthesequalität eingeschränkt: ${qualityIssues.map(i => i.message).join(" ")}`;
    console.warn(`[PIPELINE][${symbol}] ${usedFallback ? "Fallback-Synthese" : "Opus-Synthese"} quality gate: ${qualityNote}`);
    rawSynthesis.data_quality_guardrails = [...(rawSynthesis.data_quality_guardrails ?? []), qualityNote];
    rawSynthesis.conviction = Math.min(rawSynthesis.conviction, 4);
  }
  const rawConviction = clampConviction(rawSynthesis.conviction);
  const cappedConviction = Math.min(rawConviction, confidenceCap);
  const capNote = rawConviction > confidenceCap ? ` · Conviction ${rawConviction}→${cappedConviction} (Diana-Cap)` : "";
  const fallbackNote = usedFallback ? " · Haiku-Fallback (Opus-Timeout)" : "";
  const qualityFlag = qualityIssues.length > 0 ? " · Qualität eingeschränkt" : "";
  protocol.push({ agent: "Opus", status: qualityIssues.length > 0 ? "warning" : usedFallback ? "warning" : "ok", detail: `Synthese: ${rawSynthesis.recommendation} · Conviction ${cappedConviction}/10${capNote}${guardrails ? " · Guardrails aktiv" : ""}${fallbackNote}${qualityFlag}` });

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
    analyst_consensus_range: cappedSynthesis.analyst_consensus_range ?? null,
    model_valuation_range: cappedSynthesis.model_valuation_range ?? null,
    dcf_valuation_range: cappedSynthesis.dcf_valuation_range ?? null,
    valuation_divergence: cappedSynthesis.valuation_divergence ?? null,
    business_drivers: cappedSynthesis.business_drivers ?? null,
    alpha_framework: cappedSynthesis.alpha_framework ?? null,
    thesis_change_triggers: cappedSynthesis.thesis_change_triggers ?? null,
    confidence_breakdown: cappedSynthesis.confidence_breakdown ?? null,
    analysis_debug: cappedSynthesis.analysis_debug ?? null,
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
    ...(result.analyst_consensus_range ? { analyst_consensus_range: result.analyst_consensus_range } : {}),
    ...(result.model_valuation_range ? { model_valuation_range: result.model_valuation_range } : {}),
    ...(result.dcf_valuation_range ? { dcf_valuation_range: result.dcf_valuation_range } : {}),
    ...(result.valuation_divergence ? { valuation_divergence: result.valuation_divergence } : {}),
    ...(result.business_drivers ? { business_drivers: result.business_drivers } : {}),
    ...(result.alpha_framework ? { alpha_framework: result.alpha_framework } : {}),
    ...(result.thesis_change_triggers ? { thesis_change_triggers: result.thesis_change_triggers } : {}),
    ...(result.confidence_breakdown ? { confidence_breakdown: result.confidence_breakdown } : {}),
    ...(result.analysis_debug ? { analysis_debug: result.analysis_debug } : {}),
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
    analyst_consensus_range: factCheck.result.analyst_consensus_range ?? result.analyst_consensus_range,
    model_valuation_range: factCheck.result.model_valuation_range ?? result.model_valuation_range,
    dcf_valuation_range: result.dcf_valuation_range,
    valuation_divergence: factCheck.result.valuation_divergence ?? result.valuation_divergence,
    business_drivers: factCheck.result.business_drivers ?? result.business_drivers,
    alpha_framework: result.alpha_framework,
    thesis_change_triggers: factCheck.result.thesis_change_triggers ?? result.thesis_change_triggers,
    confidence_breakdown: factCheck.result.confidence_breakdown ?? result.confidence_breakdown,
    analysis_debug: factCheck.result.analysis_debug ?? result.analysis_debug,
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
    const fallbackFxContext: FxContext = {
      eurUsd: EUR_USD_FALLBACK,
      source: "fallback",
      asOf: new Date().toISOString(),
    };
    const [
      assetData,
      googleNewsResult,
      edgarFactsResult,
      insiderTradesResult,
      trendsResult,
      institutionalResult,
      analystDataResult,
      fxContextResult,
    ] =
      await traceStep("fetch_data", "Markt-, News- und Zusatzdaten laden", 10, () => Promise.all([
        fetchAssetData(symbol),
        captureOptionalFetch(() => fetchGoogleNews(symbol), [] as GoogleNewsItem[]),
        captureOptionalFetch(() => fetchEdgarFacts(symbol), null as EdgarFacts | null),
        captureOptionalFetch(() => fetchInsiderTrades(symbol), [] as InsiderTrade[]),
        captureOptionalFetch(() => fetchTrends(symbol), [] as TrendPoint[]),
        captureOptionalFetch(() => fetchInstitutional(symbol), null as InstitutionalData | null),
        captureOptionalFetch(() => fetchAnalystData(symbol), null as AnalystData | null),
        captureOptionalFetch(() => fetchFxContext(), fallbackFxContext),
      ]));
    tlog("after Promise.all data fetch");

    const googleNews = googleNewsResult.data;
    let edgarFacts = edgarFactsResult.data;
    const insiderTrades = insiderTradesResult.data;
    const trends = trendsResult.data;
    let institutional = institutionalResult.data;
    let analystData = analystDataResult.data;
    const fxContext = fxContextResult.data;
    const dataFetchErrors: Record<string, string | null> = {
      news: googleNewsResult.error,
      edgar: edgarFactsResult.error,
      insider: insiderTradesResult.error,
      trends: trendsResult.error,
      institutional: institutionalResult.error,
      analyst: analystDataResult.error,
      fx: fxContextResult.error,
    };

    const cachedResearch = await traceStep(
      "research_cache",
      "Research-Cache prüfen",
      14,
      () => loadCachedResearchData(serviceClient, symbol).catch(() => ({
        analystData: null,
        institutional: null,
        fundamentalFacts: null,
      })),
    );
    const cacheNotes: string[] = [];
    if (!hasAnalystConsensusData(analystData) && cachedResearch.analystData) {
      analystData = cachedResearch.analystData;
      dataFetchErrors.analyst = null;
      cacheNotes.push("Analysten aus Cache");
    }
    if (!hasMarketIntelData([], [], institutional) && cachedResearch.institutional) {
      institutional = cachedResearch.institutional;
      dataFetchErrors.institutional = null;
      cacheNotes.push("Institutionen aus Cache");
    }
    if ((!hasQuarterlyFacts(edgarFacts) || hasYahooFilingFallback(edgarFacts)) && cachedResearch.fundamentalFacts) {
      edgarFacts = cachedResearch.fundamentalFacts;
      dataFetchErrors.edgar = null;
      cacheNotes.push("Quartalsdaten aus Cache");
    }
    if (cacheNotes.length) {
      dataFetchErrors.cache = null;
    }

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

    const providerDiagnostics = await fetchProviderFieldDiagnostics(symbol, serviceClient).catch(() => []);
    const diagnosticsEntry = await startTrace("data_diagnostics", "Datenkanäle prüfen", 28);
    const diagnostics = buildDataDiagnostics(
      symbol,
      snapshot,
      googleNewsEnriched,
      edgarFacts,
      insiderTrades,
      trends,
      institutional,
      analystData,
      peerContext,
      dataFetchErrors,
      fxContext,
      providerDiagnostics,
    );
    await finishTrace(diagnosticsEntry, diagnostics.status, diagnostics.detail);

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
        ...(diana.missing_fields.length ? [`Providerdaten fehlen: ${diana.missing_fields.slice(0, 4).join(", ")} (kein operatives Risiko)`] : []),
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
      analyst_consensus_range: orchestrated.analyst_consensus_range ?? null,
      model_valuation_range: orchestrated.model_valuation_range ?? null,
      dcf_valuation_range: orchestrated.dcf_valuation_range ?? null,
      valuation_divergence: orchestrated.valuation_divergence ?? null,
      business_drivers: orchestrated.business_drivers ?? null,
      alpha_framework: orchestrated.alpha_framework ?? null,
      thesis_change_triggers: orchestrated.thesis_change_triggers ?? null,
      confidence_breakdown: orchestrated.confidence_breakdown ?? null,
      analysis_debug: orchestrated.analysis_debug ?? null,
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
    if (analysisId) {
      await serviceClient.from("ai_analyses").update({
        extra_data: buildAnalysisExtraData(result),
      }).eq("id", analysisId);
    }
    tlog("after saveAnalysis");

    // VERA läuft per CRON — hier nicht mehr aufrufen.
    // Job direkt als "completed" markieren.
    await serviceClient.from("analysis_jobs").update({
      status: "completed",
      current_step: "completed",
      progress: 100,
      result: { ...result, trace: getTrace() } as unknown as import("@/types/database").Json,
      updated_at: ts(),
    }).eq("id", jobId).eq("user_id", userId);
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
      analyst_consensus_range: extra.analyst_consensus_range as ValuationRange | null ?? null,
      model_valuation_range: extra.model_valuation_range as ValuationRange | null ?? null,
      dcf_valuation_range: extra.dcf_valuation_range as ValuationRange | null ?? null,
      valuation_divergence: extra.valuation_divergence as DivergenceResult | null ?? null,
      business_drivers: extra.business_drivers as BusinessDriverAnalysis | null ?? null,
      alpha_framework: extra.alpha_framework as AlphaFrameworkOutput | null ?? null,
      thesis_change_triggers: extra.thesis_change_triggers as ThesisChangeTriggers | null ?? null,
      confidence_breakdown: extra.confidence_breakdown as AnalysisConfidenceBreakdown | null ?? null,
      analysis_debug: extra.analysis_debug as AnalysisDebugSnapshot | null ?? null,
      data_quality_guardrails: extra.data_quality_guardrails as string[] ?? [],
      claims: extra.claims as AnalysisClaim[] ?? [],
      data_quality: extra.data_quality as DianaQualityReport | null ?? null,
      protocol: extra.protocol as ProtocolEntry[] ?? [],
      trace: extra.analysis_trace as AnalysisTraceEntry[] ?? [],
      analyzed_at: data.analyzed_at,
      from_cache: true,
      fact_check_status: (data as unknown as { fact_check_status?: string }).fact_check_status ?? "pending_factcheck",
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

// ─── Lightweight Guardrails (synchron, vor saveAnalysis) ─────────────────────
// Schnelle, deterministische Prüfungen die ohne KI-Aufruf sofort laufen.
// Tiefe VERA-Analyse läuft asynchron per CRON.
//
// Wrapper: konvertiert SynthesisResult ↔ GuardrailAnalysis und baut GuardrailContext.
// Die eigentliche Logik liegt in src/lib/ai-analysis/guardrails/ (modulare Engine).

function runLightweightGuardrails(
  result: SynthesisResult,
  dataQuality: DianaQualityReport | null,
  valuationContext: ValuationContext | null,
  /** Phase 4 extra context — optional, safe to omit in tests. */
  extraCtx?: {
    marketCapUsd?: number | null;
    hasInsiderData?: boolean;
    hasInstitutionalData?: boolean;
  },
): SynthesisResult {
  // ─── Basis-Checks (vor der Engine) ──────────────────────────────────────────
  // Schema Validation + JSON Repair laufen vor der Guardrail-Engine,
  // damit alle Regeln eine saubere Datenbasis sehen.

  let rec = result.recommendation as string;
  if (!ALLOWED_RECOMMENDATIONS.includes(rec as AllowedRecommendation)) {
    rec = "Halten";
  }
  const baseGuardrails = rec !== result.recommendation
    ? [...(result.data_quality_guardrails ?? []), "Empfehlung korrigiert: unbekannter Wert auf 'Halten' gesetzt."]
    : [...(result.data_quality_guardrails ?? [])];

  const summary = result.summary?.trim() || "Die Analyse wurde abgeschlossen. Aufgrund eingeschränkter Datenverfügbarkeit ist die Zusammenfassung gekürzt — alle Bewertungskomponenten wurden dennoch vollständig verarbeitet.";
  const bull_case =
    Array.isArray(result.bull_case) && result.bull_case.length >= 2
      ? result.bull_case
      : [
          ...(Array.isArray(result.bull_case) ? result.bull_case : []),
          "Weitere Analyse erforderlich.",
          "Datenbasis wird ausgewertet.",
        ].slice(0, Math.max(2, result.bull_case?.length ?? 0));
  const bear_case =
    Array.isArray(result.bear_case) && result.bear_case.length >= 2
      ? result.bear_case
      : [
          ...(Array.isArray(result.bear_case) ? result.bear_case : []),
          "Risiken werden ausgewertet.",
          "Bewertungsrisiko beachten.",
        ].slice(0, Math.max(2, result.bear_case?.length ?? 0));

  // ─── GuardrailAnalysis: slice of SynthesisResult ────────────────────────────
  const ga: GuardrailAnalysis = {
    recommendation: rec,
    conviction: result.conviction,
    price_levels: result.price_levels ?? null,
    entry_quality: result.entry_quality ?? null,
    valuation_confidence: result.valuation_confidence ?? null,
    valuation_divergence: result.valuation_divergence ?? null,
    claims: result.claims ?? [],
    data_quality_guardrails: baseGuardrails,
  };

  // ─── GuardrailContext: derived values for rules ──────────────────────────────
  const modelUsd = valuationContext
    ? getUsdMoneyRange(valuationContext.modelValuationRange)
    : null;
  const consensusUsd = valuationContext
    ? getUsdMoneyRange(valuationContext.analystConsensusRange)
    : null;
  const ctx: GuardrailContext = {
    symbol: "",  // not available at this call site; no current rule needs it
    dataQualityScore: dataQuality?.completeness_score ?? null,
    // Phase 3: current price for V6 safety-net (missing price → null divergence)
    currentPrice: valuationContext?.currentPriceUsd ?? null,
    // Phase 3 fine-tuning: company type + sector for V14 (provider-limitation framing)
    companyType: valuationContext?.businessDrivers?.business_model_type,
    companyTypeKey: valuationContext?.companyTypeClassification.primaryType,
    companyTypeClassification: valuationContext?.companyTypeClassification ?? null,
    modelSelection: valuationContext?.modelSelection ?? null,
    dcfPlausibility: valuationContext?.dcfPlausibility ?? null,
    reverseDcfPlausibility: valuationContext?.reverseDcfPlausibility ?? null,
    valuationDivergenceAnalysis: valuationContext?.valuationDivergenceAnalysis ?? null,
    sector: valuationContext?.businessDrivers?.sector_template,
    hasAnalystConsensus: valuationContext?.analystConsensusRange != null,
    hasOwnModel: valuationContext?.modelValuationRange != null,
    analystConsensusBase: valuationContext?.analystConsensusRange?.base ?? null,
    ownModelBase: modelUsd?.base ?? valuationContext?.modelValuationRange?.base ?? null,
    // Phase 2: scenario range for G8 wide-spread check
    modelBear: modelUsd?.bear ?? null,
    modelBull: modelUsd?.bull ?? null,
    // Phase 3: consensus bear/bull for V3 (undercalibration) and V10 (ordering)
    analystConsensusBear: consensusUsd?.bear ?? null,
    analystConsensusBull: consensusUsd?.bull ?? null,
    // Phase 4: data quality context
    missingFields: dataQuality?.missing_fields ?? [],
    staleFieldCount: dataQuality?.stale_fields?.length ?? 0,
    marketCapUsd: extraCtx?.marketCapUsd ?? null,
    hasInsiderData: extraCtx?.hasInsiderData,
    hasInstitutionalData: extraCtx?.hasInstitutionalData,
    valuationContext,
  };

  // ─── Run engine ──────────────────────────────────────────────────────────────
  const { analysis, fired } = runGuardrailEngine(ga, ctx, ALL_LIGHTWEIGHT_RULES);

  if (fired.length > 0) {
    // Optional debug log (no sensitive data)
    console.debug(`[GUARDRAILS] fired: ${fired.map(r => r.id).join(", ")}`);
  }

  const firedIds = fired.map(rule => rule.id);
  const confidenceBreakdown = result.confidence_breakdown
    ? {
        ...result.confidence_breakdown,
        finalRatingConfidence: firedIds.length
          ? clampFiveConfidence(result.confidence_breakdown.finalRatingConfidence - 1)
          : result.confidence_breakdown.finalRatingConfidence,
        reasons: firedIds.length
          ? [
              ...result.confidence_breakdown.reasons,
              `Final-rating confidence lowered because guardrails fired: ${firedIds.join(", ")}.`,
            ].filter((item, index, arr) => arr.indexOf(item) === index)
          : result.confidence_breakdown.reasons,
      }
    : result.confidence_breakdown;
  const analysisDebug = result.analysis_debug
    ? {
        ...result.analysis_debug,
        guardrailsTriggered: firedIds,
        finalRating: analysis.recommendation,
        finalRatingConfidence: confidenceBreakdown?.finalRatingConfidence ?? result.analysis_debug.finalRatingConfidence,
        confidenceBreakdown: confidenceBreakdown ?? result.analysis_debug.confidenceBreakdown,
      }
    : result.analysis_debug;

  // ─── Merge back into SynthesisResult ────────────────────────────────────────
  return {
    ...result,
    recommendation: analysis.recommendation,
    conviction: analysis.conviction,
    summary,
    bull_case,
    bear_case,
    entry_quality: analysis.entry_quality ?? result.entry_quality,
    valuation_divergence: analysis.valuation_divergence ?? null,
    price_levels: analysis.price_levels ?? null,
    claims: analysis.claims,
    confidence_breakdown: confidenceBreakdown,
    analysis_debug: analysisDebug,
    data_quality_guardrails: analysis.data_quality_guardrails,
  };
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
      fact_check_status: "pending_factcheck",
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
