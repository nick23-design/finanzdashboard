import type {
  AllowedRecommendation,
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailPatch,
  GuardrailResult,
  GuardrailRule,
} from "./types";

const HARD_RECOMMENDATIONS = new Set(["Kaufen", "Verkaufen"]);
const BUY_RECOMMENDATIONS = new Set(["Kaufen", "Leicht kaufen"]);
const SELL_RECOMMENDATIONS = new Set(["Verkaufen", "Leicht verkaufen"]);

function moderateHardRecommendation(recommendation: string): AllowedRecommendation | null {
  if (recommendation === "Kaufen") return "Leicht kaufen";
  if (recommendation === "Verkaufen") return "Leicht verkaufen";
  return null;
}

function currentPriceUpside(base: number | null | undefined, price: number | null | undefined): number | null {
  if (typeof base !== "number" || typeof price !== "number" || price <= 0) return null;
  return ((base - price) / price) * 100;
}

function hasPoorOrPartialDcf(context: GuardrailContext): boolean {
  const fit = context.dcfPlausibility?.fit;
  return fit === "poor" || fit === "partial";
}

function hardRatingPatch(
  analysis: GuardrailAnalysis,
  message: string,
  extra: Partial<GuardrailPatch> = {},
): GuardrailPatch {
  const moderated = moderateHardRecommendation(analysis.recommendation);
  return {
    ...(moderated ? { recommendationExact: moderated } : {}),
    convictionMax: 6,
    warnings: [message],
    ...extra,
  };
}

export const C1_ExtremeModelDisagreementAvoidsHardRating: GuardrailRule = {
  id: "C1",
  scope: "company_type",
  severity: "warning",
  description: "Extreme valuation/model disagreement should moderate hard Buy/Sell ratings.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (!HARD_RECOMMENDATIONS.has(analysis.recommendation)) return false;
    return context.valuationDivergenceAnalysis?.ratingImpact.avoidHardBuySell === true;
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const level = context.valuationDivergenceAnalysis?.divergenceLevel ?? "high";
    const message =
      `Bewertungsmodelle widersprechen sich deutlich (${level}) oder der Modell-Fit ist schwach. ` +
      `Harte Kauf-/Verkaufssignale werden abgeschwächt, bis die Bewertungsanker plausibel zusammenpassen.`;

    return {
      id: "C1",
      scope: "company_type",
      severity: "warning",
      issueType: "hard_rating_with_extreme_model_disagreement",
      message,
      patch: hardRatingPatch(analysis, message, { valuationConfidenceCap: "medium" }),
    };
  },
};

export const C2_QualityCompounderNoAutomaticSell: GuardrailRule = {
  id: "C2",
  scope: "company_type",
  severity: "warning",
  description: "Quality compounders should not receive a hard Sell solely from valuation overhang.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (context.companyTypeKey !== "quality_compounder") return false;
    if (!SELL_RECOMMENDATIONS.has(analysis.recommendation)) return false;

    const ownModelUpside =
      analysis.valuation_divergence?.status === "available"
        ? analysis.valuation_divergence.ownModelUpsidePct
        : currentPriceUpside(context.ownModelBase, context.currentPrice);

    const valuationLooksExpensive = ownModelUpside != null && ownModelUpside <= -15;
    const deteriorationEvidence =
      (context.dcfPlausibility?.fit === "poor" && context.dataQualityScore != null && context.dataQualityScore >= 80) ||
      context.reverseDcfPlausibility?.status === "invalid";

    return valuationLooksExpensive && !deteriorationEvidence;
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const message =
      "Quality-Compounder-Guardrail: Überbewertung allein ist kein hartes Verkaufssignal. " +
      "Ohne klare Verschlechterung von Qualität, Moat oder Wachstum wird 'Verkaufen' auf eine defensivere Halte-/Trim-Logik reduziert.";

    const exact: AllowedRecommendation = analysis.recommendation === "Verkaufen"
      ? "Leicht verkaufen"
      : "Leicht verkaufen";

    return {
      id: "C2",
      scope: "company_type",
      severity: "warning",
      issueType: "quality_compounder_auto_sell",
      message,
      patch: {
        recommendationExact: exact,
        convictionMax: Math.min(analysis.conviction, 6),
        entryQuality: analysis.entry_quality?.label === "attraktiv"
          ? { label: "nicht hinterherrennen", rationale: "Qualität bleibt hoch, aber die Bewertung bietet aktuell keine ausreichende Sicherheitsmarge." }
          : analysis.entry_quality ?? { label: "nicht hinterherrennen", rationale: "Qualität bleibt hoch, aber die Bewertung bietet aktuell keine ausreichende Sicherheitsmarge." },
        warnings: [message],
        valuationConfidenceCap: context.valuationDivergenceAnalysis?.divergenceLevel === "high" || context.valuationDivergenceAnalysis?.divergenceLevel === "extreme"
          ? "medium"
          : undefined,
      },
    };
  },
};

export const C3_PlatformConglomerateModelFit: GuardrailRule = {
  id: "C3",
  scope: "company_type",
  severity: "warning",
  description: "Platform conglomerates require SOTP/segment logic; generic DCF cannot dominate hard ratings.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (context.companyTypeKey !== "platform_conglomerate") return false;
    const primaryModel = context.modelSelection?.primaryValuationModel.model;
    const missingSegmentWarning = context.modelSelection?.warnings.some(w => w.toLowerCase().includes("segment data")) === true;
    const ratingNeedsValuationSupport =
      BUY_RECOMMENDATIONS.has(analysis.recommendation) ||
      SELL_RECOMMENDATIONS.has(analysis.recommendation) ||
      analysis.conviction >= 7;
    return ratingNeedsValuationSupport && (primaryModel === "sotp" || missingSegmentWarning || hasPoorOrPartialDcf(context));
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const message =
      "Platform-/Konglomerat-Guardrail: Unterschiedliche Segmente brauchen SOTP-/Segmentlogik. " +
      "Ein konsolidierter FCFF-DCF darf die finale Empfehlung nicht dominieren; Konfidenz wird begrenzt.";

    return {
      id: "C3",
      scope: "company_type",
      severity: "warning",
      issueType: "platform_conglomerate_model_fit",
      message,
      patch: hardRatingPatch(analysis, message, {
        convictionMax: 6,
        valuationConfidenceCap: "medium",
      }),
    };
  },
};

export const C4_CyclicalHardwareOptimisticDcf: GuardrailRule = {
  id: "C4",
  scope: "company_type",
  severity: "warning",
  description: "Cyclical hardware strong Buy requires stress-tested margins, working capital, and reverse-DCF sanity.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (context.companyTypeKey !== "cyclical_hardware") return false;
    if (!BUY_RECOMMENDATIONS.has(analysis.recommendation)) return false;

    const optimisticDcf = context.valuationDivergenceAnalysis?.warnings.some(w =>
      w.toLowerCase().includes("too optimistic") ||
      w.toLowerCase().includes("working-capital") ||
      w.toLowerCase().includes("stress"),
    ) === true;

    return (
      hasPoorOrPartialDcf(context) ||
      optimisticDcf ||
      context.reverseDcfPlausibility?.status === "suspicious" ||
      context.reverseDcfPlausibility?.status === "invalid"
    );
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const message =
      "Cyclical-Hardware-Guardrail: Starker Kauf benötigt belastbare FCF-Konversion, normalisierte Margen, Working-Capital-Stress und plausible Reverse-DCF-Annahmen. " +
      "Ohne diese Bestätigung wird die Empfehlung abgeschwächt.";

    return {
      id: "C4",
      scope: "company_type",
      severity: "warning",
      issueType: "cyclical_hardware_optimistic_dcf",
      message,
      patch: {
        recommendationExact: analysis.recommendation === "Kaufen" ? "Leicht kaufen" : undefined,
        convictionMax: 6,
        valuationConfidenceCap: "medium",
        warnings: [message],
      },
    };
  },
};

export const C5_FinancialOrReitDcfFit: GuardrailRule = {
  id: "C5",
  scope: "company_type",
  severity: "warning",
  description: "Financials and REITs should not rely on generic FCFF DCF for hard ratings.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (context.companyTypeKey !== "financial" && context.companyTypeKey !== "reit") return false;
    if (!HARD_RECOMMENDATIONS.has(analysis.recommendation) && analysis.conviction < 7) return false;
    return context.dcfPlausibility?.fit === "poor";
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const modelHint = context.companyTypeKey === "reit" ? "NAV/AFFO" : "Buchwert/ROE/Kapitalquoten";
    const message =
      `Company-Type-Guardrail: Für ${context.companyTypeKey === "reit" ? "REITs" : "Finanzwerte"} ist generischer FCFF-DCF kein Primärmodell. ` +
      `${modelHint} müssen die Bewertung dominieren; harte Signale werden abgeschwächt.`;

    return {
      id: "C5",
      scope: "company_type",
      severity: "warning",
      issueType: "financial_or_reit_dcf_fit",
      message,
      patch: hardRatingPatch(analysis, message, {
        valuationConfidenceCap: "medium",
      }),
    };
  },
};

export const COMPANY_TYPE_RULES: GuardrailRule[] = [
  C1_ExtremeModelDisagreementAvoidsHardRating,
  C2_QualityCompounderNoAutomaticSell,
  C3_PlatformConglomerateModelFit,
  C4_CyclicalHardwareOptimisticDcf,
  C5_FinancialOrReitDcfFit,
];
