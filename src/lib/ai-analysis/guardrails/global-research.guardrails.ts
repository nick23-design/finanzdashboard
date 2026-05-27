/**
 * Global Research Guardrails — Phase 2 + Phase 3.5
 *
 * Generic quality checks for stock analyses, independent of sector.
 * All rules are synchronous, deterministic, and make no LLM/VERA calls.
 *
 * Phase 2 (runs after G1–G6, before Phase 3 V-rules):
 * G7  — No strong recommendation without support
 * G8  — No pseudo-precision with wide scenario range
 * G9  — Low confidence model limits valuation claims
 * G10 — Missing own model limits undervaluation/overvaluation claims
 * G11 — Unclear source for numerical claim
 * G12 — Recommendation/conviction consistency
 * G13 — Entry quality cannot contradict bearish recommendation
 * G14 — News sentiment cannot override weak valuation alone
 * G15 — Technical timing cannot override fundamental uncertainty
 * G16 — Large consensus/model divergence requires explanation
 *
 * Phase 3.5 (runs after Phase 3 V-rules, before Phase 4 D-rules):
 * G17 — Low conf + bearish model + defensive entry + no support → cap to 'Halten'
 *
 * Run AFTER Phase 1 rules (G1–G6). G12 and G13 rely on seeing the
 * recommendations already patched by G5a, G6, and G7.
 * G17 is placed AFTER Phase 3 so it sees valuation_confidence set by
 * V7/V10/V13 before evaluating recommendation consistency.
 */

import type {
  AllowedRecommendation,
  EntryQualityLabel,
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailPatch,
  GuardrailResult,
  GuardrailRule,
} from "./types";

// ─── G7: No strong recommendation without sufficient support ─────────────────

/**
 * "Kaufen" and "Verkaufen" are strong signals that require backing evidence.
 * If the analysis lacks own model, has low model confidence, or has poor data
 * quality, downgrade to the moderate equivalent.
 *
 * "Kaufen" → "Leicht kaufen" (more conservative, standard merge works).
 * "Verkaufen" → "Leicht verkaufen" (less conservative, uses recommendationExact).
 *
 * NOTE: G5a already handles dataQualityScore < 50. G7 covers the 50–59 gap
 * and the "no model" / "low confidence" cases that G5a doesn't touch.
 * Because G7 runs after G5a, it never fires when G5a already downgraded Kaufen.
 */
export const G7_NoStrongRecommendationWithoutSupport: GuardrailRule = {
  id: "G7",
  scope: "global",
  severity: "warning",
  description:
    "Strong buy/sell without model, good confidence, or adequate data → downgrade to moderate.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (
      analysis.recommendation !== "Kaufen" &&
      analysis.recommendation !== "Verkaufen"
    ) {
      return false;
    }
    const dq = context.dataQualityScore ?? 100;
    const modelConf = analysis.valuation_confidence;
    // Fire if ANY critical support is absent
    return !context.hasOwnModel || modelConf === "low" || dq < 60;
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const rec = analysis.recommendation as AllowedRecommendation;
    const isBuy = rec === "Kaufen";
    const downgraded: AllowedRecommendation = isBuy ? "Leicht kaufen" : "Leicht verkaufen";

    const message = `Starke Empfehlung '${rec}' auf '${downgraded}' abgeschwächt — nicht ausreichend durch Modell, Datenqualität oder Divergenz gestützt.`;

    const patch: GuardrailPatch = {
      convictionMax: 6,
      warnings: [message],
    };

    if (isBuy) {
      // "Kaufen" → "Leicht kaufen": more conservative — standard conservative merge
      patch.recommendation = "Leicht kaufen";
    } else {
      // "Verkaufen" → "Leicht verkaufen": moderating bearish — needs exact override
      patch.recommendationExact = "Leicht verkaufen";
    }

    return {
      id: "G7",
      scope: "global",
      severity: "warning",
      issueType: "recommendation_unsupported",
      message,
      patch,
    };
  },
};

// ─── G8: No pseudo-precision with wide scenario range ────────────────────────

/**
 * A very wide bear/base/bull range signals high model uncertainty.
 * In that case, a point-precise price target is misleading.
 *
 * Fires when the own model exists and:
 *   (bull − bear) / |base| > 0.60   OR   bull / bear > 2.0 (if bear > 0)
 */
export const G8_NoPseudoPrecisionWithWideRange: GuardrailRule = {
  id: "G8",
  scope: "global",
  severity: "warning",
  description:
    "Wide scenario range (bull−bear spread > 60% of base, or bull/bear > 2) → remove precise target, cap conviction.",

  condition(context: GuardrailContext): boolean {
    if (!context.hasOwnModel) return false;
    const bear = context.modelBear;
    const base = context.ownModelBase;
    const bull = context.modelBull;
    if (bear == null || base == null || bull == null || base === 0) return false;

    const relativeSpread = (bull - bear) / Math.abs(base);
    const ratio = bear > 0 ? bull / bear : Infinity;

    return relativeSpread > 0.6 || ratio > 2.0;
  },

  apply(context: GuardrailContext): GuardrailResult {
    const bear = context.modelBear ?? 0;
    const base = context.ownModelBase ?? 0;
    const bull = context.modelBull ?? 0;
    const spread = base !== 0
      ? ((bull - bear) / Math.abs(base) * 100).toFixed(0)
      : "—";

    const message = `Szenario-Spanne zu breit (Spread ≈ ${spread}% des Basiswerts) — punktgenaues Kursziel entfernt; Analyse verwendet Szenario-Bereich statt Punktziel.`;

    return {
      id: "G8",
      scope: "global",
      severity: "warning",
      issueType: "scenario_range_too_wide",
      message,
      patch: {
        removeTarget: true,
        convictionMax: 7,
        warnings: [message],
      },
    };
  },
};

// ─── G9: Low confidence model limits valuation claims ────────────────────────

/**
 * When the own model is present but confidence is "low", its output is
 * unreliable as a precise valuation anchor. Remove target and cap conviction.
 *
 * Complements G5b (which fires only when target exists). G9 also applies
 * the conviction cap even when no target was set.
 */
export const G9_LowConfidenceModelLimitsValuationClaims: GuardrailRule = {
  id: "G9",
  scope: "data_quality",
  severity: "warning",
  description:
    "Own model present but confidence 'low' → remove target, cap conviction to 6.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    return context.hasOwnModel && analysis.valuation_confidence === "low";
  },

  apply(): GuardrailResult {
    const message =
      "Eigenes Modell mit niedriger Konfidenz — Bewertung ist nur grober Orientierungsrahmen. Präzises Kursziel entfernt, Conviction begrenzt.";
    return {
      id: "G9",
      scope: "data_quality",
      severity: "warning",
      issueType: "model_low_confidence",
      message,
      patch: {
        removeTarget: true,
        convictionMax: 6,
        warnings: [message],
      },
    };
  },
};

// ─── G10: Missing own model limits valuation ownership claims ─────────────────

/**
 * Without an own valuation model, the analysis must not assert statements
 * like "unterbewertet" or "eigenes Modell zeigt" — these imply a quantitative
 * backing that is absent.
 *
 * Targets "inference" claims (the only source type without an external data
 * source) that contain hard valuation-ownership language.
 * Patches their evidence with a [Kein eigenes Modell] prefix.
 */
const VALUATION_OWNERSHIP_PATTERN = String.raw`unterbewertet|überbewertet|fair\s*value|intrinsisch|innerer\s+wert|eigenes?\s+modell\s+(zeigt|deutet)|upside\s+laut\s+modell|downside\s+laut\s+modell`;

export const G10_MissingOwnModelLimitsValuationClaims: GuardrailRule = {
  id: "G10",
  scope: "research",
  severity: "warning",
  description:
    "No own model but inference claims use valuation-ownership language → mark as unsupported.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (context.hasOwnModel) return false;
    const re = new RegExp(VALUATION_OWNERSHIP_PATTERN, "i");
    return analysis.claims.some(
      c =>
        c.source_type === "inference" &&
        re.test(`${c.claim} ${c.evidence}`),
    );
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const re = new RegExp(VALUATION_OWNERSHIP_PATTERN, "i");
    const count = analysis.claims.filter(
      c =>
        c.source_type === "inference" &&
        re.test(`${c.claim} ${c.evidence}`),
    ).length;

    const message = `Eigene Unter-/Überbewertungsclaims begrenzt — kein eigenes Bewertungsmodell verfügbar (${count} Claim(s) markiert).`;

    return {
      id: "G10",
      scope: "research",
      severity: "warning",
      issueType: "unsupported_claim",
      message,
      patch: {
        claimEvidencePrefix: {
          sourceType: "inference",
          pattern: VALUATION_OWNERSHIP_PATTERN,
          prefix: "[Kein eigenes Modell — ungestützte Bewertungsaussage]",
        },
        warnings: [message],
      },
    };
  },
};

// ─── G11: Unclear source for numerical claim ─────────────────────────────────

/**
 * "Inference" claims that quote percentages or price levels have no
 * verifiable external source. Cap their confidence to ≤ 5.
 *
 * Only fires when at least one matching claim has confidence > 5 (no-op guard).
 *
 * Uses claimCapByPattern (precise) rather than claimCapBySourceType (broad)
 * to avoid capping non-numerical inference claims.
 */
const NUMERICAL_CLAIM_PATTERN = String.raw`\d+(?:[.,]\d+)?\s*%|\$\s*[\d,.]+|\b\d{2,5}(?:[.,]\d+)?\s*(?:USD|EUR)\b`;

export const G11_UnclearSourceForNumericalClaim: GuardrailRule = {
  id: "G11",
  scope: "research",
  severity: "info",
  description:
    "Inference claims with numerical values (%, prices) capped at confidence 5.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const re = new RegExp(NUMERICAL_CLAIM_PATTERN);
    return analysis.claims.some(
      c =>
        c.source_type === "inference" &&
        re.test(`${c.claim} ${c.evidence}`) &&
        c.confidence > 5,
    );
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const re = new RegExp(NUMERICAL_CLAIM_PATTERN);
    const count = analysis.claims.filter(
      c =>
        c.source_type === "inference" &&
        re.test(`${c.claim} ${c.evidence}`) &&
        c.confidence > 5,
    ).length;

    const message = `${count} numerische Inferenz-Aussage(n) ohne klare Datenquelle — Konfidenz auf ≤5 begrenzt.`;

    return {
      id: "G11",
      scope: "research",
      severity: "info",
      issueType: "unsupported_claim",
      message,
      patch: {
        claimCapByPattern: {
          sourceType: "inference",
          pattern: NUMERICAL_CLAIM_PATTERN,
          cap: 5,
        },
        warnings: [message],
      },
    };
  },
};

// ─── G12: Recommendation/conviction consistency ───────────────────────────────

/**
 * Conviction must be proportional to recommendation strength and data quality.
 *
 * Rules:
 *   "Halten"                       → max conviction 7
 *   "Leicht kaufen"/"Leicht verkaufen" → max conviction 8
 *   dataQualityScore < 55          → max conviction 6
 *   valuation_confidence = "low"   → max conviction 6
 *
 * Fires only when at least one cap would actually reduce the current conviction.
 * Applies the most restrictive (lowest) cap from all active sub-conditions.
 *
 * NOTE: Runs after G5a, G7 (which also cap conviction) so this fires only
 * when a remaining inconsistency still exists after earlier rules ran.
 */
export const G12_RecommendationConvictionConsistency: GuardrailRule = {
  id: "G12",
  scope: "global",
  severity: "info",
  description:
    "Cap conviction to match recommendation level, data quality, and model confidence.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const conv = analysis.conviction;
    const rec = analysis.recommendation;
    const dq = context.dataQualityScore ?? 100;
    const modelConf = analysis.valuation_confidence;

    if (rec === "Halten" && conv > 7) return true;
    if ((rec === "Leicht kaufen" || rec === "Leicht verkaufen") && conv > 8) return true;
    if (dq < 55 && conv > 6) return true;
    if (modelConf === "low" && conv > 6) return true;
    return false;
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const conv = analysis.conviction;
    const rec = analysis.recommendation;
    const dq = context.dataQualityScore ?? 100;
    const modelConf = analysis.valuation_confidence;

    const caps: { cap: number; reason: string }[] = [];

    if (rec === "Halten" && conv > 7) {
      caps.push({ cap: 7, reason: `'Halten' erlaubt maximal Conviction 7 (war ${conv})` });
    }
    if ((rec === "Leicht kaufen" || rec === "Leicht verkaufen") && conv > 8) {
      caps.push({ cap: 8, reason: `'${rec}' erlaubt maximal Conviction 8 (war ${conv})` });
    }
    if (dq < 55 && conv > 6) {
      caps.push({ cap: 6, reason: `Datenbasis ${dq}% < 55 — maximal Conviction 6 (war ${conv})` });
    }
    if (modelConf === "low" && conv > 6) {
      caps.push({ cap: 6, reason: `Niedrige Modellkonfidenz — maximal Conviction 6 (war ${conv})` });
    }

    const minCap = Math.min(...caps.map(c => c.cap));
    const reasons = caps.map(c => c.reason).join(" / ");
    const message = `Conviction auf ≤${minCap} begrenzt: ${reasons}.`;

    return {
      id: "G12",
      scope: "global",
      severity: "info",
      issueType: "conviction_mismatch",
      message,
      patch: {
        convictionMax: minCap,
        warnings: [message],
      },
    };
  },
};

// ─── G13: Entry quality cannot contradict bearish recommendation ─────────────

/**
 * For sell recommendations ("Leicht verkaufen", "Verkaufen"), a positive
 * entry quality ("attraktiv" or "fair") is contradictory — it implies
 * an attractive buying opportunity which conflicts with selling.
 *
 * Downgrade:
 *   "Verkaufen"       + "attraktiv"/"fair" → "Rücksetzer abwarten"
 *   "Leicht verkaufen" + "attraktiv"/"fair" → "nicht hinterherrennen"
 *
 * NOTE: G6 already handles "Halten"/"Leicht verkaufen"/"Verkaufen" + "attraktiv"
 * → "fair". G13 handles the residual case where a sell recommendation still
 * carries a "fair" or "attraktiv" entry quality after G6 has run.
 */
const BULLISH_ENTRY_LABELS: EntryQualityLabel[] = ["attraktiv", "fair"];
const SELL_RECOMMENDATIONS: string[] = ["Leicht verkaufen", "Verkaufen"];

export const G13_EntryQualityBearishMismatch: GuardrailRule = {
  id: "G13",
  scope: "research",
  severity: "warning",
  description:
    "Sell recommendation with 'attraktiv' or 'fair' entry quality → downgrade to bearish entry label.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (!SELL_RECOMMENDATIONS.includes(analysis.recommendation)) return false;
    return BULLISH_ENTRY_LABELS.includes(
      analysis.entry_quality?.label as EntryQualityLabel,
    );
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const rec = analysis.recommendation;
    const currentLabel = analysis.entry_quality?.label ?? "attraktiv";
    const newLabel: EntryQualityLabel =
      rec === "Verkaufen" ? "Rücksetzer abwarten" : "nicht hinterherrennen";

    const message = `Entry Quality auf '${newLabel}' korrigiert — '${rec}'-Empfehlung ist nicht vereinbar mit '${currentLabel}'.`;

    return {
      id: "G13",
      scope: "research",
      severity: "warning",
      issueType: "entry_quality_bearish_mismatch",
      message,
      patch: {
        entryQuality: {
          label: newLabel,
          rationale: `'${rec}'-Empfehlung erfordert einen vorsichtigen Einstiegshinweis, nicht '${currentLabel}'.`,
        },
        warnings: [message],
      },
    };
  },
};

// ─── G14: News sentiment cannot override weak valuation alone ─────────────────

/**
 * A buy recommendation driven primarily by news sentiment — without a
 * supporting valuation model or analyst consensus — is unreliable.
 *
 * Proxy for "primarily news-driven": news claims > 50% of total claims.
 *
 * Fires only when:
 *   - Recommendation is "Kaufen" or "Leicht kaufen"
 *   - No own model AND no analyst consensus
 *   - dataQualityScore < 70
 *   - More than half of all claims are "news" source
 */
export const G14_NewsSentimentCannotOverrideWeakValuationAlone: GuardrailRule = {
  id: "G14",
  scope: "research",
  severity: "warning",
  description:
    "Buy recommendation without model/consensus and dominated by news claims → downgrade, cap conviction.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const isBuy =
      analysis.recommendation === "Kaufen" ||
      analysis.recommendation === "Leicht kaufen";
    if (!isBuy) return false;

    const hasValuationSupport =
      context.hasOwnModel || context.hasAnalystConsensus;
    if (hasValuationSupport) return false;

    const dq = context.dataQualityScore ?? 100;
    if (dq >= 70) return false;

    const total = analysis.claims.length;
    if (total === 0) return false;
    const newsClaims = analysis.claims.filter(c => c.source_type === "news").length;
    return newsClaims > total * 0.5;
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const rec = analysis.recommendation;
    // "Kaufen" → "Leicht kaufen"; "Leicht kaufen" unchanged (only conviction cap)
    const downgraded: AllowedRecommendation =
      rec === "Kaufen" ? "Leicht kaufen" : (rec as AllowedRecommendation);

    const message =
      "Positive Nachrichtenstimmung nicht als alleinige Grundlage für Kaufempfehlung gewertet — kein eigenes Modell / kein Analystenkonsens verfügbar.";

    const patch: GuardrailPatch = {
      convictionMax: 6,
      warnings: [message],
    };
    if (rec === "Kaufen") {
      patch.recommendation = downgraded;
    }

    return {
      id: "G14",
      scope: "research",
      severity: "warning",
      issueType: "news_sentiment_insufficient",
      message,
      patch,
    };
  },
};

// ─── G15: Technical timing cannot override fundamental uncertainty ────────────

/**
 * A buy recommendation driven primarily by market-intel / technical signals
 * (RSI, MA50/MA200, momentum — proxied by dominant market_intel claims)
 * must not override weak fundamental data.
 *
 * Proxy for "primarily technical": market_intel claims > 50% of total.
 *
 * Fires only when:
 *   - Recommendation is "Kaufen" or "Leicht kaufen"
 *   - Weak fundamentals: dataQualityScore < 60 OR no own model OR modelConf = "low"
 *   - More than half of all claims are "market_intel" source
 */
export const G15_TechnicalTimingCannotOverrideFundamentalUncertainty: GuardrailRule = {
  id: "G15",
  scope: "research",
  severity: "warning",
  description:
    "Buy recommendation dominated by technical claims with weak fundamental basis → downgrade, cap conviction.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const isBuy =
      analysis.recommendation === "Kaufen" ||
      analysis.recommendation === "Leicht kaufen";
    if (!isBuy) return false;

    const dq = context.dataQualityScore ?? 100;
    const hasWeakFundamentals =
      dq < 60 ||
      !context.hasOwnModel ||
      analysis.valuation_confidence === "low";
    if (!hasWeakFundamentals) return false;

    const total = analysis.claims.length;
    if (total === 0) return false;
    const techClaims = analysis.claims.filter(c => c.source_type === "market_intel").length;
    return techClaims > total * 0.5;
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const rec = analysis.recommendation;
    const downgraded: AllowedRecommendation =
      rec === "Kaufen" ? "Leicht kaufen" : (rec as AllowedRecommendation);

    const message =
      "Technisches Timing begrenzt gewichtet — fundamentale Daten oder Modellkonfidenz unsicher. Empfehlung darf nicht stärker als 'Leicht kaufen' sein.";

    const patch: GuardrailPatch = {
      convictionMax: 6,
      warnings: [message],
    };
    if (rec === "Kaufen") {
      patch.recommendation = downgraded;
    }

    return {
      id: "G15",
      scope: "research",
      severity: "warning",
      issueType: "technical_timing_insufficient",
      message,
      patch,
    };
  },
};

// ─── G16: Large consensus/model divergence requires explanation ───────────────

/**
 * When the gap between analyst consensus and own model is ≥ 40% of the
 * current price, the analysis must explain the discrepancy as a
 * model/assumption difference — not silently pick one side.
 *
 * Additionally, conviction is capped at 7 unless model confidence is "high"
 * (a high-confidence own model can justify strong conviction despite divergence).
 */
export const G16_ExtremeDivergenceRequiresExplanation: GuardrailRule = {
  id: "G16",
  scope: "valuation",
  severity: "warning",
  description:
    "Extreme consensus/model divergence (|gap| ≥ 40%) → explanation warning, conviction cap if not high confidence.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const div = analysis.valuation_divergence;
    if (div?.status !== "available") return false;
    if (div.baseGapPct == null) return false;
    return Math.abs(div.baseGapPct) >= 40;
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const div = analysis.valuation_divergence!;
    const pct = div.baseGapPct!;
    const sign = pct > 0 ? "+" : "";
    const isHighConf = analysis.valuation_confidence === "high";

    const message =
      `Extreme Divergenz zwischen Analystenkonsens und eigenem Modell (${sign}${pct.toFixed(1)}%). ` +
      `Unterschied muss als Modell-/Annahmenunterschied erklärt werden (Konservatismus, Wachstums- oder Margenannahmen, nicht modellierte Optionalität).`;

    const patch: GuardrailPatch = { warnings: [message] };
    if (!isHighConf) {
      patch.convictionMax = 7;
    }

    return {
      id: "G16",
      scope: "valuation",
      severity: "warning",
      issueType: "extreme_divergence",
      message,
      patch,
    };
  },
};

// ─── G17: Low conf + bearish model + defensive entry → cap to Halten ─────────

/**
 * When ALL of the following converge simultaneously:
 *   - valuation_confidence = "low"           (weak analytical basis)
 *   - dataQualityScore < 60                  (thin data)
 *   - divergence.status ≠ "available"        (no valuation-divergence support)
 *   - no structured analyst consensus        (!hasAnalystConsensus)
 *   - own model upside ≤ −25%               (model is meaningfully bearish)
 *   - entry quality is defensively labelled  (timing signal is also cautious)
 *
 * …then a bullish recommendation ("Kaufen" or "Leicht kaufen") is internally
 * inconsistent. Four separate signals all point away from entry; the
 * recommendation must be capped to "Halten".
 *
 * This is NOT a sector-specific rule. It fires for any company where these
 * multi-dimensional consistency constraints are violated.
 *
 * Placement: runs between Phase 3 (V-rules) and Phase 4 (D-rules) in index.ts,
 * so it sees valuation_confidence after V7/V10/V13 may have set it to "low".
 *
 * Exception handling (baked into conditions):
 *   - Strong positive model (upside > −25%) → ownModelUpside > -25 → doesn't fire
 *   - Structural consensus/divergence support → hasAnalystConsensus=true or
 *     divergence.status="available" → doesn't fire
 */

/** Entry labels that represent a defensive / cautious timing signal. */
const DEFENSIVE_ENTRY_LABELS: EntryQualityLabel[] = [
  "Rücksetzer abwarten",
  "nicht hinterherrennen",
  "nur spekulativ",
  "überhitzt",
];

/**
 * Computes own-model upside as % relative to current price.
 * Returns null when own model or price data are unavailable.
 */
function computeOwnModelUpsidePct(context: GuardrailContext): number | null {
  if (!context.hasOwnModel) return null;
  if (context.ownModelBase == null || !context.currentPrice) return null;
  return ((context.ownModelBase - context.currentPrice) / context.currentPrice) * 100;
}

export const G17_LowConfidenceBearishModelBullishRecommendation: GuardrailRule = {
  id: "G17",
  scope: "global",
  severity: "warning",
  description:
    "Low conf + dq<60 + bearish own model (≤−25%) + no consensus/divergence + defensive entry → cap rec to 'Halten'.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    // Only fires for bullish recommendations (conservative merge will enforce "Halten" cap)
    if (
      analysis.recommendation !== "Kaufen" &&
      analysis.recommendation !== "Leicht kaufen"
    ) {
      return false;
    }

    // Requires low valuation confidence (set by AI or by V7/V10/V13 in Phase 3)
    if (analysis.valuation_confidence !== "low") return false;

    // Requires weak data quality
    if ((context.dataQualityScore ?? 100) >= 60) return false;

    // No available divergence support — divergence.status="available" would provide backing
    if (analysis.valuation_divergence?.status === "available") return false;

    // No structured analyst consensus as an independent positive signal
    if (context.hasAnalystConsensus) return false;

    // Own model must exist AND be meaningfully bearish
    const ownModelUpside = computeOwnModelUpsidePct(context);
    if (ownModelUpside === null || ownModelUpside > -25) return false;

    // Entry quality must be defensively labelled (timing signal also cautious)
    const label = analysis.entry_quality?.label;
    return DEFENSIVE_ENTRY_LABELS.includes(label as EntryQualityLabel);
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const dq = context.dataQualityScore ?? 0;
    const upside = computeOwnModelUpsidePct(context) ?? 0;
    const label = analysis.entry_quality?.label ?? "defensiv";
    const oldRec = analysis.recommendation;

    const message =
      `Empfehlung von '${oldRec}' auf 'Halten' angepasst — vier konvergente Warnsignale: ` +
      `niedrige Bewertungskonfidenz ('low'), schwache Datenbasis (${dq}/100), ` +
      `konservatives Eigenmodell (${upside.toFixed(0)}% Upside-Potenzial) ` +
      `und defensiver Einstiegshinweis ('${label}'). ` +
      `'${oldRec}' ist ohne strukturierten Analystenkonsens oder positive Divergenzunterstützung nicht haltbar. ` +
      `Neue Einstiege nur gestaffelt oder nach Rücksetzern.`;

    return {
      id: "G17",
      scope: "global",
      severity: "warning",
      issueType: "bearish_model_bullish_recommendation",
      message,
      patch: {
        recommendation: "Halten",
        convictionMax: 6,
        warnings: [message],
      },
    };
  },
};
