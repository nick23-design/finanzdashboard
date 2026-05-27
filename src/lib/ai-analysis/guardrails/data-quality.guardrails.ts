/**
 * Data-Quality Guardrails
 *
 * Rules that adjust confidence and price targets based on Diana's
 * completeness score and valuation model confidence.
 *
 * G5a — Weak data basis → cap recommendation + conviction
 * G5b — Low model confidence or thin data → remove price target
 */

import type {
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailPatch,
  GuardrailResult,
  GuardrailRule,
} from "./types";

// ─── G5a: Weak data basis ─────────────────────────────────────────────────────

/**
 * When Diana's completeness score is critically low (< 40) or weak (< 50):
 *   < 40: downgrade buy recommendations to "Halten", cap conviction to 5
 *   < 50: downgrade "Kaufen" to "Leicht kaufen", cap conviction to 6
 *
 * Conviction is always capped. A guardrail message is only added when the
 * recommendation is actually changed (matching original behaviour).
 */
export const G5a_WeakDataBasis: GuardrailRule = {
  id: "G5a",
  scope: "data_quality",
  severity: "warning",
  description:
    "Data completeness below threshold — cap conviction, downgrade bullish recommendation if needed.",

  condition(context: GuardrailContext): boolean {
    return (context.dataQualityScore ?? 100) < 50;
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const completeness = context.dataQualityScore ?? 100;
    const patch: GuardrailPatch = {};
    const warnings: string[] = [];

    if (completeness < 40) {
      patch.convictionMax = 5;
      if (
        analysis.recommendation === "Kaufen" ||
        analysis.recommendation === "Leicht kaufen"
      ) {
        patch.recommendation = "Halten";
        warnings.push(
          `Empfehlung auf 'Halten' korrigiert — Datenbasis kritisch lückenhaft (${completeness}/100).`,
        );
      }
    } else {
      // 40 ≤ completeness < 50
      patch.convictionMax = 6;
      if (analysis.recommendation === "Kaufen") {
        patch.recommendation = "Leicht kaufen";
        warnings.push(
          "Empfehlung von 'Kaufen' auf 'Leicht kaufen' korrigiert — Datenbasis < 50%.",
        );
      }
    }

    if (warnings.length > 0) {
      patch.warnings = warnings;
    }

    const message =
      warnings[0] ??
      (completeness < 40
        ? `Conviction auf ≤5 gecappt — Datenbasis kritisch lückenhaft (${completeness}/100).`
        : `Conviction auf ≤6 gecappt — Datenbasis < 50%.`);

    return {
      id: "G5a",
      scope: "data_quality",
      severity: completeness < 40 ? "blocking" : "warning",
      issueType: "weak_data_quality",
      message,
      patch,
    };
  },
};

// ─── G5b: Low model confidence → remove price target ─────────────────────────

/**
 * When valuation model confidence is "low" OR completeness < 55,
 * a specific price target is unreliable and should be removed.
 *
 * Only fires when a non-null target actually exists.
 */
export const G5b_LowConfidenceTarget: GuardrailRule = {
  id: "G5b",
  scope: "data_quality",
  severity: "warning",
  description:
    "Model confidence 'low' or data completeness < 55% — remove precise price target.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (analysis.price_levels?.target == null) return false;
    const completeness = context.dataQualityScore ?? 100;
    return analysis.valuation_confidence === "low" || completeness < 55;
  },

  apply(): GuardrailResult {
    const message =
      "Präzises Kursziel entfernt — Modellkonfidenz 'low' oder Datenbasis < 55%.";
    return {
      id: "G5b",
      scope: "data_quality",
      severity: "warning",
      issueType: "overconfident_recommendation",
      message,
      patch: { removeTarget: true, warnings: [message] },
    };
  },
};
