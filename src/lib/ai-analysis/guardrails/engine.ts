/**
 * Guardrail Engine
 *
 * Executes guardrail rules sequentially (rule order is deterministic).
 * Each rule sees the analysis state AFTER previous rules have patched it —
 * this allows dependent rules (e.g. G6 depends on G5a's recommendation change)
 * to work correctly without multi-pass logic.
 *
 * Conservative merge semantics:
 *   - recommendation:  most defensive value wins (Verkaufen < … < Kaufen)
 *   - convictionMax:   lowest value wins
 *   - removeTarget:    once true, stays true
 *   - valuationDivergence: once null, stays null
 *   - entryQuality:    last patch wins (at most one rule sets it today)
 *   - warnings:        all appended
 *
 * No LLM calls. No VERA logic. Fully deterministic.
 */

import type {
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailEngineResult,
  GuardrailPatch,
  GuardrailResult,
  GuardrailRule,
} from "./types";

// ─── Recommendation ordering ──────────────────────────────────────────────────

/**
 * Lower rank = more conservative / more defensive.
 * "Verkaufen" (1) is most defensive, "Kaufen" (5) is most bullish.
 */
const RECOMMENDATION_RANK: Record<string, number> = {
  Verkaufen: 1,
  "Leicht verkaufen": 2,
  Halten: 3,
  "Leicht kaufen": 4,
  Kaufen: 5,
};

function moreConservative(current: string, candidate: string): string {
  const currentRank = RECOMMENDATION_RANK[current] ?? 3;
  const candidateRank = RECOMMENDATION_RANK[candidate] ?? 3;
  return candidateRank <= currentRank ? candidate : current;
}

// ─── Patch application ────────────────────────────────────────────────────────

/**
 * Applies a single GuardrailPatch to a mutable analysis copy.
 * Returns the updated analysis.
 */
function applyPatch(
  analysis: GuardrailAnalysis,
  patch: GuardrailPatch,
): GuardrailAnalysis {
  let result = { ...analysis, claims: [...analysis.claims] };

  // recommendation — most conservative wins
  if (patch.recommendation !== undefined) {
    result.recommendation = moreConservative(result.recommendation, patch.recommendation);
  }

  // recommendationExact — unconditional override (last writer wins)
  // Used only by G7 to moderate an unsupported strong bearish recommendation.
  if (patch.recommendationExact !== undefined) {
    result.recommendation = patch.recommendationExact;
  }

  // conviction — lowest wins
  if (patch.convictionMax !== undefined) {
    result.conviction = Math.min(result.conviction, patch.convictionMax);
  }

  // removeTarget — once true, stays true (null-wins)
  if (patch.removeTarget === true) {
    if (result.price_levels != null && result.price_levels.target != null) {
      result.price_levels = {
        ...result.price_levels,
        target: null,
        target_rationale: "Kein präzises Kursziel — Datenbasis oder Modellkonfidenz zu niedrig.",
      };
    }
  }

  // entryQuality — last writer wins (only one rule sets this currently)
  if (patch.entryQuality !== undefined) {
    result.entry_quality = patch.entryQuality;
  }

  // valuationDivergence — explicit null wins (cannot be un-nulled by a later patch)
  if ("valuationDivergence" in patch && patch.valuationDivergence === null) {
    if (result.valuation_divergence !== null) {
      result.valuation_divergence = null;
    }
  }

  // claimCapBySourceType — cap confidence for matching claims
  if (patch.claimCapBySourceType != null) {
    const { sourceType, cap } = patch.claimCapBySourceType;
    result.claims = result.claims.map(c =>
      c.source_type === sourceType
        ? { ...c, confidence: Math.min(c.confidence, cap) }
        : c,
    );
  }

  // claimCapByPattern — cap confidence for claims matching source type AND content pattern
  if (patch.claimCapByPattern != null) {
    const { sourceType, pattern, cap } = patch.claimCapByPattern;
    const re = new RegExp(pattern);
    result.claims = result.claims.map(c =>
      c.source_type === sourceType && re.test(`${c.claim} ${c.evidence}`)
        ? { ...c, confidence: Math.min(c.confidence, cap) }
        : c,
    );
  }

  // claimEvidencePrefix — prefix evidence for matching claims (idempotent)
  if (patch.claimEvidencePrefix != null) {
    const { sourceType, pattern, prefix } = patch.claimEvidencePrefix;
    const re = new RegExp(pattern);
    result.claims = result.claims.map(c => {
      if (
        c.source_type === sourceType &&
        re.test(`${c.claim} ${c.evidence}`) &&
        !c.evidence.startsWith(prefix)
      ) {
        return { ...c, evidence: `${prefix} ${c.evidence}` };
      }
      return c;
    });
  }

  // warnings — appended to data_quality_guardrails
  if (patch.warnings?.length) {
    result = {
      ...result,
      data_quality_guardrails: [...result.data_quality_guardrails, ...patch.warnings],
    };
  }

  return result;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Runs guardrail rules sequentially.
 *
 * Execution order:
 * 1. Evaluate rule.condition() against current analysis state.
 * 2. If fires, call rule.apply() to get GuardrailResult.
 * 3. Apply result.patch immediately (next rule sees the patched state).
 * 4. Collect all fired GuardrailResults.
 *
 * Returns the final analysis and the list of all fired results.
 *
 * @param initialAnalysis - The analysis to protect (will not be mutated; a copy is made).
 * @param context         - Static context for the current analysis run.
 * @param rules           - Ordered array of rules to evaluate.
 */
export function runGuardrailEngine(
  initialAnalysis: GuardrailAnalysis,
  context: GuardrailContext,
  rules: GuardrailRule[],
): GuardrailEngineResult {
  // Work on a shallow copy; patches create new objects for mutated fields.
  let analysis: GuardrailAnalysis = {
    ...initialAnalysis,
    claims: [...initialAnalysis.claims],
    data_quality_guardrails: [...initialAnalysis.data_quality_guardrails],
  };

  const fired: GuardrailResult[] = [];

  for (const rule of rules) {
    let result: GuardrailResult | null = null;
    try {
      if (rule.condition(context, analysis)) {
        result = rule.apply(context, analysis);
      }
    } catch (err) {
      // Rules must never throw and crash the pipeline.
      console.error(
        `[GUARDRAIL][${rule.id}] Unexpected error — rule skipped:`,
        err instanceof Error ? err.message : err,
      );
    }

    if (result != null) {
      fired.push(result);
      if (result.patch) {
        analysis = applyPatch(analysis, result.patch);
      }
    }
  }

  return { analysis, fired };
}
