import type { ConfidenceScore } from "../company-type-router";

export type SoftwareRuleOf40Input = {
  ticker?: string;
  currentPrice?: number;
  marketCap?: number;
  enterpriseValue?: number;
  revenue?: number;
  revenueGrowthPct?: number;
  arrGrowthPct?: number;
  netRevenueRetentionPct?: number;
  grossRetentionPct?: number;
  grossMarginPct?: number;
  operatingMarginPct?: number;
  freeCashFlowMarginPct?: number;
  stockBasedCompPctRevenue?: number;
  evToSales?: number;
  evToFcf?: number;
};

export type SoftwareRuleOf40Output = {
  modelId: "software_rule_of_40";
  status: "success" | "not_run_missing_inputs" | "failed";
  scores: {
    ruleOf40Score?: number;
    growthScore: number;
    profitabilityScore: number;
    retentionScore?: number;
    dilutionPenalty: number;
  };
  valuationContext: {
    evToSales?: number;
    evToFcf?: number;
    valuationState: "very_expensive" | "expensive" | "fair" | "cheap" | "unknown";
  };
  qualitySignals: {
    growthDurability: "weak" | "average" | "strong";
    profitabilityPath: "weak" | "improving" | "strong";
    retentionQuality: "weak" | "average" | "strong" | "unknown";
    dilutionRisk: "low" | "moderate" | "high";
  };
  confidence: ConfidenceScore;
  warnings: string[];
  limitations: string[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampConfidence(value: number): ConfidenceScore {
  if (value >= 5) return 5;
  if (value >= 4) return 4;
  if (value >= 3) return 3;
  if (value >= 2) return 2;
  return 1;
}

function growthSignal(growth: number): "weak" | "average" | "strong" {
  if (growth > 30) return "strong";
  if (growth >= 10) return "average";
  return "weak";
}

function scoreGrowth(growth: number): number {
  if (growth > 30) return 90;
  if (growth >= 10) return 60;
  return 30;
}

function profitabilitySignal(margin: number): "weak" | "improving" | "strong" {
  if (margin > 15) return "strong";
  if (margin >= 0) return "improving";
  return "weak";
}

function scoreProfitability(margin: number): number {
  if (margin > 15) return 90;
  if (margin >= 0) return 60;
  return 25;
}

function retentionSignal(nrr: number | undefined): "weak" | "average" | "strong" | "unknown" {
  if (!isFiniteNumber(nrr)) return "unknown";
  if (nrr > 120) return "strong";
  if (nrr >= 100) return "average";
  return "weak";
}

function scoreRetention(nrr: number | undefined): number | undefined {
  if (!isFiniteNumber(nrr)) return undefined;
  if (nrr > 120) return 90;
  if (nrr >= 100) return 60;
  return 25;
}

function dilutionRisk(sbcPct: number | undefined): "low" | "moderate" | "high" {
  if (!isFiniteNumber(sbcPct)) return "moderate";
  if (sbcPct > 15) return "high";
  if (sbcPct >= 5) return "moderate";
  return "low";
}

function dilutionPenalty(sbcPct: number | undefined): number {
  if (!isFiniteNumber(sbcPct)) return 10;
  if (sbcPct > 15) return 30;
  if (sbcPct >= 5) return 15;
  return 0;
}

function valuationState(evToSales: number | undefined): SoftwareRuleOf40Output["valuationContext"]["valuationState"] {
  if (!isFiniteNumber(evToSales)) return "unknown";
  if (evToSales > 15) return "very_expensive";
  if (evToSales >= 8) return "expensive";
  if (evToSales >= 4) return "fair";
  return "cheap";
}

export function calculateSoftwareRuleOf40(input: SoftwareRuleOf40Input): SoftwareRuleOf40Output {
  const warnings: string[] = [];
  const limitations: string[] = [];
  const growth = isFiniteNumber(input.arrGrowthPct) ? input.arrGrowthPct : input.revenueGrowthPct;
  const margin = isFiniteNumber(input.freeCashFlowMarginPct)
    ? input.freeCashFlowMarginPct
    : input.operatingMarginPct;

  if (!isFiniteNumber(growth) || !isFiniteNumber(margin)) {
    return {
      modelId: "software_rule_of_40",
      status: "not_run_missing_inputs",
      scores: { growthScore: 0, profitabilityScore: 0, dilutionPenalty: 0 },
      valuationContext: { valuationState: "unknown" },
      qualitySignals: {
        growthDurability: "weak",
        profitabilityPath: "weak",
        retentionQuality: "unknown",
        dilutionRisk: "moderate",
      },
      confidence: 1,
      warnings: ["Rule of 40 requires growth plus free-cash-flow or operating margin."],
      limitations: ["Growth and margin data are insufficient for software Rule of 40."],
    };
  }

  if (!isFiniteNumber(input.arrGrowthPct)) warnings.push("ARR growth missing; revenue growth used as weaker proxy.");
  if (!isFiniteNumber(input.freeCashFlowMarginPct)) {
    limitations.push("FCF margin missing; operating margin used as fallback.");
    warnings.push("Operating margin fallback used; FCF path is less certain.");
  }

  const ruleOf40Score = round2(growth + margin);
  const retention = retentionSignal(input.netRevenueRetentionPct);
  const retScore = scoreRetention(input.netRevenueRetentionPct);
  const state = valuationState(input.evToSales);
  const dilution = dilutionPenalty(input.stockBasedCompPctRevenue);

  if (ruleOf40Score < 40) warnings.push("Rule of 40 is below 40; growth/profitability balance is weak.");
  if (margin < 0) warnings.push("Free-cash-flow or operating margin is negative.");
  if (input.stockBasedCompPctRevenue != null && input.stockBasedCompPctRevenue > 15) warnings.push("Stock-based compensation exceeds 15% of revenue.");
  if (!isFiniteNumber(input.netRevenueRetentionPct)) warnings.push("NRR missing; retention quality cannot be verified.");
  if (!isFiniteNumber(input.arrGrowthPct)) limitations.push("ARR growth missing; revenue growth is less precise for SaaS.");
  if (state === "very_expensive") warnings.push("EV/Sales is very expensive; valuation needs strong FCF path.");

  let confidence = 3;
  if (isFiniteNumber(input.arrGrowthPct)) confidence += 1;
  if (isFiniteNumber(input.freeCashFlowMarginPct)) confidence += 1;
  if (!isFiniteNumber(input.netRevenueRetentionPct)) confidence -= 1;
  if (dilution >= 30) confidence -= 1;

  return {
    modelId: "software_rule_of_40",
    status: "success",
    scores: {
      ruleOf40Score,
      growthScore: scoreGrowth(growth),
      profitabilityScore: scoreProfitability(margin),
      retentionScore: retScore,
      dilutionPenalty: dilution,
    },
    valuationContext: {
      evToSales: input.evToSales,
      evToFcf: input.evToFcf,
      valuationState: state,
    },
    qualitySignals: {
      growthDurability: growthSignal(growth),
      profitabilityPath: profitabilitySignal(margin),
      retentionQuality: retention,
      dilutionRisk: dilutionRisk(input.stockBasedCompPctRevenue),
    },
    confidence: clampConfidence(confidence),
    warnings,
    limitations,
  };
}
