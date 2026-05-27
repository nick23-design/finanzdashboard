/**
 * Guardrail Engine — Public API
 *
 * Exports:
 *   - runGuardrailEngine() — the pure engine (no LLM, no VERA)
 *   - ALL_LIGHTWEIGHT_RULES — Phase 1 + Phase 2 global research guardrails
 *   - Types needed by route.ts to build GuardrailContext / GuardrailAnalysis
 *
 * Usage in route.ts:
 *   import { runGuardrailEngine, ALL_LIGHTWEIGHT_RULES } from "@/lib/ai-analysis/guardrails";
 *   import type { GuardrailContext, GuardrailAnalysis } from "@/lib/ai-analysis/guardrails";
 */

export { runGuardrailEngine } from "./engine";

export type {
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailEngineResult,
  GuardrailIssueType,
  GuardrailPatch,
  GuardrailResult,
  GuardrailRule,
  GuardrailScope,
  GuardrailSeverity,
  AllowedRecommendation,
  EntryQuality,
  EntryQualityLabel,
  PriceLevels,
  AnalysisClaim,
  ValuationConfidence,
} from "./types";

import { G1_AnalystClaimsWithoutConsensus, G2_NewsPriceTargetUnverified } from "./global.guardrails";
import { G3_ConsensusModelMixing, G4_DivergenceWithoutOwnModel } from "./valuation.guardrails";
import { G5a_WeakDataBasis, G5b_LowConfidenceTarget } from "./data-quality.guardrails";
import { G6_EntryQualityMismatch } from "./research.guardrails";
import {
  G7_NoStrongRecommendationWithoutSupport,
  G8_NoPseudoPrecisionWithWideRange,
  G9_LowConfidenceModelLimitsValuationClaims,
  G10_MissingOwnModelLimitsValuationClaims,
  G11_UnclearSourceForNumericalClaim,
  G12_RecommendationConvictionConsistency,
  G13_EntryQualityBearishMismatch,
  G14_NewsSentimentCannotOverrideWeakValuationAlone,
  G15_TechnicalTimingCannotOverrideFundamentalUncertainty,
  G16_ExtremeDivergenceRequiresExplanation,
} from "./global-research.guardrails";
import { SECTOR_RULES } from "./sector/index";
import type { GuardrailRule } from "./types";

/**
 * All lightweight guardrail rules, executed in this order:
 *
 * Phase 1 — data integrity & basic quality:
 *   1.  G1  — Analyst claims without consensus
 *   2.  G2  — News price targets unverified
 *   3.  G3  — Consensus/model mixing
 *   4.  G4  — Divergence without own model (safety net)
 *   5.  G5a — Weak data basis (conviction + recommendation)
 *   6.  G5b — Low confidence target
 *   7.  G6  — Entry quality mismatch (reads G5a's patched recommendation)
 *
 * Phase 2 — global research quality:
 *   8.  G7  — No strong recommendation without support (runs after G5a)
 *   9.  G8  — No pseudo-precision with wide scenario range
 *   10. G9  — Low confidence model limits valuation claims
 *   11. G10 — Missing own model limits valuation ownership claims
 *   12. G11 — Unclear source for numerical claim
 *   13. G12 — Recommendation/conviction consistency (reads G5a + G7 patches)
 *   14. G13 — Entry quality bearish mismatch (reads G6's patched entry quality)
 *   15. G14 — News sentiment cannot override weak valuation alone
 *   16. G15 — Technical timing cannot override fundamental uncertainty
 *   17. G16 — Large divergence requires explanation
 *
 * + Sector rules (Phase 3, placeholder)
 *
 * Ordering is critical:
 *   - G6 after G5a  (reads patched recommendation)
 *   - G7 after G5a  (checks current recommendation, not original)
 *   - G12 after G5a, G7 (reads final recommendation + conviction)
 *   - G13 after G6  (reads G6's patched entry_quality)
 */
export const ALL_LIGHTWEIGHT_RULES: GuardrailRule[] = [
  // Phase 1
  G1_AnalystClaimsWithoutConsensus,
  G2_NewsPriceTargetUnverified,
  G3_ConsensusModelMixing,
  G4_DivergenceWithoutOwnModel,
  G5a_WeakDataBasis,
  G5b_LowConfidenceTarget,
  G6_EntryQualityMismatch,
  // Phase 2
  G7_NoStrongRecommendationWithoutSupport,
  G8_NoPseudoPrecisionWithWideRange,
  G9_LowConfidenceModelLimitsValuationClaims,
  G10_MissingOwnModelLimitsValuationClaims,
  G11_UnclearSourceForNumericalClaim,
  G12_RecommendationConvictionConsistency,
  G13_EntryQualityBearishMismatch,
  G14_NewsSentimentCannotOverrideWeakValuationAlone,
  G15_TechnicalTimingCannotOverrideFundamentalUncertainty,
  G16_ExtremeDivergenceRequiresExplanation,
  // Phase 3 (sector-specific, placeholder)
  ...SECTOR_RULES,
];

// Individual rule exports for direct testing or selective use
export {
  G1_AnalystClaimsWithoutConsensus,
  G2_NewsPriceTargetUnverified,
  G3_ConsensusModelMixing,
  G4_DivergenceWithoutOwnModel,
  G5a_WeakDataBasis,
  G5b_LowConfidenceTarget,
  G6_EntryQualityMismatch,
  G7_NoStrongRecommendationWithoutSupport,
  G8_NoPseudoPrecisionWithWideRange,
  G9_LowConfidenceModelLimitsValuationClaims,
  G10_MissingOwnModelLimitsValuationClaims,
  G11_UnclearSourceForNumericalClaim,
  G12_RecommendationConvictionConsistency,
  G13_EntryQualityBearishMismatch,
  G14_NewsSentimentCannotOverrideWeakValuationAlone,
  G15_TechnicalTimingCannotOverrideFundamentalUncertainty,
  G16_ExtremeDivergenceRequiresExplanation,
  SECTOR_RULES,
};
