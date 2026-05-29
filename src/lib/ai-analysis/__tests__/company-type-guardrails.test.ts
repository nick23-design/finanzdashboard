import {
  ALL_LIGHTWEIGHT_RULES,
  runGuardrailEngine,
  type GuardrailAnalysis,
  type GuardrailContext,
} from "../guardrails";
import type { CompanyType, ModelSelectionOutput } from "../company-type-router";
import type {
  DcfPlausibilityOutput,
  ReverseDcfPlausibilityOutput,
  ValuationDivergenceOutput,
} from "../valuation-plausibility";

function analysis(overrides: Partial<GuardrailAnalysis> = {}): GuardrailAnalysis {
  return {
    recommendation: "Halten",
    conviction: 5,
    price_levels: {
      entry: 100,
      target: null,
      stop_loss: null,
      entry_rationale: "fixture",
      target_rationale: "",
    },
    entry_quality: { label: "fair", rationale: "fixture" },
    valuation_confidence: "medium",
    valuation_divergence: {
      status: "available",
      consensusUpsidePct: 10,
      ownModelUpsidePct: -20,
      baseGapPct: 30,
      gapLabel: "consensus_more_bullish",
      explanationSeed: "fixture",
      warnings: [],
    },
    claims: [],
    data_quality_guardrails: [],
    ...overrides,
  };
}

function dcfPlausibility(overrides: Partial<DcfPlausibilityOutput> = {}): DcfPlausibilityOutput {
  return {
    fit: "good",
    confidence: 4,
    warnings: [],
    limitations: [],
    diagnostics: {},
    ...overrides,
  };
}

function reversePlausibility(overrides: Partial<ReverseDcfPlausibilityOutput> = {}): ReverseDcfPlausibilityOutput {
  return {
    status: "valid",
    confidence: 4,
    warnings: [],
    diagnostics: {},
    ...overrides,
  };
}

function divergenceAnalysis(overrides: Partial<ValuationDivergenceOutput> = {}): ValuationDivergenceOutput {
  return {
    divergenceLevel: "low",
    confidence: 4,
    summary: "fixture",
    comparisons: [],
    warnings: [],
    ratingImpact: {
      lowerRatingConfidence: false,
      avoidHardBuySell: false,
      reason: "fixture",
    },
    ...overrides,
  };
}

function modelSelection(primaryModel: ModelSelectionOutput["primaryValuationModel"]["model"]): ModelSelectionOutput {
  const primaryValuationModel = {
    model: primaryModel,
    fit: "primary" as const,
    confidence: 3 as const,
    reason: "fixture",
    limitations: primaryModel === "sotp" ? ["SOTP requires segment data."] : [],
  };
  return {
    companyType: {
      primaryType: primaryModel === "sotp" ? "platform_conglomerate" : "quality_compounder",
      secondaryTypes: [],
      confidence: 4,
      rationale: "fixture",
      evidence: ["fixture"],
      limitations: [],
    },
    recommendedModels: [primaryValuationModel],
    primaryValuationModel,
    warnings: primaryModel === "sotp" ? ["SOTP is preferred but segment data is missing."] : [],
  };
}

function context(companyTypeKey: CompanyType, overrides: Partial<GuardrailContext> = {}): GuardrailContext {
  return {
    symbol: "TST",
    currentPrice: 100,
    dataQualityScore: 85,
    companyType: companyTypeKey,
    companyTypeKey,
    companyTypeClassification: {
      primaryType: companyTypeKey,
      secondaryTypes: [],
      confidence: 4,
      rationale: "fixture",
      evidence: ["fixture"],
      limitations: [],
    },
    modelSelection: modelSelection("fcff_dcf"),
    dcfPlausibility: dcfPlausibility(),
    reverseDcfPlausibility: reversePlausibility(),
    valuationDivergenceAnalysis: divergenceAnalysis(),
    sector: "fixture",
    hasAnalystConsensus: true,
    hasOwnModel: true,
    analystConsensusBase: 110,
    ownModelBase: 80,
    modelBear: 70,
    modelBull: 105,
    analystConsensusBear: 90,
    analystConsensusBull: 130,
    missingFields: [],
    staleFieldCount: 0,
    hasInsiderData: true,
    hasInstitutionalData: true,
    ...overrides,
  };
}

describe("company type guardrails in the lightweight decision layer", () => {
  it("Apple-like quality compounder + expensive valuation does not remain hard Sell", () => {
    const result = runGuardrailEngine(
      analysis({
        recommendation: "Verkaufen",
        conviction: 8,
        valuation_divergence: {
          status: "available",
          consensusUpsidePct: 5,
          ownModelUpsidePct: -28,
          baseGapPct: 33,
          gapLabel: "consensus_more_bullish",
          explanationSeed: "fixture",
          warnings: [],
        },
      }),
      context("quality_compounder", {
        currentPrice: 220,
        ownModelBase: 175,
        analystConsensusBase: 240,
      }),
      ALL_LIGHTWEIGHT_RULES,
    );

    expect(result.analysis.recommendation).not.toBe("Verkaufen");
    expect(result.analysis.recommendation).toBe("Leicht verkaufen");
    expect(result.fired.some(rule => rule.id === "C2")).toBe(true);
    expect(result.analysis.data_quality_guardrails.join(" ")).toContain("Quality-Compounder-Guardrail");
  });

  it("SMCI-like cyclical hardware + optimistic DCF does not remain strong Buy", () => {
    const result = runGuardrailEngine(
      analysis({
        recommendation: "Kaufen",
        conviction: 8,
        valuation_divergence: {
          status: "available",
          consensusUpsidePct: 8,
          ownModelUpsidePct: 95,
          baseGapPct: -87,
          gapLabel: "own_model_more_bullish",
          explanationSeed: "fixture",
          warnings: [],
        },
      }),
      context("cyclical_hardware", {
        currentPrice: 45,
        ownModelBase: 35,
        analystConsensusBase: 50,
        dcfPlausibility: dcfPlausibility({
          fit: "partial",
          confidence: 2,
          warnings: ["Cyclical hardware DCF fit lowered because working-capital stress and normalized margins are not both included."],
        }),
        reverseDcfPlausibility: reversePlausibility({
          status: "suspicious",
          confidence: 2,
          warnings: ["Reverse DCF solver appears to have hit a boundary."],
        }),
        valuationDivergenceAnalysis: divergenceAnalysis({
          divergenceLevel: "extreme",
          warnings: ["Cyclical hardware DCF may be too optimistic; require margin, inventory, and working-capital stress."],
          ratingImpact: {
            lowerRatingConfidence: true,
            avoidHardBuySell: true,
            reason: "fixture",
          },
        }),
      }),
      ALL_LIGHTWEIGHT_RULES,
    );

    expect(result.analysis.recommendation).toBe("Leicht kaufen");
    expect(result.analysis.conviction).toBeLessThanOrEqual(6);
    expect(result.fired.some(rule => rule.id === "C4")).toBe(true);
    expect(result.analysis.data_quality_guardrails.join(" ")).toContain("Cyclical-Hardware-Guardrail");
  });

  it("Amazon-like platform conglomerate lowers valuation confidence when SOTP is missing", () => {
    const result = runGuardrailEngine(
      analysis({
        recommendation: "Kaufen",
        conviction: 8,
        valuation_confidence: "high",
      }),
      context("platform_conglomerate", {
        modelSelection: modelSelection("sotp"),
        dcfPlausibility: dcfPlausibility({
          fit: "partial",
          confidence: 2,
          warnings: ["Platform/conglomerate DCF fit lowered because segment/SOTP data is missing."],
        }),
        valuationDivergenceAnalysis: divergenceAnalysis({
          divergenceLevel: "high",
          ratingImpact: {
            lowerRatingConfidence: true,
            avoidHardBuySell: true,
            reason: "fixture",
          },
        }),
      }),
      ALL_LIGHTWEIGHT_RULES,
    );

    expect(result.analysis.recommendation).toBe("Leicht kaufen");
    expect(result.analysis.valuation_confidence).toBe("medium");
    expect(result.fired.some(rule => rule.id === "C3")).toBe(true);
    expect(result.analysis.data_quality_guardrails.join(" ")).toContain("Platform-/Konglomerat-Guardrail");
  });
});
