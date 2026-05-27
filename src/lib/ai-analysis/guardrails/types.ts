/**
 * Guardrail Engine — Core Types
 *
 * NOTE: These types mirror selected types from route.ts to avoid circular
 * imports (route.ts will import from this module). Phase 2 can move the
 * shared types to a dedicated @/lib/ai-analysis/shared-types file.
 */

import type { DivergenceResult } from "@/lib/ai-analysis/divergence";

// ─── Mirror types (identical shape to route.ts exports) ──────────────────────

export type AllowedRecommendation =
  | "Kaufen"
  | "Leicht kaufen"
  | "Halten"
  | "Leicht verkaufen"
  | "Verkaufen";

export type ValuationConfidence = "high" | "medium" | "low";

export type EntryQualityLabel =
  | "attraktiv"
  | "fair"
  | "überhitzt"
  | "Rücksetzer abwarten"
  | "nicht hinterherrennen"
  | "nur spekulativ";

export interface PriceLevels {
  entry: number | null;
  target: number | null;
  stop_loss: number | null;
  entry_rationale: string;
  target_rationale: string;
}

export interface EntryQuality {
  label: EntryQualityLabel;
  rationale: string;
}

export interface AnalysisClaim {
  claim: string;
  evidence: string;
  source_type: "metrics" | "news" | "analyst" | "market_intel" | "inference";
  confidence: number;
}

// ─── Guardrail-specific types ─────────────────────────────────────────────────

export type GuardrailScope =
  | "global"
  | "valuation"
  | "data_quality"
  | "research"
  | "sector"
  | "company_type";

export type GuardrailSeverity = "info" | "warning" | "blocking";

export type GuardrailIssueType =
  | "analyst_consensus_missing"
  | "news_target_unverified"
  | "valuation_mixing"
  | "divergence_unavailable"
  | "weak_data_quality"
  | "overconfident_recommendation"
  | "entry_quality_mismatch"
  | "model_conservatism"
  | "sector_metric_mismatch"
  | "unsupported_claim";

/**
 * Mutable analysis slice that the guardrail engine operates on.
 * Subset of SynthesisResult; only fields that guardrails may read or mutate.
 */
export interface GuardrailAnalysis {
  recommendation: string;
  conviction: number;
  price_levels: PriceLevels | null | undefined;
  entry_quality: EntryQuality | null | undefined;
  valuation_confidence: ValuationConfidence | null | undefined;
  valuation_divergence: DivergenceResult | null | undefined;
  claims: AnalysisClaim[];
  data_quality_guardrails: string[];
}

/**
 * Context provided to each guardrail rule.
 * Contains derived booleans and pre-calculated values so rules stay pure.
 */
export interface GuardrailContext {
  /** Symbol being analysed (e.g. "AAPL"). */
  symbol: string;
  /** Current market price in USD (if available). */
  currentPrice?: number | null;
  /** Diana completeness score 0–100 (higher = more data available). */
  dataQualityScore?: number | null;
  /** Business model type string (e.g. "mega_cap_cloud_software"). */
  companyType?: string;
  /** Sector template string (e.g. "semiconductor"). */
  sector?: string;
  /** True if a structured analyst consensus range is present. */
  hasAnalystConsensus: boolean;
  /** True if an own valuation model was successfully built. */
  hasOwnModel: boolean;
  /** Analyst consensus base value in USD (if available). */
  analystConsensusBase?: number | null;
  /** Own model base value in USD (if available). */
  ownModelBase?: number | null;
  /** Full valuation context (opaque for future extensibility). */
  valuationContext?: unknown;
  /** Full driver context (opaque for future extensibility). */
  driverContext?: unknown;
}

/**
 * Atomic, declarative patch that a guardrail rule produces.
 * The engine applies patches conservatively (see engine.ts).
 */
export interface GuardrailPatch {
  /**
   * Override recommendation. The engine applies the most conservative value
   * across all fired patches (Verkaufen < Leicht verkaufen < Halten < ...).
   */
  recommendation?: AllowedRecommendation;
  /**
   * Cap conviction to this maximum. Lowest wins across multiple patches.
   */
  convictionMax?: number;
  /**
   * If true, set price_levels.target = null. Wins once any patch sets it.
   */
  removeTarget?: boolean;
  /**
   * Override entry_quality. Last patch with this field wins.
   */
  entryQuality?: EntryQuality;
  /**
   * If explicitly null, set valuation_divergence = null.
   * Use `valuationDivergence: null` to trigger this.
   */
  valuationDivergence?: null;
  /**
   * Cap confidence of all claims with the given source_type to `cap`.
   */
  claimCapBySourceType?: {
    sourceType: AnalysisClaim["source_type"];
    cap: number;
  };
  /**
   * For claims where `source_type` matches AND claim+evidence text matches
   * the regex `pattern`, prefix the evidence with `prefix`.
   */
  claimEvidencePrefix?: {
    sourceType: AnalysisClaim["source_type"];
    pattern: string;
    prefix: string;
  };
  /**
   * Additional messages to append to data_quality_guardrails.
   */
  warnings?: string[];
}

/**
 * Returned by a rule's apply() function. Carries the message and optional patch.
 */
export interface GuardrailResult {
  id: string;
  scope: GuardrailScope;
  severity: GuardrailSeverity;
  issueType: GuardrailIssueType;
  /** Human-readable description of the issue detected. */
  message: string;
  /** Optional structural mutations to apply to the analysis. */
  patch?: GuardrailPatch;
}

/**
 * A declarative guardrail rule.
 */
export interface GuardrailRule {
  id: string;
  scope: GuardrailScope;
  severity: GuardrailSeverity;
  /** Short description for debugging and documentation. */
  description: string;
  /**
   * Returns true if this rule should fire for the given context + analysis.
   * Receives the current (already-mutated-by-prior-rules) analysis.
   */
  condition: (context: GuardrailContext, analysis: GuardrailAnalysis) => boolean;
  /**
   * Computes and returns the result (including patch) for a fired rule.
   * Returns null if the rule fires but has nothing to apply (rare).
   */
  apply: (
    context: GuardrailContext,
    analysis: GuardrailAnalysis,
  ) => GuardrailResult | null;
}

/**
 * What the engine returns after running all rules.
 */
export interface GuardrailEngineResult {
  /** Mutated analysis after all fired patches have been applied. */
  analysis: GuardrailAnalysis;
  /** All GuardrailResults that fired (in execution order). */
  fired: GuardrailResult[];
}
