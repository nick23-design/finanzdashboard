/**
 * Research Guardrails
 *
 * Rules that protect research-quality integrity — ensuring that buy signals
 * are backed by evidence and non-buy signals don't overstate opportunity.
 *
 * G6 — "Halten" + entry quality "attraktiv" requires a clear model undervaluation
 */

import type {
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailResult,
  GuardrailRule,
} from "./types";

// ─── G6: Entry quality "attraktiv" requires undervaluation evidence ───────────

/**
 * When the recommendation is neutral-to-bearish ("Halten", "Leicht verkaufen",
 * "Verkaufen") but entry_quality is "attraktiv", we must verify that a
 * genuine model undervaluation exists.
 *
 * Clear undervaluation requires ALL of:
 *   - own model is present
 *   - model confidence is not "low"
 *   - data completeness ≥ 60
 *   - model base > entry price × 1.15 (≥15% upside from entry, or no entry to check)
 *
 * If the condition is not met, downgrade entry_quality to "fair".
 *
 * NOTE: This rule reads analysis.recommendation which may already have been
 * patched by G5a. Sequential execution ensures correctness.
 */
export const G6_EntryQualityMismatch: GuardrailRule = {
  id: "G6",
  scope: "research",
  severity: "warning",
  description:
    "'Halten' or worse recommendation with 'attraktiv' entry quality requires verified undervaluation.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const nonBuyRecs = ["Halten", "Leicht verkaufen", "Verkaufen"];
    if (!nonBuyRecs.includes(analysis.recommendation)) return false;
    return analysis.entry_quality?.label === "attraktiv";
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const completeness = context.dataQualityScore ?? 100;
    const modelConf = analysis.valuation_confidence;
    const ownModelBase = context.ownModelBase ?? null;
    const entryPrice = analysis.price_levels?.entry ?? null;

    const clearUndervaluation =
      context.hasOwnModel &&
      modelConf !== "low" &&
      completeness >= 60 &&
      (ownModelBase == null ||
        entryPrice == null ||
        ownModelBase > entryPrice * 1.15);

    if (clearUndervaluation) {
      // Entry quality "attraktiv" is justified — do not patch
      return {
        id: "G6",
        scope: "research",
        severity: "info",
        issueType: "entry_quality_mismatch",
        message:
          "Entry Quality 'attraktiv' bei 'Halten' — Unterbewertung durch eigenes Modell belegt, kein Patch nötig.",
      };
    }

    const message =
      "Entry Quality von 'attraktiv' auf 'fair' korrigiert — 'Halten'-Empfehlung ohne belegbare Modell-Unterbewertung.";

    return {
      id: "G6",
      scope: "research",
      severity: "warning",
      issueType: "entry_quality_mismatch",
      message,
      patch: {
        entryQuality: {
          label: "fair",
          rationale:
            "'attraktiv' bei 'Halten' erfordert ein eigenes Modell mit klarer Unterbewertung (≥ 15% Upside) und ausreichender Datenbasis.",
        },
        warnings: [message],
      },
    };
  },
};
