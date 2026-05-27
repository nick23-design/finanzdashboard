/**
 * Guardrail Engine — Public API
 *
 * Exports:
 *   - runGuardrailEngine() — the pure engine (no LLM, no VERA)
 *   - ALL_LIGHTWEIGHT_RULES — the 6 research guardrails for Phase 1
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
import { SECTOR_RULES } from "./sector/index";
import type { GuardrailRule } from "./types";

/**
 * All lightweight guardrail rules, executed in this order:
 *
 * 1. G1 — Analyst claims without consensus
 * 2. G2 — News price targets
 * 3. G3 — Consensus/model mixing
 * 4. G4 — Divergence without own model (safety net)
 * 5. G5a — Weak data basis (conviction + recommendation)
 * 6. G5b — Low confidence target
 * 7. G6 — Entry quality mismatch (reads G5a's patched recommendation)
 * + Sector rules (Phase 2, empty for now)
 *
 * Order matters: G6 must run after G5a to see the patched recommendation.
 */
export const ALL_LIGHTWEIGHT_RULES: GuardrailRule[] = [
  G1_AnalystClaimsWithoutConsensus,
  G2_NewsPriceTargetUnverified,
  G3_ConsensusModelMixing,
  G4_DivergenceWithoutOwnModel,
  G5a_WeakDataBasis,
  G5b_LowConfidenceTarget,
  G6_EntryQualityMismatch,
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
  SECTOR_RULES,
};
