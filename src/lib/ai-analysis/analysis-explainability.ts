import type { AlphaFrameworkOutput } from "./alpha-framework";
import type {
  CompanyType,
  CompanyTypeClassification,
  ConfidenceScore,
  ModelSelectionOutput,
} from "./company-type-router";
import type {
  DcfPlausibilityOutput,
  ReverseDcfPlausibilityOutput,
  ValuationDivergenceOutput,
} from "./valuation-plausibility";
import type { ModelSelectionPlan } from "./model-selector";

export type ThesisChangeTriggers = {
  bullishTriggers: string[];
  bearishTriggers: string[];
  keyMetricsToWatch: string[];
};

export type AnalysisConfidenceBreakdown = {
  dataConfidence: ConfidenceScore;
  valuationConfidence: ConfidenceScore;
  businessQualityConfidence: ConfidenceScore;
  timingConfidence: ConfidenceScore;
  finalRatingConfidence: ConfidenceScore;
  reasons: string[];
};

export type AnalysisDebugSnapshot = {
  ticker?: string;
  companyType: CompanyTypeClassification;
  companyTypeConfidence: ConfidenceScore;
  recommendedModels: ModelSelectionOutput["recommendedModels"];
  primaryValuationModel: ModelSelectionOutput["primaryValuationModel"];
  dcfPlausibility: DcfPlausibilityOutput | null;
  reverseDcfPlausibility: ReverseDcfPlausibilityOutput | null;
  valuationDivergence: ValuationDivergenceOutput | null;
  confidenceBreakdown: AnalysisConfidenceBreakdown;
  guardrailsTriggered: string[];
  thesisChangeTriggers: ThesisChangeTriggers;
  finalRating?: string | null;
  finalRatingConfidence: ConfidenceScore;
  modelSelectionPlan?: ModelSelectionPlan | null;
};

export type AnalysisExplainabilityInput = {
  ticker?: string;
  companyTypeClassification: CompanyTypeClassification;
  modelSelection: ModelSelectionOutput;
  modelSelectionPlan?: ModelSelectionPlan | null;
  dcfPlausibility?: DcfPlausibilityOutput | null;
  reverseDcfPlausibility?: ReverseDcfPlausibilityOutput | null;
  valuationDivergenceAnalysis?: ValuationDivergenceOutput | null;
  alphaFramework?: AlphaFrameworkOutput | null;
  dataQuality?: {
    completeness_score?: number | null;
    stale_fields?: string[] | null;
    missing_fields?: string[] | null;
    warnings?: string[] | null;
    analysis_confidence_cap?: number | null;
  } | null;
  currentPrice?: number | null;
  rsi?: number | null;
  movingAverage50?: number | null;
  movingAverage200?: number | null;
  guardrailsTriggered?: string[];
  finalRating?: string | null;
};

function unique(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))];
}

function clampConfidence(value: number): ConfidenceScore {
  if (value >= 5) return 5;
  if (value >= 4) return 4;
  if (value >= 3) return 3;
  if (value >= 2) return 2;
  return 1;
}

function lower(score: ConfidenceScore, amount: number): ConfidenceScore {
  return clampConfidence(score - amount);
}

function confidenceFromHundredScore(score: number | null | undefined): ConfidenceScore {
  if (typeof score !== "number" || !Number.isFinite(score)) return 2;
  if (score >= 85) return 5;
  if (score >= 70) return 4;
  if (score >= 55) return 3;
  if (score >= 40) return 2;
  return 1;
}

function confidenceFromCompleteness(score: number | null | undefined): ConfidenceScore {
  if (typeof score !== "number" || !Number.isFinite(score)) return 2;
  if (score >= 90) return 5;
  if (score >= 75) return 4;
  if (score >= 60) return 3;
  if (score >= 45) return 2;
  return 1;
}

function buildDataConfidence(
  dataQuality: AnalysisExplainabilityInput["dataQuality"],
  reasons: string[],
): ConfidenceScore {
  let score = confidenceFromCompleteness(dataQuality?.completeness_score);
  const missingCount = dataQuality?.missing_fields?.length ?? 0;
  const staleCount = dataQuality?.stale_fields?.length ?? 0;

  if (!dataQuality) {
    reasons.push("Data confidence is limited because Diana data-quality output is missing.");
    return 2;
  }
  if (missingCount >= 5) {
    score = lower(score, 2);
    reasons.push("Data confidence lowered because several provider fields are missing.");
  } else if (missingCount >= 2) {
    score = lower(score, 1);
    reasons.push("Data confidence lowered because some provider fields are missing.");
  }
  if (staleCount >= 3) {
    score = lower(score, 1);
    reasons.push("Data confidence lowered because multiple fields are stale.");
  }
  if ((dataQuality.analysis_confidence_cap ?? 10) <= 6) {
    score = lower(score, 1);
    reasons.push("Data confidence lowered by Diana conviction cap.");
  }
  return score;
}

function buildValuationConfidence(
  input: AnalysisExplainabilityInput,
  reasons: string[],
): ConfidenceScore {
  let score = input.modelSelection.primaryValuationModel.confidence;

  if (input.modelSelection.primaryValuationModel.fit === "poor") {
    score = lower(score, 2);
    reasons.push("Valuation confidence lowered because the primary valuation model is a poor fit.");
  } else if (input.modelSelection.primaryValuationModel.fit === "partial") {
    score = lower(score, 1);
    reasons.push("Valuation confidence lowered because the primary valuation model is only a partial fit.");
  }

  if (!input.dcfPlausibility) {
    score = lower(score, 1);
    reasons.push("Valuation confidence lowered because DCF plausibility diagnostics are missing.");
  } else if (input.dcfPlausibility.fit === "poor") {
    score = lower(score, 2);
    reasons.push("Valuation confidence lowered because generic DCF fit is poor.");
  } else if (input.dcfPlausibility.fit === "partial") {
    score = lower(score, 1);
    reasons.push("Valuation confidence lowered because generic DCF fit is partial.");
  }

  if (input.reverseDcfPlausibility?.status === "invalid") {
    score = lower(score, 2);
    reasons.push("Valuation confidence lowered because Reverse DCF diagnostics are invalid.");
  } else if (input.reverseDcfPlausibility?.status === "suspicious") {
    score = lower(score, 1);
    reasons.push("Valuation confidence lowered because Reverse DCF diagnostics are suspicious.");
  }

  const divergence = input.valuationDivergenceAnalysis;
  if (divergence?.divergenceLevel === "extreme") {
    score = lower(score, 2);
    reasons.push("Valuation confidence lowered because valuation anchors show extreme divergence.");
  } else if (divergence?.divergenceLevel === "high") {
    score = lower(score, 1);
    reasons.push("Valuation confidence lowered because valuation anchors materially disagree.");
  }
  if (divergence?.ratingImpact.lowerRatingConfidence) {
    score = lower(score, 1);
    reasons.push(`Valuation confidence lowered by divergence guardrail: ${divergence.ratingImpact.reason}`);
  }

  if (input.modelSelection.warnings.length >= 2) {
    score = lower(score, 1);
    reasons.push("Valuation confidence lowered because model selection has multiple warnings.");
  }

  return score;
}

function buildBusinessQualityConfidence(input: AnalysisExplainabilityInput, reasons: string[]): ConfidenceScore {
  const alpha = input.alphaFramework;
  if (!alpha) {
    reasons.push("Business-quality confidence falls back to company-type confidence because Alpha Framework is missing.");
    return input.companyTypeClassification.confidence;
  }

  let score = confidenceFromHundredScore((alpha.quality.score + alpha.moat.score + (100 - alpha.risk.score)) / 3);
  if (input.companyTypeClassification.confidence <= 2) {
    score = lower(score, 1);
    reasons.push("Business-quality confidence lowered because company-type routing confidence is low.");
  }
  if (alpha.uncertaintyFlags.length >= 2) {
    score = lower(score, 1);
    reasons.push("Business-quality confidence lowered because Alpha Framework has multiple uncertainty flags.");
  }
  return score;
}

function buildTimingConfidence(input: AnalysisExplainabilityInput, reasons: string[]): ConfidenceScore {
  if (input.alphaFramework?.momentum.score != null) {
    let score = confidenceFromHundredScore(input.alphaFramework.momentum.score);
    const rsi = input.rsi;
    if (typeof rsi === "number" && Number.isFinite(rsi)) {
      if (rsi > 80 || rsi < 20) {
        score = lower(score, 1);
        reasons.push("Timing confidence lowered because RSI is extreme.");
      } else if (rsi >= 35 && rsi <= 70) {
        score = clampConfidence(score + 1);
      }
    }
    return score;
  }

  const rsi = input.rsi;
  const currentPrice = input.currentPrice;
  const movingAverage50 = input.movingAverage50;
  const movingAverage200 = input.movingAverage200;
  const missingTechnicalData =
    rsi == null ||
    currentPrice == null ||
    movingAverage50 == null ||
    movingAverage200 == null;
  if (missingTechnicalData) {
    reasons.push("Timing confidence is limited because RSI or moving-average data is missing.");
    return 2;
  }

  const aboveAverages = currentPrice > movingAverage50 && currentPrice > movingAverage200;
  const neutralRsi = rsi >= 35 && rsi <= 70;
  if (aboveAverages && neutralRsi) return 4;
  if (neutralRsi) return 3;
  return 2;
}

function buildFinalRatingConfidence(
  dataConfidence: ConfidenceScore,
  valuationConfidence: ConfidenceScore,
  businessQualityConfidence: ConfidenceScore,
  timingConfidence: ConfidenceScore,
  input: AnalysisExplainabilityInput,
  reasons: string[],
): ConfidenceScore {
  let score = clampConfidence(
    Math.round((dataConfidence + valuationConfidence + businessQualityConfidence + timingConfidence) / 4),
  );

  if (input.valuationDivergenceAnalysis?.ratingImpact.avoidHardBuySell) {
    score = lower(score, 1);
    reasons.push("Final-rating confidence lowered because hard Buy/Sell should be avoided.");
  }
  if (input.guardrailsTriggered?.length) {
    score = lower(score, 1);
    reasons.push("Final-rating confidence lowered because deterministic guardrails fired.");
  }
  return score;
}

export function buildThesisChangeTriggers(input: {
  companyTypeClassification: CompanyTypeClassification;
  modelSelection?: ModelSelectionOutput | null;
}): ThesisChangeTriggers {
  const primaryType = input.companyTypeClassification.primaryType;
  const modelWarning = input.modelSelection?.warnings.length
    ? ["Improve missing model inputs before raising conviction."]
    : [];

  const common = {
    bullishTriggers: ["Revenue growth accelerates while free cash flow conversion improves."],
    bearishTriggers: ["Growth slows while valuation remains elevated."],
    keyMetricsToWatch: ["Revenue growth", "Free cash flow", "Operating margin", "Net debt"],
  };

  const byType: Partial<Record<CompanyType, ThesisChangeTriggers>> = {
    quality_compounder: {
      bullishTriggers: [
        "ROIC and free cash flow compound above expectations.",
        "Moat durability improves through pricing power, ecosystem lock-in, or services mix.",
        "Buybacks create visible per-share value without weakening the balance sheet.",
      ],
      bearishTriggers: [
        "ROIC trend deteriorates for multiple periods.",
        "Moat or pricing power weakens structurally.",
        "Regulatory or platform risk starts to pressure margins or growth.",
      ],
      keyMetricsToWatch: ["ROIC trend", "FCF margin", "Services or recurring revenue mix", "Buyback yield", "Regulatory risk"],
    },
    platform_conglomerate: {
      bullishTriggers: [
        "High-margin segments such as cloud, advertising, or software outgrow low-margin segments.",
        "Capex converts into visible segment operating income and free cash flow.",
        "Segment disclosures support a sum-of-the-parts valuation premium.",
      ],
      bearishTriggers: [
        "Cloud or advertising growth decelerates while capex stays elevated.",
        "Retail or low-margin segments absorb too much capital.",
        "Missing segment data prevents a credible SOTP valuation.",
      ],
      keyMetricsToWatch: ["Cloud growth", "Advertising margin", "Segment operating income", "Capex to FCF conversion", "SOTP data quality"],
    },
    cyclical_hardware: {
      bullishTriggers: [
        "Gross margin expands while inventory and working capital stay controlled.",
        "Customer concentration declines or backlog becomes more diversified.",
        "Free cash flow conversion improves through the cycle.",
      ],
      bearishTriggers: [
        "Inventory rises faster than revenue.",
        "Gross margin normalizes down while valuation remains peak-cycle.",
        "Accounting, compliance, customer concentration, or debt risk worsens.",
      ],
      keyMetricsToWatch: ["Gross margin", "Inventory growth", "FCF conversion", "Customer concentration", "Debt and compliance updates"],
    },
    financial: {
      bullishTriggers: ["ROE improves with stable credit quality and capital ratios."],
      bearishTriggers: ["Credit losses rise or capital ratios weaken."],
      keyMetricsToWatch: ["ROE", "Book value", "CET1 or capital ratio", "Credit losses", "Net interest margin"],
    },
    reit: {
      bullishTriggers: ["AFFO growth improves while occupancy and lease duration remain resilient."],
      bearishTriggers: ["Higher rates, weak occupancy, or refinancing pressure reduce AFFO visibility."],
      keyMetricsToWatch: ["AFFO", "NAV", "Occupancy", "Lease duration", "Net debt to EBITDA"],
    },
    commodity_cyclical: {
      bullishTriggers: ["Commodity prices stay above normalized assumptions and cost position improves."],
      bearishTriggers: ["Peak-cycle earnings are extrapolated while commodity prices roll over."],
      keyMetricsToWatch: ["Normalized commodity price", "Unit costs", "Balance sheet", "Production volumes", "Cost curve"],
    },
    speculative_growth: {
      bullishTriggers: ["Execution milestones convert story value into revenue, margins, or backlog."],
      bearishTriggers: ["Cash burn, dilution, or missed milestones increase funding risk."],
      keyMetricsToWatch: ["Cash runway", "Revenue growth", "Gross margin", "Dilution", "Execution milestones"],
    },
  };

  const triggers = byType[primaryType] ?? common;
  return {
    bullishTriggers: unique([...triggers.bullishTriggers, ...modelWarning]),
    bearishTriggers: unique(triggers.bearishTriggers),
    keyMetricsToWatch: unique(triggers.keyMetricsToWatch),
  };
}

export function buildConfidenceBreakdown(input: AnalysisExplainabilityInput): AnalysisConfidenceBreakdown {
  const reasons: string[] = [];
  const dataConfidence = buildDataConfidence(input.dataQuality, reasons);
  const valuationConfidence = buildValuationConfidence(input, reasons);
  const businessQualityConfidence = buildBusinessQualityConfidence(input, reasons);
  const timingConfidence = buildTimingConfidence(input, reasons);
  const finalRatingConfidence = buildFinalRatingConfidence(
    dataConfidence,
    valuationConfidence,
    businessQualityConfidence,
    timingConfidence,
    input,
    reasons,
  );

  return {
    dataConfidence,
    valuationConfidence,
    businessQualityConfidence,
    timingConfidence,
    finalRatingConfidence,
    reasons: unique(reasons),
  };
}

export function buildAnalysisDebugSnapshot(input: AnalysisExplainabilityInput): AnalysisDebugSnapshot {
  const thesisChangeTriggers = buildThesisChangeTriggers(input);
  const confidenceBreakdown = buildConfidenceBreakdown(input);
  return {
    ticker: input.ticker,
    companyType: input.companyTypeClassification,
    companyTypeConfidence: input.companyTypeClassification.confidence,
    recommendedModels: input.modelSelection.recommendedModels,
    primaryValuationModel: input.modelSelection.primaryValuationModel,
    dcfPlausibility: input.dcfPlausibility ?? null,
    reverseDcfPlausibility: input.reverseDcfPlausibility ?? null,
    valuationDivergence: input.valuationDivergenceAnalysis ?? null,
    confidenceBreakdown,
    guardrailsTriggered: input.guardrailsTriggered ?? [],
    thesisChangeTriggers,
    finalRating: input.finalRating ?? null,
    finalRatingConfidence: confidenceBreakdown.finalRatingConfidence,
    modelSelectionPlan: input.modelSelectionPlan ?? null,
  };
}
