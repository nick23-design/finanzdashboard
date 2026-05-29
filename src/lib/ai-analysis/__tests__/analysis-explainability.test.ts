import {
  buildAnalysisDebugSnapshot,
  buildConfidenceBreakdown,
  buildThesisChangeTriggers,
  type AnalysisExplainabilityInput,
} from "../analysis-explainability";
import type {
  CompanyType,
  CompanyTypeClassification,
  ConfidenceScore,
  ModelSelectionOutput,
  ValuationModelFit,
} from "../company-type-router";
import type {
  DcfPlausibilityOutput,
  ReverseDcfPlausibilityOutput,
  ValuationDivergenceOutput,
} from "../valuation-plausibility";

function classification(
  primaryType: CompanyType,
  confidence: ConfidenceScore = 4,
): CompanyTypeClassification {
  return {
    primaryType,
    secondaryTypes: [],
    confidence,
    rationale: `${primaryType} fixture`,
    evidence: ["fixture evidence"],
    limitations: [],
  };
}

function fit(
  model: ValuationModelFit["model"],
  modelFit: ValuationModelFit["fit"],
  confidence: ConfidenceScore,
): ValuationModelFit {
  return {
    model,
    fit: modelFit,
    confidence,
    reason: `${model} ${modelFit}`,
    limitations: [],
  };
}

function modelSelection(
  companyType: CompanyTypeClassification,
  primary = fit("fcff_dcf", "good", 4),
  warnings: string[] = [],
): ModelSelectionOutput {
  return {
    companyType,
    recommendedModels: [primary],
    primaryValuationModel: primary,
    warnings,
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

function reverseDcf(overrides: Partial<ReverseDcfPlausibilityOutput> = {}): ReverseDcfPlausibilityOutput {
  return {
    status: "valid",
    confidence: 4,
    warnings: [],
    diagnostics: {},
    ...overrides,
  };
}

function divergence(overrides: Partial<ValuationDivergenceOutput> = {}): ValuationDivergenceOutput {
  return {
    divergenceLevel: "low",
    confidence: 4,
    summary: "Valuation anchors mostly agree.",
    comparisons: [],
    warnings: [],
    ratingImpact: {
      lowerRatingConfidence: false,
      avoidHardBuySell: false,
      reason: "No material divergence.",
    },
    ...overrides,
  };
}

function baseInput(type: CompanyType = "quality_compounder"): AnalysisExplainabilityInput {
  const companyTypeClassification = classification(type, 4);
  return {
    ticker: "TEST",
    companyTypeClassification,
    modelSelection: modelSelection(companyTypeClassification),
    dcfPlausibility: dcfPlausibility(),
    reverseDcfPlausibility: reverseDcf(),
    valuationDivergenceAnalysis: divergence(),
    dataQuality: {
      completeness_score: 88,
      missing_fields: [],
      stale_fields: [],
      warnings: [],
      analysis_confidence_cap: 8,
    },
    currentPrice: 120,
    rsi: 55,
    movingAverage50: 100,
    movingAverage200: 90,
  };
}

describe("analysis explainability", () => {
  it("generates platform-conglomerate thesis triggers", () => {
    const triggers = buildThesisChangeTriggers({
      companyTypeClassification: classification("platform_conglomerate"),
    });

    expect(triggers.keyMetricsToWatch).toContain("Cloud growth");
    expect(triggers.keyMetricsToWatch).toContain("SOTP data quality");
    expect(triggers.bearishTriggers.join(" ")).toMatch(/segment data/i);
  });

  it("generates cyclical-hardware thesis triggers", () => {
    const triggers = buildThesisChangeTriggers({
      companyTypeClassification: classification("cyclical_hardware"),
    });

    expect(triggers.keyMetricsToWatch).toContain("Inventory growth");
    expect(triggers.bearishTriggers.join(" ")).toMatch(/Gross margin/i);
  });

  it("generates quality-compounder thesis triggers", () => {
    const triggers = buildThesisChangeTriggers({
      companyTypeClassification: classification("quality_compounder"),
    });

    expect(triggers.keyMetricsToWatch).toContain("ROIC trend");
    expect(triggers.bullishTriggers.join(" ")).toMatch(/Buybacks/i);
  });

  it("lowers data confidence when provider fields are missing", () => {
    const confidence = buildConfidenceBreakdown({
      ...baseInput(),
      dataQuality: {
        completeness_score: 62,
        missing_fields: ["KGV", "Debt/Equity", "EDGAR", "Analysten", "Institutionen"],
        stale_fields: [],
        warnings: [],
        analysis_confidence_cap: 7,
      },
    });

    expect(confidence.dataConfidence).toBeLessThanOrEqual(2);
    expect(confidence.reasons.join(" ")).toMatch(/provider fields are missing/i);
  });

  it("lowers valuation confidence when DCF fit and valuation anchors disagree", () => {
    const companyTypeClassification = classification("platform_conglomerate");
    const confidence = buildConfidenceBreakdown({
      ...baseInput("platform_conglomerate"),
      companyTypeClassification,
      modelSelection: modelSelection(
        companyTypeClassification,
        fit("sotp", "primary", 5),
      ),
      dcfPlausibility: dcfPlausibility({ fit: "partial", confidence: 3 }),
      valuationDivergenceAnalysis: divergence({
        divergenceLevel: "high",
        ratingImpact: {
          lowerRatingConfidence: true,
          avoidHardBuySell: true,
          reason: "Generic DCF, consensus, and own model disagree.",
        },
      }),
    });

    expect(confidence.valuationConfidence).toBeLessThanOrEqual(2);
    expect(confidence.finalRatingConfidence).toBeLessThanOrEqual(3);
  });

  it("lowers valuation confidence for suspicious reverse DCF output", () => {
    const confidence = buildConfidenceBreakdown({
      ...baseInput(),
      reverseDcfPlausibility: reverseDcf({
        status: "suspicious",
        confidence: 2,
        warnings: ["Directionally inconsistent implied growth."],
      }),
    });

    expect(confidence.valuationConfidence).toBeLessThanOrEqual(3);
    expect(confidence.reasons.join(" ")).toMatch(/Reverse DCF/i);
  });

  it("keeps timing confidence separate from business-quality confidence", () => {
    const confidence = buildConfidenceBreakdown({
      ...baseInput("quality_compounder"),
      companyTypeClassification: classification("quality_compounder", 3),
      currentPrice: 120,
      movingAverage50: 100,
      movingAverage200: 90,
      rsi: 55,
    });

    expect(confidence.timingConfidence).toBe(4);
    expect(confidence.businessQualityConfidence).toBe(3);
  });

  it("builds a debug snapshot with final rating and deterministic context", () => {
    const snapshot = buildAnalysisDebugSnapshot({
      ...baseInput("cyclical_hardware"),
      finalRating: "Halten",
      guardrailsTriggered: ["cyclical_hardware_optimistic_dcf"],
    });

    expect(snapshot.ticker).toBe("TEST");
    expect(snapshot.finalRating).toBe("Halten");
    expect(snapshot.guardrailsTriggered).toContain("cyclical_hardware_optimistic_dcf");
    expect(snapshot.companyType.primaryType).toBe("cyclical_hardware");
    expect(snapshot.thesisChangeTriggers.keyMetricsToWatch).toContain("Inventory growth");
  });
});
