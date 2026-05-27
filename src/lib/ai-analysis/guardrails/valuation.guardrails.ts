/**
 * Valuation Guardrails
 *
 * Rules that protect the integrity of the valuation model and divergence.
 *
 * G3 — Identical consensus/model base value → possible mixing warning
 * G4 — No divergence without own model (safety net for pipeline anomalies)
 */

import type {
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailResult,
  GuardrailRule,
} from "./types";

// ─── G3: Consensus = Model base → possible mixing ────────────────────────────

/**
 * If both analyst consensus and own model exist but share the same base value,
 * they have likely been mixed up. Emit a warning (no structural patch needed).
 */
export const G3_ConsensusModelMixing: GuardrailRule = {
  id: "G3",
  scope: "valuation",
  severity: "warning",
  description:
    "Analyst consensus and own model share the same base value — possible valuation mixing.",

  condition(context: GuardrailContext): boolean {
    if (!context.hasAnalystConsensus || !context.hasOwnModel) return false;
    if (context.analystConsensusBase == null || context.ownModelBase == null) return false;
    return context.analystConsensusBase === context.ownModelBase;
  },

  apply(): GuardrailResult {
    const message =
      "Analystenkonsens und eigenes Modell haben identischen Basiswert — möglicherweise vermischt.";
    return {
      id: "G3",
      scope: "valuation",
      severity: "warning",
      issueType: "valuation_mixing",
      message,
      patch: { warnings: [message] },
    };
  },
};

// ─── G4: No divergence without own model (safety net) ────────────────────────

/**
 * Safety net: the deterministic divergence module should already set
 * status != "available" when own model is absent. If divergence somehow
 * has status === "available" despite no own model existing, null it out.
 *
 * This rule should almost never fire in a healthy pipeline.
 */
export const G4_DivergenceWithoutOwnModel: GuardrailRule = {
  id: "G4",
  scope: "valuation",
  severity: "warning",
  description:
    "Divergence status is 'available' but no own model exists — reset divergence (pipeline anomaly).",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (context.hasOwnModel) return false;
    return analysis.valuation_divergence?.status === "available";
  },

  apply(): GuardrailResult {
    const message =
      "Divergenz-Status korrigiert — kein eigenes Bewertungsmodell verfügbar (Fallback-Check).";
    return {
      id: "G4",
      scope: "valuation",
      severity: "warning",
      issueType: "divergence_unavailable",
      message,
      patch: { valuationDivergence: null, warnings: [message] },
    };
  },
};
