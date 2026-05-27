/**
 * Guardrail Engine — Public API
 *
 * Exports:
 *   - runGuardrailEngine() — the pure engine (no LLM, no VERA)
 *   - ALL_LIGHTWEIGHT_RULES — Phase 1 + Phase 2 + Phase 3 guardrails
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
import {
  G5a_WeakDataBasis,
  G5b_LowConfidenceTarget,
  D3_ValuationInputsCapConfidence,
  D4_MissingConsensusLanguageInClaims,
  D6_MissingFilingDataWeakensGrowthClaims,
  D7_MissingInsiderDataBlocksSignal,
  D8_LargeCapDataGapIsProviderLimitation,
  D9_StaleDataFreshnessWarning,
  D11_MissingDataNotNegativeThesis,
  D12_WeakDataLanguage,
  DATA_QUALITY_PHASE4_RULES,
} from "./data-quality.guardrails";
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
  G17_LowConfidenceBearishModelBullishRecommendation,
} from "./global-research.guardrails";
import {
  V1_ExtremeDivergenceRequiresInterpretation,
  V2_ConservativeModelDisclaimer,
  V3_BullBearUndercalibration,
  V4_ConsensusAutoUpsideGuard,
  V5_OwnModelDivergenceCaution,
  V6_MissingCurrentPrice,
  V7_LowConfidenceDivergence,
  V8_ConsensusOnlyValuation,
  V9_OwnModelOnlyValuation,
  V10_ScenarioOrderingInvalid,
  V11_ExtremeUpsideDownside,
  V12_DivergenceLanguageGermanTemplate,
  V13_BothValuationSourcesMissing,
  V14_DataQualityProviderLimitation,
  VALUATION_DIVERGENCE_RULES,
} from "./valuation-divergence.guardrails";
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
 * Phase 3 — valuation & divergence guardrails (after G1–G16):
 *   18. V6  — Missing current price (safety net → may null divergence)
 *   19. V10 — Scenario ordering invalid (safety net → may null divergence)
 *   20. V1  — Extreme divergence with high conf but dq<75 (complements G16)
 *   21. V2  — Conservative model disclaimer (model ≥25% below market)
 *   22. V3  — Bull/bear undercalibration (model bull < consensus bear)
 *   23. V4  — Consensus auto-upside guard (Kaufen without own-model upside)
 *   24. V5  — Own model divergence caution (model ≥25pp more bullish)
 *   25. V7  — Low confidence divergence (divergence + modelConf=low)
 *   26. V13 — Both valuation sources missing → low confidence + warning (Phase 3 fine-tuning)
 *   27. V8  — Consensus-only valuation informational note
 *   28. V9  — Own-model-only valuation informational note
 *   29. V11 — Extreme upside/downside (≥75%)
 *   30. V14 — Data quality gaps = provider limitation (Phase 3 fine-tuning)
 *   31. V12 — German divergence template (runs last)
 *
 * Phase 3.5 — cross-phase recommendation consistency (after V-rules):
 *   32. G17 — Low conf + dq<60 + bearish model (≤−25%) + no consensus/divergence
 *             + defensive entry → cap recommendation to 'Halten'
 *             MUST run after Phase 3 so it sees valuation_confidence set by V7/V10/V13
 *
 * Phase 4 — data quality guardrails (after Phase 3 + G17):
 *   33. D3  — Single valuation source missing + high confidence → cap to "medium"
 *   34. D4  — No analyst consensus → mark consensus-language claims as unsupported
 *   35. D6  — EDGAR quarterly data missing → cap growth/margin/FCF claims to ≤5
 *   36. D7  — Insider + institutional data both absent → unassessable signal warning
 *   37. D8  — Large-cap (>50B) + dq<70 → data gaps as provider limitation
 *   38. D9  — Stale data fields detected → freshness warning + conviction ≤7
 *   39. D11 — Missing data as negative business thesis → unsupported claim
 *   40. D12 — dq<60 + hard valuation certainty language → cautious note
 *
 * + Sector rules (future)
 *
 * Critical ordering constraints:
 *   - G6 after G5a  (reads patched recommendation)
 *   - G7 after G5a  (checks current recommendation, not original)
 *   - G12 after G5a, G7 (reads final recommendation + conviction)
 *   - G13 after G6  (reads G6's patched entry_quality)
 *   - V6, V10 before other V rules (safety nets that may null divergence)
 *   - V12 last among V rules (German template, needs final divergence state)
 *   - G17 after Phase 3 V-rules (needs final valuation_confidence from V7/V10/V13)
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
  // Phase 3 — valuation & divergence guardrails
  ...VALUATION_DIVERGENCE_RULES,
  // Phase 3.5 — cross-phase recommendation consistency (after V7/V10/V13 set valuation_confidence)
  G17_LowConfidenceBearishModelBullishRecommendation,
  // Phase 4 — data quality guardrails
  ...DATA_QUALITY_PHASE4_RULES,
  // Sector rules (future)
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
  // Phase 3.5
  G17_LowConfidenceBearishModelBullishRecommendation,
  // Phase 3
  V1_ExtremeDivergenceRequiresInterpretation,
  V2_ConservativeModelDisclaimer,
  V3_BullBearUndercalibration,
  V4_ConsensusAutoUpsideGuard,
  V5_OwnModelDivergenceCaution,
  V6_MissingCurrentPrice,
  V7_LowConfidenceDivergence,
  V8_ConsensusOnlyValuation,
  V9_OwnModelOnlyValuation,
  V10_ScenarioOrderingInvalid,
  V11_ExtremeUpsideDownside,
  V12_DivergenceLanguageGermanTemplate,
  V13_BothValuationSourcesMissing,
  V14_DataQualityProviderLimitation,
  VALUATION_DIVERGENCE_RULES,
  // Phase 4
  D3_ValuationInputsCapConfidence,
  D4_MissingConsensusLanguageInClaims,
  D6_MissingFilingDataWeakensGrowthClaims,
  D7_MissingInsiderDataBlocksSignal,
  D8_LargeCapDataGapIsProviderLimitation,
  D9_StaleDataFreshnessWarning,
  D11_MissingDataNotNegativeThesis,
  D12_WeakDataLanguage,
  DATA_QUALITY_PHASE4_RULES,
  SECTOR_RULES,
};
