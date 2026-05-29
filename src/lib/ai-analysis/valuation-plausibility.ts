import type { DcfOutput, DcfScenariosOutput } from "./dcf";
import type { ReverseDcfOutput } from "./reverse-dcf";
import type {
  CompanyType,
  CompanyTypeClassification,
  ConfidenceScore,
  ModelSelectionOutput,
} from "./company-type-router";

export type DcfPlausibilityOutput = {
  fit: "poor" | "partial" | "good";
  confidence: ConfidenceScore;
  warnings: string[];
  limitations: string[];
  diagnostics: {
    terminalValuePctOfEnterpriseValue?: number;
    fairValueVsCurrentPricePct?: number;
    fairValueVsConsensusPct?: number;
    fairValueVsOwnModelPct?: number;
    forecastFcfCagr?: number;
    marginExpansionAssumption?: number;
    wacc?: number;
    terminalGrowthRate?: number;
  };
};

export type DcfPlausibilityInput = {
  companyType: CompanyType | CompanyTypeClassification;
  dcf: DcfOutput | null;
  currentPrice?: number | null;
  analystConsensusFairValue?: number | null;
  ownModelFairValue?: number | null;
  hasSegmentData?: boolean;
  hasWorkingCapitalStress?: boolean;
  hasNormalizedMargins?: boolean;
  limitations?: string[];
};

export type ReverseDcfPlausibilityOutput = {
  status: "valid" | "suspicious" | "invalid";
  confidence: ConfidenceScore;
  warnings: string[];
  diagnostics: {
    impliedGrowthRate?: number | null;
    baseDcfFairValue?: number | null;
    currentPrice?: number | null;
    directionallyConsistent?: boolean;
  };
};

export type ReverseDcfPlausibilityInput = {
  reverseDcf: ReverseDcfOutput | null;
  baseDcfFairValue?: number | null;
  baseGrowthAssumption?: number | null;
  currentPrice?: number | null;
  solverHitBoundary?: boolean;
  justification?: string | null;
};

export type ValuationDivergenceOutput = {
  divergenceLevel: "low" | "moderate" | "high" | "extreme";
  confidence: ConfidenceScore;
  summary: string;
  comparisons: Array<{
    left: string;
    right: string;
    differencePct: number | null;
    interpretation: string;
  }>;
  warnings: string[];
  ratingImpact: {
    lowerRatingConfidence: boolean;
    avoidHardBuySell: boolean;
    reason: string;
  };
};

export type ValuationRangeAnchor = {
  bear?: number | null;
  base?: number | null;
  bull?: number | null;
};

export type ValuationDivergenceAnalyzerInput = {
  companyType: CompanyType | CompanyTypeClassification;
  modelSelection?: ModelSelectionOutput | null;
  currentPrice?: number | null;
  ownModel?: ValuationRangeAnchor | null;
  dcf?: ValuationRangeAnchor | DcfScenariosOutput | null;
  analystConsensus?: ValuationRangeAnchor | null;
  dcfPlausibility?: DcfPlausibilityOutput | null;
  reverseDcfPlausibility?: ReverseDcfPlausibilityOutput | null;
  relativeValuationScore?: number | null;
  alphaValuationScore?: number | null;
};

type FitRank = 1 | 2 | 3;

function companyTypeOf(input: CompanyType | CompanyTypeClassification): CompanyType {
  return typeof input === "string" ? input : input.primaryType;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pctDiff(left: number | null | undefined, right: number | null | undefined): number | null {
  if (!isFiniteNumber(left) || !isFinitePositive(right)) return null;
  return round1(((left - right) / right) * 100);
}

function degradeFit(current: FitRank, target: FitRank): FitRank {
  return Math.min(current, target) as FitRank;
}

function fitFromRank(rank: FitRank): DcfPlausibilityOutput["fit"] {
  if (rank <= 1) return "poor";
  if (rank === 2) return "partial";
  return "good";
}

function confidenceFromRank(rank: FitRank, warnings: string[], limitations: string[]): ConfidenceScore {
  let score = rank === 3 ? 4 : rank === 2 ? 3 : 2;
  if (warnings.length >= 3) score -= 1;
  if (limitations.length >= 2) score -= 1;
  if (score <= 1) return 1;
  if (score === 2) return 2;
  if (score === 3) return 3;
  if (score === 4) return 4;
  return 5;
}

function warningOnce(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

function limitationOnce(limitations: string[], limitation: string): void {
  if (!limitations.includes(limitation)) limitations.push(limitation);
}

function firstAndLast<T>(items: T[]): [T, T] | null {
  if (items.length === 0) return null;
  return [items[0], items[items.length - 1]];
}

function forecastFcfCagr(dcf: DcfOutput): number | undefined {
  const endpoints = firstAndLast(dcf.yearlyForecasts);
  if (!endpoints) return undefined;
  const [first, last] = endpoints;
  if (!isFinitePositive(first.freeCashFlow) || !isFinitePositive(last.freeCashFlow)) return undefined;
  const years = Math.max(1, dcf.yearlyForecasts.length - 1);
  return round2(Math.pow(last.freeCashFlow / first.freeCashFlow, 1 / years) - 1);
}

function marginExpansionAssumption(dcf: DcfOutput): number | undefined {
  const margins = dcf.assumptions.operatingMarginRates;
  const endpoints = firstAndLast(margins);
  if (!endpoints) return undefined;
  return round2(endpoints[1] - endpoints[0]);
}

export function evaluateDcfPlausibility(input: DcfPlausibilityInput): DcfPlausibilityOutput {
  const warnings: string[] = [];
  const limitations = [...(input.limitations ?? [])];
  const type = companyTypeOf(input.companyType);

  if (!input.dcf) {
    return {
      fit: "poor",
      confidence: 1,
      warnings: ["DCF output is missing; do not use generic DCF as a rating driver."],
      limitations: ["DCF could not be calculated from available inputs.", ...limitations],
      diagnostics: {},
    };
  }

  const dcf = input.dcf;
  const diagnostics: DcfPlausibilityOutput["diagnostics"] = {
    wacc: dcf.assumptions.wacc,
    terminalGrowthRate: dcf.assumptions.terminalGrowthRate,
    forecastFcfCagr: forecastFcfCagr(dcf),
    marginExpansionAssumption: marginExpansionAssumption(dcf),
  };

  let fitRank: FitRank = 3;

  if (isFinitePositive(dcf.enterpriseValue)) {
    const tvPct = dcf.presentValueOfTerminalValue / dcf.enterpriseValue;
    diagnostics.terminalValuePctOfEnterpriseValue = round1(tvPct * 100);
    if (tvPct > 0.85) {
      warningOnce(warnings, "Terminal value is more than 85% of enterprise value; DCF is highly terminal-value sensitive.");
      fitRank = degradeFit(fitRank, 1);
    } else if (tvPct > 0.75) {
      warningOnce(warnings, "Terminal value is more than 75% of enterprise value; DCF needs sensitivity checks.");
      fitRank = degradeFit(fitRank, 2);
    }
  } else {
    limitationOnce(limitations, "Enterprise value is missing or non-positive.");
    fitRank = degradeFit(fitRank, 1);
  }

  diagnostics.fairValueVsCurrentPricePct = pctDiff(dcf.fairValuePerShare, input.currentPrice) ?? undefined;
  diagnostics.fairValueVsConsensusPct = pctDiff(dcf.fairValuePerShare, input.analystConsensusFairValue) ?? undefined;
  diagnostics.fairValueVsOwnModelPct = pctDiff(dcf.fairValuePerShare, input.ownModelFairValue) ?? undefined;

  if (Math.abs(diagnostics.fairValueVsCurrentPricePct ?? 0) > 50) {
    warningOnce(warnings, "DCF fair value differs from current price by more than 50%; treat as a stress-test anchor, not precise truth.");
    fitRank = degradeFit(fitRank, 2);
  }
  if (Math.abs(diagnostics.fairValueVsConsensusPct ?? 0) > 50) {
    warningOnce(warnings, "DCF fair value differs from analyst consensus by more than 50%; valuation anchors materially disagree.");
    fitRank = degradeFit(fitRank, 2);
  }
  if (Math.abs(diagnostics.fairValueVsOwnModelPct ?? 0) > 50) {
    warningOnce(warnings, "DCF fair value differs from the internal own model by more than 50%; model assumptions need review.");
    fitRank = degradeFit(fitRank, 2);
  }

  if (type === "cyclical_hardware") {
    if (!input.hasWorkingCapitalStress || !input.hasNormalizedMargins) {
      warningOnce(warnings, "Cyclical hardware DCF fit lowered because working-capital stress and normalized margins are not both included.");
      fitRank = degradeFit(fitRank, 2);
    }
  }

  if (type === "platform_conglomerate") {
    if (!input.hasSegmentData) {
      warningOnce(warnings, "Platform/conglomerate DCF fit lowered because segment/SOTP data is missing.");
      fitRank = degradeFit(fitRank, 2);
    }
  }

  if (type === "financial") {
    warningOnce(warnings, "Generic FCFF DCF is a poor fit for financial balance-sheet businesses.");
    fitRank = degradeFit(fitRank, 1);
  }

  if (type === "reit") {
    warningOnce(warnings, "Generic FCFF DCF is a poor fit for REITs; NAV/AFFO should dominate.");
    fitRank = degradeFit(fitRank, 1);
  }

  if (!isFinitePositive(input.currentPrice)) {
    limitationOnce(limitations, "Current price missing; DCF upside/downside cannot be anchored to market price.");
    fitRank = degradeFit(fitRank, 2);
  }

  for (const limitation of dcf.limitations) {
    limitationOnce(limitations, limitation);
  }

  return {
    fit: fitFromRank(fitRank),
    confidence: confidenceFromRank(fitRank, warnings, limitations),
    warnings,
    limitations,
    diagnostics,
  };
}

export function evaluateReverseDcfPlausibility(
  input: ReverseDcfPlausibilityInput,
): ReverseDcfPlausibilityOutput {
  const warnings: string[] = [];
  const impliedGrowthRate = input.reverseDcf?.impliedGrowthRate ?? null;
  const currentPrice = input.currentPrice ?? input.reverseDcf?.currentPrice ?? null;
  const baseDcfFairValue = input.baseDcfFairValue ?? null;
  const baseGrowth = input.baseGrowthAssumption ?? null;

  let status: ReverseDcfPlausibilityOutput["status"] = "valid";
  let directionallyConsistent: boolean | undefined;

  if (!input.reverseDcf || !isFiniteNumber(impliedGrowthRate)) {
    return {
      status: "invalid",
      confidence: 1,
      warnings: ["Reverse DCF output is missing or has no implied growth rate."],
      diagnostics: { impliedGrowthRate, baseDcfFairValue, currentPrice },
    };
  }

  const hitBoundary =
    input.solverHitBoundary === true ||
    Math.abs(impliedGrowthRate - 0.8) < 0.001 ||
    Math.abs(impliedGrowthRate - -0.2) < 0.001 ||
    input.reverseDcf.limitations.some(limitation =>
      limitation.includes("Obergrenze") || limitation.includes("Untergrenze") || limitation.toLowerCase().includes("boundary"),
    );

  if (hitBoundary) {
    warnings.push("Reverse DCF solver appears to have hit a boundary; output should not strongly influence the rating.");
    status = "suspicious";
  }

  if (impliedGrowthRate < -0.2 || impliedGrowthRate > 0.4) {
    warnings.push("Reverse DCF implied growth is outside a plausible long-term range (-20% to +40%).");
    status = "suspicious";
  }

  if (isFinitePositive(currentPrice) && isFinitePositive(baseDcfFairValue) && isFiniteNumber(baseGrowth)) {
    const priceGap = (currentPrice - baseDcfFairValue) / baseDcfFairValue;
    if (Math.abs(priceGap) >= 0.1) {
      if (priceGap > 0) {
        directionallyConsistent = impliedGrowthRate > baseGrowth;
        if (!directionallyConsistent) {
          warnings.push("Current price is materially above base DCF, but implied growth is not above the base growth assumption.");
          status = impliedGrowthRate < -0.05 && priceGap > 0.25 ? "invalid" : "suspicious";
        }
      } else {
        directionallyConsistent = impliedGrowthRate < baseGrowth;
        if (!directionallyConsistent) {
          warnings.push("Current price is materially below base DCF, but implied growth is not below the base growth assumption.");
          status = "suspicious";
        }
      }
    } else {
      directionallyConsistent = true;
    }
  }

  if (input.reverseDcf.limitations.length > 0 && status === "valid") {
    warnings.push("Reverse DCF has calculation limitations; use as an expectations check only.");
    status = "suspicious";
  }

  const confidence: ConfidenceScore =
    status === "valid" ? 4 :
    status === "suspicious" ? 2 :
    1;

  return {
    status,
    confidence,
    warnings,
    diagnostics: {
      impliedGrowthRate,
      baseDcfFairValue,
      currentPrice,
      directionallyConsistent,
    },
  };
}

function baseFromDcf(input: ValuationRangeAnchor | DcfScenariosOutput | null | undefined): number | null {
  if (!input) return null;
  if ("base" in input && typeof input.base === "object" && input.base && "fairValuePerShare" in input.base) {
    return input.base.fairValuePerShare;
  }
  if ("base" in input && typeof input.base === "number") return input.base;
  return null;
}

function addComparison(
  comparisons: ValuationDivergenceOutput["comparisons"],
  leftName: string,
  leftValue: number | null,
  rightName: string,
  rightValue: number | null,
  interpretation: (differencePct: number | null) => string,
): void {
  const differencePct = pctDiff(leftValue, rightValue);
  comparisons.push({
    left: leftName,
    right: rightName,
    differencePct,
    interpretation: interpretation(differencePct),
  });
}

function levelFromDifference(maxAbsDiff: number): ValuationDivergenceOutput["divergenceLevel"] {
  if (maxAbsDiff >= 75) return "extreme";
  if (maxAbsDiff >= 40) return "high";
  if (maxAbsDiff >= 20) return "moderate";
  return "low";
}

function confidenceFromDivergence(
  level: ValuationDivergenceOutput["divergenceLevel"],
  warnings: string[],
): ConfidenceScore {
  let score = level === "low" ? 5 : level === "moderate" ? 4 : level === "high" ? 3 : 2;
  if (warnings.length >= 3) score -= 1;
  if (score <= 1) return 1;
  if (score === 2) return 2;
  if (score === 3) return 3;
  if (score === 4) return 4;
  return 5;
}

export function analyzeValuationDivergence(
  input: ValuationDivergenceAnalyzerInput,
): ValuationDivergenceOutput {
  const type = companyTypeOf(input.companyType);
  const comparisons: ValuationDivergenceOutput["comparisons"] = [];
  const warnings: string[] = [];

  const currentPrice = input.currentPrice ?? null;
  const ownBase = input.ownModel?.base ?? null;
  const dcfBase = baseFromDcf(input.dcf);
  const consensusBase = input.analystConsensus?.base ?? null;

  addComparison(comparisons, "own_model_base", ownBase, "current_price", currentPrice, diff => {
    if (diff == null) return "Own model vs. current price cannot be calculated.";
    return diff >= 0 ? "Own model implies upside vs. current price." : "Own model implies downside vs. current price.";
  });
  addComparison(comparisons, "dcf_base", dcfBase, "current_price", currentPrice, diff => {
    if (diff == null) return "DCF vs. current price cannot be calculated.";
    return diff >= 0 ? "DCF implies upside vs. current price." : "DCF implies downside vs. current price.";
  });
  addComparison(comparisons, "analyst_consensus_base", consensusBase, "current_price", currentPrice, diff => {
    if (diff == null) return "Consensus vs. current price cannot be calculated.";
    return diff >= 0 ? "Consensus implies upside vs. current price." : "Consensus implies downside vs. current price.";
  });
  addComparison(comparisons, "dcf_base", dcfBase, "own_model_base", ownBase, diff => {
    if (diff == null) return "DCF vs. own model cannot be calculated.";
    return Math.abs(diff) >= 50 ? "DCF and own model disagree materially." : "DCF and own model are within a manageable range.";
  });
  addComparison(comparisons, "dcf_base", dcfBase, "analyst_consensus_base", consensusBase, diff => {
    if (diff == null) return "DCF vs. consensus cannot be calculated.";
    return Math.abs(diff) >= 50 ? "DCF and consensus disagree materially." : "DCF and consensus are within a manageable range.";
  });
  addComparison(comparisons, "own_model_base", ownBase, "analyst_consensus_base", consensusBase, diff => {
    if (diff == null) return "Own model vs. consensus cannot be calculated.";
    return Math.abs(diff) >= 50 ? "Own model and consensus disagree materially." : "Own model and consensus are within a manageable range.";
  });

  const numericDiffs = comparisons
    .map(comparison => comparison.differencePct)
    .filter((value): value is number => value != null)
    .map(Math.abs);
  const maxAbsDiff = numericDiffs.length ? Math.max(...numericDiffs) : 0;

  if (input.dcfPlausibility?.fit === "poor") {
    warnings.push("DCF fit is poor for this company type; do not average it blindly into valuation.");
  } else if (input.dcfPlausibility?.fit === "partial") {
    warnings.push("DCF fit is partial; use it as one anchor rather than the dominant valuation driver.");
  }

  if (input.reverseDcfPlausibility?.status === "suspicious" || input.reverseDcfPlausibility?.status === "invalid") {
    warnings.push("Reverse DCF output is suspicious/invalid and should not strongly influence rating.");
  }

  if (type === "platform_conglomerate") {
    warnings.push("Platform conglomerate detected: generic FCFF DCF may be too coarse; SOTP/segment model should be preferred.");
  }

  if (type === "cyclical_hardware") {
    const dcfVsOwn = pctDiff(dcfBase, ownBase);
    const dcfVsCurrent = pctDiff(dcfBase, currentPrice);
    if ((dcfVsOwn ?? 0) > 40 || (dcfVsCurrent ?? 0) > 40) {
      warnings.push("Cyclical hardware DCF may be too optimistic; require margin, inventory, and working-capital stress.");
    } else {
      warnings.push("Cyclical hardware valuation should be stress-tested against normalized margins and FCF conversion.");
    }
  }

  if (type === "quality_compounder") {
    const ownVsCurrent = pctDiff(ownBase, currentPrice);
    const consensusVsCurrent = pctDiff(consensusBase, currentPrice);
    if ((ownVsCurrent ?? 0) < -15 && (consensusVsCurrent ?? 0) >= -5) {
      warnings.push("Quality compounder with conservative model downside: avoid automatic Sell solely from valuation.");
    }
  }

  const divergenceLevel = levelFromDifference(maxAbsDiff);
  const avoidHardBuySell =
    divergenceLevel === "extreme" ||
    (divergenceLevel === "high" && input.dcfPlausibility?.fit !== "good") ||
    input.reverseDcfPlausibility?.status === "invalid";
  const lowerRatingConfidence =
    divergenceLevel !== "low" ||
    input.dcfPlausibility?.fit === "poor" ||
    input.reverseDcfPlausibility?.status === "suspicious" ||
    input.reverseDcfPlausibility?.status === "invalid";

  let summary = "Valuation anchors are broadly consistent.";
  if (divergenceLevel === "moderate") {
    summary = "Valuation anchors show moderate disagreement; rating confidence should be tempered.";
  } else if (divergenceLevel === "high") {
    summary = "Valuation anchors materially disagree; explain model fit before using valuation in the rating.";
  } else if (divergenceLevel === "extreme") {
    summary = "Valuation anchors conflict extremely; avoid hard Buy/Sell conclusions unless supported by independent evidence.";
  }

  if (type === "platform_conglomerate") {
    summary += " For platform conglomerates, a segment/SOTP model should outrank generic consolidated DCF.";
  } else if (type === "cyclical_hardware") {
    summary += " For cyclical hardware, DCF upside must be stress-tested against margins, inventory, and cash conversion.";
  } else if (type === "quality_compounder") {
    summary += " For quality compounders, expensive valuation should be separated from business-quality deterioration.";
  }

  return {
    divergenceLevel,
    confidence: confidenceFromDivergence(divergenceLevel, warnings),
    summary,
    comparisons,
    warnings,
    ratingImpact: {
      lowerRatingConfidence,
      avoidHardBuySell,
      reason: avoidHardBuySell
        ? "Valuation disagreement or poor model fit is too high for hard Buy/Sell language."
        : lowerRatingConfidence
          ? "Valuation disagreement should lower rating confidence."
          : "Valuation anchors do not require a rating-confidence penalty.",
    },
  };
}
