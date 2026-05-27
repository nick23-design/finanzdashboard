/**
 * Valuation & Divergence Guardrails — Phase 3
 *
 * Rules protecting the integrity of valuation model outputs and divergence
 * calculations. All rules are synchronous, deterministic, and LLM-free.
 *
 * Execution order within Phase 3 (important!):
 *   V6  — Missing current price (safety net — may null divergence)
 *   V10 — Invalid scenario ordering (safety net — may null divergence)
 *   V1  — Extreme divergence with high confidence but weak data → conviction cap
 *   V2  — Conservative model disclaimer (own model strongly bearish vs. market)
 *   V3  — Bull/bear undercalibration (model bull < consensus bear)
 *   V4  — Consensus auto-upside guard (Kaufen without own model upside)
 *   V5  — Own model divergence caution (model strongly more bullish than consensus)
 *   V7  — Low confidence model + available divergence → divergence-specific warning
 *   V8  — Consensus-only valuation informational note
 *   V9  — Own-model-only valuation informational note
 *   V11 — Extreme upside/downside (≥75%) → conviction cap
 *   V12 — German template explanation for available divergence (runs last)
 *
 * V6 and V10 run first because they null out valuation_divergence on structural
 * failures. All rules that require div.status="available" (V1/V2/V4/V5/V7/V11/V12)
 * are safe: they check the current (possibly already-nullified) analysis.
 */

import type {
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailResult,
  GuardrailRule,
} from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtPp(n: number): string {
  return `${Math.abs(n).toFixed(1)}pp`;
}

// ─── V6: Missing current price (safety net) ───────────────────────────────────

/**
 * Without a valid current price, upside % calculations are meaningless.
 * Safety net: if price is missing/invalid and divergence is non-null, null it out.
 * Runs FIRST within Phase 3 so later V rules see a clean divergence state.
 */
export const V6_MissingCurrentPrice: GuardrailRule = {
  id: "V6",
  scope: "valuation",
  severity: "warning",
  description:
    "Current price missing or invalid — nullify divergence (upside % not calculable).",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    // Only fire when divergence is currently non-null (no-op guard)
    if (analysis.valuation_divergence == null) return false;
    // Fire when price is explicitly null/undefined or non-positive
    const price = context.currentPrice;
    return price == null || price <= 0;
  },

  apply(): GuardrailResult {
    const message =
      "Aktueller Kurs fehlt oder ungültig — Divergenzrechnung nicht verfügbar. Upside-Berechnungen ausgeblendet.";
    return {
      id: "V6",
      scope: "valuation",
      severity: "warning",
      issueType: "missing_current_price",
      message,
      patch: {
        valuationDivergence: null,
        warnings: [message],
      },
    };
  },
};

// ─── V10: Invalid scenario ordering ──────────────────────────────────────────

/**
 * For a valuation range, bear ≤ base ≤ bull must always hold.
 * If violated (e.g. Bear > Base, or Base > Bull), the range is internally
 * inconsistent — remove target, cap conviction, set low confidence, null divergence.
 *
 * Runs SECOND within Phase 3 (after V6) to ensure the divergence is clean before
 * later rules read it.
 *
 * Note: only fires when ALL three values (bear, base, bull) are non-null;
 * partial ranges are handled by other rules.
 */
export const V10_ScenarioOrderingInvalid: GuardrailRule = {
  id: "V10",
  scope: "valuation",
  severity: "blocking",
  description:
    "Scenario ordering invalid (bear > base or base > bull) → reset target, conviction, divergence.",

  condition(context: GuardrailContext): boolean {
    // Check own model (all three values non-null)
    if (
      context.hasOwnModel &&
      context.modelBear != null &&
      context.ownModelBase != null &&
      context.modelBull != null &&
      (context.modelBear > context.ownModelBase ||
        context.ownModelBase > context.modelBull)
    ) {
      return true;
    }
    // Check analyst consensus (all three values non-null)
    if (
      context.hasAnalystConsensus &&
      context.analystConsensusBear != null &&
      context.analystConsensusBase != null &&
      context.analystConsensusBull != null &&
      (context.analystConsensusBear > context.analystConsensusBase ||
        context.analystConsensusBase > context.analystConsensusBull)
    ) {
      return true;
    }
    return false;
  },

  apply(context: GuardrailContext): GuardrailResult {
    const parts: string[] = [];

    if (
      context.hasOwnModel &&
      context.modelBear != null &&
      context.ownModelBase != null &&
      context.modelBull != null &&
      (context.modelBear > context.ownModelBase ||
        context.ownModelBase > context.modelBull)
    ) {
      parts.push(
        `Modell (Bear ${context.modelBear} / Base ${context.ownModelBase} / Bull ${context.modelBull})`,
      );
    }

    if (
      context.hasAnalystConsensus &&
      context.analystConsensusBear != null &&
      context.analystConsensusBase != null &&
      context.analystConsensusBull != null &&
      (context.analystConsensusBear > context.analystConsensusBase ||
        context.analystConsensusBase > context.analystConsensusBull)
    ) {
      parts.push(
        `Konsens (Bear ${context.analystConsensusBear} / Base ${context.analystConsensusBase} / Bull ${context.analystConsensusBull})`,
      );
    }

    const message =
      `Ungültige Szenario-Reihenfolge (Bear ≤ Base ≤ Bull verletzt) für: ${parts.join("; ")}. ` +
      `Kursziel und Divergenzrechnung entfernt, Konfidenz auf 'niedrig' gesetzt.`;

    return {
      id: "V10",
      scope: "valuation",
      severity: "blocking",
      issueType: "scenario_ordering_invalid",
      message,
      patch: {
        removeTarget: true,
        convictionMax: 5,
        setValuationConfidenceLow: true,
        valuationDivergence: null,
        warnings: [message],
      },
    };
  },
};

// ─── V1: Extreme divergence with high confidence but weak data ────────────────

/**
 * Complements G16 (Phase 2) for the edge case where G16 does NOT cap conviction
 * (because model confidence is "high") but the data quality is still too low to
 * justify full conviction.
 *
 * G16 caps when NOT high-confidence.
 * V1  caps when (high-confidence) AND (dq < 75) — the gap G16 leaves open.
 *
 * Condition: |baseGapPct| ≥ 40 AND valuation_confidence = "high" AND dq < 75.
 */
export const V1_ExtremeDivergenceRequiresInterpretation: GuardrailRule = {
  id: "V1",
  scope: "valuation",
  severity: "warning",
  description:
    "Extreme divergence (≥40pp), high confidence, but dq<75 → conviction cap (gap left by G16).",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const div = analysis.valuation_divergence;
    if (div?.status !== "available") return false;
    if (div.baseGapPct == null) return false;
    if (Math.abs(div.baseGapPct) < 40) return false;
    // Only fires in the case G16 misses: high confidence but dq still insufficient
    if (analysis.valuation_confidence !== "high") return false;
    const dq = context.dataQualityScore ?? 100;
    return dq < 75;
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const div = analysis.valuation_divergence!;
    const gap = div.baseGapPct!;
    const dq = context.dataQualityScore ?? 100;

    const message =
      `Extreme Divergenz (${gap > 0 ? "+" : ""}${Math.abs(gap).toFixed(1)}pp) ` +
      `bei hoher Modellkonfidenz, aber unvollständiger Datenbasis (${dq}%). ` +
      `Conviction begrenzt — Datenbasis unterstützt keine volle Überzeugungsstärke trotz hoher Modellkonfidenz.`;

    return {
      id: "V1",
      scope: "valuation",
      severity: "warning",
      issueType: "extreme_divergence",
      message,
      patch: {
        convictionMax: 7,
        warnings: [message],
      },
    };
  },
};

// ─── V2: Conservative model disclaimer ───────────────────────────────────────

/**
 * When the own model says the stock is ≥25% overvalued vs. current price
 * (ownModelUpsidePct ≤ −25), explicitly mark it as a conservative anchor.
 * Informational only — no structural mutations.
 */
export const V2_ConservativeModelDisclaimer: GuardrailRule = {
  id: "V2",
  scope: "valuation",
  severity: "info",
  description:
    "Own model ≥25% below market price → conservative model disclaimer (informational).",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const div = analysis.valuation_divergence;
    if (div?.status !== "available") return false;
    if (div.ownModelUpsidePct == null) return false;
    return div.ownModelUpsidePct <= -25;
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const upside = analysis.valuation_divergence!.ownModelUpsidePct!;
    const message =
      `Eigenes Modell impliziert deutliche Überbewertung (${fmtPct(upside)} Kurspotenzial) — ` +
      `konservative Modellposition als Bewertungsanker, nicht als automatische Verkaufsempfehlung werten.`;

    return {
      id: "V2",
      scope: "valuation",
      severity: "info",
      issueType: "conservative_model_disclaimer",
      message,
      patch: { warnings: [message] },
    };
  },
};

// ─── V3: Bull/bear undercalibration ──────────────────────────────────────────

/**
 * If the own model's best-case (bull) is still below the analyst consensus's
 * worst-case (bear), the two valuations have zero overlap. This signals a major
 * calibration gap between model assumptions and market expectations.
 */
export const V3_BullBearUndercalibration: GuardrailRule = {
  id: "V3",
  scope: "valuation",
  severity: "warning",
  description:
    "Own model bull < analyst consensus bear → zero scenario overlap, extreme undercalibration.",

  condition(context: GuardrailContext): boolean {
    if (!context.hasOwnModel || !context.hasAnalystConsensus) return false;
    if (context.modelBull == null || context.analystConsensusBear == null) return false;
    return context.modelBull < context.analystConsensusBear;
  },

  apply(context: GuardrailContext): GuardrailResult {
    const message =
      `Kalibrierungslücke: Modell-Optimum (Bull: ${context.modelBull}) liegt unter Konsens-Pessimum ` +
      `(Bear: ${context.analystConsensusBear}) — kein Überlappungsbereich zwischen den Szenarien. ` +
      `Stark abweichende Bewertungsannahmen erfordern explizite Begründung.`;

    return {
      id: "V3",
      scope: "valuation",
      severity: "warning",
      issueType: "bull_bear_undercalibration",
      message,
      patch: {
        convictionMax: 7,
        warnings: [message],
      },
    };
  },
};

// ─── V4: Consensus auto-upside guard ─────────────────────────────────────────

/**
 * A "Kaufen" recommendation where the analyst consensus is significantly more
 * optimistic than the own model (≥25pp gap) AND the own model shows zero or
 * negative upside is suspect — the buy thesis cannot rely on consensus alone.
 *
 * Downgrade to "Leicht kaufen" and cap conviction to 6.
 */
export const V4_ConsensusAutoUpsideGuard: GuardrailRule = {
  id: "V4",
  scope: "valuation",
  severity: "warning",
  description:
    "Kaufen without own-model upside and consensus ≥25pp more bullish → downgrade to Leicht kaufen.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const div = analysis.valuation_divergence;
    if (div?.status !== "available") return false;
    if (div.gapLabel !== "consensus_more_bullish") return false;
    if ((div.baseGapPct ?? 0) < 25) return false;
    if (analysis.recommendation !== "Kaufen") return false;
    if (div.ownModelUpsidePct == null) return false;
    return div.ownModelUpsidePct <= 0;
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const div = analysis.valuation_divergence!;
    const gap = fmtPp(div.baseGapPct!);
    const modelUpside = fmtPct(div.ownModelUpsidePct!);

    const message =
      `'Kaufen'-Empfehlung ohne eigenes Kurspotenzial (Modell: ${modelUpside}) — ` +
      `Analystenkonsens ist ${gap} optimistischer, aber eigenes Modell bestätigt keinen Upside. ` +
      `Auf 'Leicht kaufen' abgeschwächt.`;

    return {
      id: "V4",
      scope: "valuation",
      severity: "warning",
      issueType: "consensus_auto_upside",
      message,
      patch: {
        recommendation: "Leicht kaufen",
        convictionMax: 6,
        warnings: [message],
      },
    };
  },
};

// ─── V5: Own model divergence caution ────────────────────────────────────────

/**
 * When the own model is significantly more bullish than the market consensus
 * (≥25pp), the analysis leans on model assumptions that are more optimistic
 * than consensus — cap conviction unless the model is both high-confidence AND
 * data quality is ≥75 (well-supported high-conviction scenario).
 */
export const V5_OwnModelDivergenceCaution: GuardrailRule = {
  id: "V5",
  scope: "valuation",
  severity: "warning",
  description:
    "Own model ≥25pp more bullish than consensus → conviction cap (unless high conf + dq≥75).",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const div = analysis.valuation_divergence;
    if (div?.status !== "available") return false;
    if (div.gapLabel !== "own_model_more_bullish") return false;
    if (div.baseGapPct == null) return false;
    if (Math.abs(div.baseGapPct) < 25) return false;
    // Exception: high confidence with strong data → justified to hold strong conviction
    const dq = context.dataQualityScore ?? 100;
    return !(analysis.valuation_confidence === "high" && dq >= 75);
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const div = analysis.valuation_divergence!;
    const gap = fmtPp(div.baseGapPct!);
    const modelUpside = fmtPct(div.ownModelUpsidePct ?? 0);
    const consUpside = fmtPct(div.consensusUpsidePct ?? 0);

    const message =
      `Eigenes Modell deutlich bullischer als Analystenkonsens (${modelUpside} vs. ${consUpside}, Abstand: ${gap}) — ` +
      `Modell-Annahmen sind optimistischer als der Marktkonsens; Conviction begrenzt.`;

    return {
      id: "V5",
      scope: "valuation",
      severity: "warning",
      issueType: "own_model_divergence_caution",
      message,
      patch: {
        convictionMax: 7,
        warnings: [message],
      },
    };
  },
};

// ─── V7: Low confidence model with available divergence ──────────────────────

/**
 * When divergence is fully calculable but model confidence is "low",
 * the divergence numbers are unreliable. Add a divergence-specific warning
 * and cap conviction.
 *
 * Complements G9 (which removes the target and caps conviction whenever model
 * confidence is low). V7 adds the divergence-specific framing.
 */
export const V7_LowConfidenceDivergence: GuardrailRule = {
  id: "V7",
  scope: "valuation",
  severity: "warning",
  description:
    "Divergence available but model confidence low → divergence-specific warning + conviction cap.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const div = analysis.valuation_divergence;
    if (div?.status !== "available") return false;
    return analysis.valuation_confidence === "low";
  },

  apply(): GuardrailResult {
    const message =
      "Divergenzrechnung verfügbar, aber Modellkonfidenz niedrig — " +
      "Abweichung zum Analystenkonsens ist bedingt aussagekräftig. Conviction begrenzt.";
    return {
      id: "V7",
      scope: "valuation",
      severity: "warning",
      issueType: "low_confidence_divergence",
      message,
      patch: {
        convictionMax: 6,
        warnings: [message],
      },
    };
  },
};

// ─── V8: Consensus-only valuation ─────────────────────────────────────────────

/**
 * When analyst consensus is available but no own valuation model was built,
 * add an informational note. The analysis can still proceed, but the lack of
 * an own model limits the depth of valuation reasoning.
 *
 * Note: G4 handles the pipeline anomaly (divergence somehow shows "available"
 * without a model). V8 handles the normal/expected case.
 */
export const V8_ConsensusOnlyValuation: GuardrailRule = {
  id: "V8",
  scope: "valuation",
  severity: "info",
  description:
    "Analyst consensus available but no own model — informational note about limited valuation depth.",

  condition(context: GuardrailContext): boolean {
    return context.hasAnalystConsensus && !context.hasOwnModel;
  },

  apply(): GuardrailResult {
    const message =
      "Nur Analystenkonsens verfügbar — kein eigenes Bewertungsmodell berechnet. " +
      "Bewertungsaussagen basieren ausschließlich auf externen Schätzungen.";
    return {
      id: "V8",
      scope: "valuation",
      severity: "info",
      issueType: "consensus_only_valuation",
      message,
      patch: { warnings: [message] },
    };
  },
};

// ─── V9: Own model only valuation ────────────────────────────────────────────

/**
 * When an own valuation model is available but no analyst consensus exists,
 * add an informational note. No external comparison is possible.
 */
export const V9_OwnModelOnlyValuation: GuardrailRule = {
  id: "V9",
  scope: "valuation",
  severity: "info",
  description:
    "Own model available but no analyst consensus — informational note, no external comparison.",

  condition(context: GuardrailContext): boolean {
    return context.hasOwnModel && !context.hasAnalystConsensus;
  },

  apply(): GuardrailResult {
    const message =
      "Nur eigenes Modell verfügbar — kein Analystenkonsens vorhanden. " +
      "Kein externer Bewertungsvergleich möglich; Divergenz nicht berechenbar.";
    return {
      id: "V9",
      scope: "valuation",
      severity: "info",
      issueType: "own_model_only_valuation",
      message,
      patch: { warnings: [message] },
    };
  },
};

// ─── V11: Extreme upside/downside ─────────────────────────────────────────────

/**
 * When own model or analyst consensus implies ≥75% upside or ≥75% downside
 * from current price, the valuation is at the outer edge of reliability.
 * Cap conviction to 7 and add a warning.
 *
 * Note: ownModelUpsidePct and consensusUpsidePct default to 0 when not set
 * (via ?? operator), so this rule safely skips when upside data is absent.
 */
export const V11_ExtremeUpsideDownside: GuardrailRule = {
  id: "V11",
  scope: "valuation",
  severity: "warning",
  description:
    "Model or consensus upside/downside ≥75% → extreme estimate warning + conviction cap.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const div = analysis.valuation_divergence;
    if (div?.status !== "available") return false;
    const ownUpside = div.ownModelUpsidePct ?? 0;
    const consUpside = div.consensusUpsidePct ?? 0;
    return Math.abs(ownUpside) >= 75 || Math.abs(consUpside) >= 75;
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const div = analysis.valuation_divergence!;
    const ownUpside = fmtPct(div.ownModelUpsidePct ?? 0);
    const consUpside = fmtPct(div.consensusUpsidePct ?? 0);

    const message =
      `Extreme Upside/Downside-Schätzung erkannt (Modell: ${ownUpside}, Konsens: ${consUpside}) — ` +
      `Kursziele über ±75% vom aktuellen Kurs sind mit stark erhöhter Unsicherheit verbunden. Conviction begrenzt.`;

    return {
      id: "V11",
      scope: "valuation",
      severity: "warning",
      issueType: "extreme_upside_downside",
      message,
      patch: {
        convictionMax: 7,
        warnings: [message],
      },
    };
  },
};

// ─── V12: German divergence template ─────────────────────────────────────────

/**
 * When divergence is fully available (both consensus and model upside numbers
 * are present), add a German-language summary to data_quality_guardrails for
 * display in the UI. The original explanationSeed stays in English for Opus.
 *
 * Runs last within Phase 3 so it sees the final (post-V6/V10) divergence state.
 * Only fires when both consensusUpsidePct AND ownModelUpsidePct are non-null,
 * ensuring we have the numbers needed for a meaningful German summary.
 */
export const V12_DivergenceLanguageGermanTemplate: GuardrailRule = {
  id: "V12",
  scope: "valuation",
  severity: "info",
  description:
    "Divergence available → add German-language summary to data_quality_guardrails.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const div = analysis.valuation_divergence;
    return (
      div?.status === "available" &&
      div.consensusUpsidePct != null &&
      div.ownModelUpsidePct != null
    );
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const div = analysis.valuation_divergence!;
    const gap = fmtPp(div.baseGapPct ?? 0);
    const consUpside = fmtPct(div.consensusUpsidePct!);
    const ownUpside = fmtPct(div.ownModelUpsidePct!);

    let germanExplanation: string;

    if (div.gapLabel === "aligned") {
      germanExplanation =
        `Bewertungsüberblick: Eigenes Modell (${ownUpside} Kurspotenzial) und Analystenkonsens ` +
        `(${consUpside} Kurspotenzial) sind weitgehend übereinstimmend (Abstand: ${gap}).`;
    } else if (div.gapLabel === "consensus_more_bullish") {
      germanExplanation =
        `Bewertungsüberblick: Analystenkonsens (${consUpside} Kurspotenzial) ist ${gap} optimistischer ` +
        `als das eigene Modell (${ownUpside} Kurspotenzial). ` +
        `Eigenes Modell dient als konservativer Bewertungsanker.`;
    } else {
      // own_model_more_bullish
      germanExplanation =
        `Bewertungsüberblick: Eigenes Modell (${ownUpside} Kurspotenzial) ist ${gap} optimistischer ` +
        `als der Analystenkonsens (${consUpside} Kurspotenzial). ` +
        `Modell-Annahmen sind bullischer als der aktuelle Marktkonsens.`;
    }

    return {
      id: "V12",
      scope: "valuation",
      severity: "info",
      issueType: "divergence_language",
      message: germanExplanation,
      patch: { warnings: [germanExplanation] },
    };
  },
};

// ─── Exported rule array (ordered for correct sequential execution) ────────────

/**
 * All Phase 3 valuation & divergence rules in execution order.
 * V6 and V10 run first (safety nets that may null out divergence).
 * V12 runs last (German template, needs final divergence state).
 */
export const VALUATION_DIVERGENCE_RULES: GuardrailRule[] = [
  V6_MissingCurrentPrice,
  V10_ScenarioOrderingInvalid,
  V1_ExtremeDivergenceRequiresInterpretation,
  V2_ConservativeModelDisclaimer,
  V3_BullBearUndercalibration,
  V4_ConsensusAutoUpsideGuard,
  V5_OwnModelDivergenceCaution,
  V7_LowConfidenceDivergence,
  V8_ConsensusOnlyValuation,
  V9_OwnModelOnlyValuation,
  V11_ExtremeUpsideDownside,
  V12_DivergenceLanguageGermanTemplate,
];
