import type { ConfidenceScore } from "../company-type-router";

export type SemiconductorCycleInput = {
  ticker?: string;
  currentPrice?: number;
  marketCap?: number;
  enterpriseValue?: number;
  sharesOutstanding?: number;
  revenue?: number;
  revenueGrowthPct?: number;
  grossMarginPct?: number;
  operatingMarginPct?: number;
  freeCashFlow?: number;
  netIncome?: number;
  ebitda?: number;
  dataCenterRevenuePct?: number;
  aiRevenuePct?: number;
  memoryRevenuePct?: number;
  automotiveIndustrialRevenuePct?: number;
  inventoryGrowthPct?: number;
  capexPctRevenue?: number;
  customerConcentrationPct?: number;
  evToSales?: number;
  evToEbitda?: number;
  pe?: number;
};

export type SemiconductorCycleOutput = {
  modelId: "semiconductor_cycle";
  status: "success" | "not_run_missing_inputs" | "failed";
  cycleSignals: {
    structuralGrowthExposure: "low" | "moderate" | "high";
    memoryCycleRisk: "low" | "moderate" | "high";
    inventoryCycleRisk: "low" | "moderate" | "high";
    marginNormalizationRisk: "low" | "moderate" | "high";
    customerConcentrationRisk: "low" | "moderate" | "high";
  };
  valuationContext: {
    evToSales?: number;
    evToEbitda?: number;
    pe?: number;
    valuationState: "very_expensive" | "expensive" | "fair" | "cheap" | "unknown";
  };
  fairValueContext?: {
    bearFairValue?: number;
    baseFairValue?: number;
    bullFairValue?: number;
  };
  confidence: ConfidenceScore;
  warnings: string[];
  limitations: string[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
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

function maxDefined(...values: Array<number | undefined>): number | undefined {
  const finite = values.filter(isFiniteNumber);
  return finite.length ? Math.max(...finite) : undefined;
}

function exposureSignal(value: number | undefined): "low" | "moderate" | "high" {
  if (!isFiniteNumber(value)) return "low";
  if (value > 40) return "high";
  if (value >= 15) return "moderate";
  return "low";
}

function riskFromPct(value: number | undefined): "low" | "moderate" | "high" {
  if (!isFiniteNumber(value)) return "low";
  if (value > 40) return "high";
  if (value >= 15) return "moderate";
  return "low";
}

function customerConcentrationRiskFromPct(value: number | undefined): "low" | "moderate" | "high" {
  if (!isFiniteNumber(value)) return "low";
  if (value > 40) return "high";
  if (value > 20) return "moderate";
  return "low";
}

function inventoryRisk(inventoryGrowth: number | undefined, revenueGrowth: number | undefined): "low" | "moderate" | "high" {
  if (!isFiniteNumber(inventoryGrowth) || !isFiniteNumber(revenueGrowth)) return "low";
  const spread = inventoryGrowth - revenueGrowth;
  if (spread > 10) return "high";
  if (spread > 3) return "moderate";
  return "low";
}

function marginRisk(grossMargin: number | undefined, operatingMargin: number | undefined): "low" | "moderate" | "high" {
  if ((isFiniteNumber(grossMargin) && grossMargin > 70) || (isFiniteNumber(operatingMargin) && operatingMargin > 45)) return "high";
  if ((isFiniteNumber(grossMargin) && grossMargin > 55) || (isFiniteNumber(operatingMargin) && operatingMargin > 30)) return "moderate";
  return "low";
}

function valuationState(input: SemiconductorCycleInput): SemiconductorCycleOutput["valuationContext"]["valuationState"] {
  if (isFiniteNumber(input.evToSales)) {
    if (input.evToSales > 18) return "very_expensive";
    if (input.evToSales >= 10) return "expensive";
    if (input.evToSales >= 4) return "fair";
    return "cheap";
  }
  if (isFiniteNumber(input.evToEbitda)) {
    if (input.evToEbitda > 30) return "very_expensive";
    if (input.evToEbitda >= 18) return "expensive";
    if (input.evToEbitda >= 10) return "fair";
    return "cheap";
  }
  if (isFiniteNumber(input.pe)) {
    if (input.pe > 50) return "very_expensive";
    if (input.pe >= 30) return "expensive";
    if (input.pe >= 15) return "fair";
    return "cheap";
  }
  return "unknown";
}

export function calculateSemiconductorCycle(input: SemiconductorCycleInput): SemiconductorCycleOutput {
  const warnings: string[] = [];
  const limitations: string[] = [];
  const hasAnyCycleInput = [
    input.revenueGrowthPct,
    input.grossMarginPct,
    input.operatingMarginPct,
    input.dataCenterRevenuePct,
    input.aiRevenuePct,
    input.memoryRevenuePct,
    input.inventoryGrowthPct,
    input.evToSales,
    input.evToEbitda,
    input.pe,
  ].some(isFiniteNumber);

  if (!hasAnyCycleInput) {
    return {
      modelId: "semiconductor_cycle",
      status: "not_run_missing_inputs",
      cycleSignals: {
        structuralGrowthExposure: "low",
        memoryCycleRisk: "low",
        inventoryCycleRisk: "low",
        marginNormalizationRisk: "low",
        customerConcentrationRisk: "low",
      },
      valuationContext: { valuationState: "unknown" },
      confidence: 1,
      warnings: ["Semiconductor cycle model needs semiconductor-specific growth, margin, inventory, AI/datacenter, or valuation inputs."],
      limitations: ["AI/datacenter exposure, inventory cycle, margin, and valuation inputs are missing."],
    };
  }

  const structuralGrowthExposure = exposureSignal(maxDefined(input.dataCenterRevenuePct, input.aiRevenuePct));
  const memoryCycleRisk = riskFromPct(input.memoryRevenuePct);
  const inventoryCycleRisk = inventoryRisk(input.inventoryGrowthPct, input.revenueGrowthPct);
  const marginNormalizationRisk = marginRisk(input.grossMarginPct, input.operatingMarginPct);
  const customerConcentrationRisk = customerConcentrationRiskFromPct(input.customerConcentrationPct);
  const state = valuationState(input);

  if (!isFiniteNumber(input.aiRevenuePct) && !isFiniteNumber(input.dataCenterRevenuePct)) {
    warnings.push("AI/datacenter exposure is not quantified; distinguish structural AI growth from narrative.");
    limitations.push("AI exposure not quantified with revenue or datacenter mix.");
  }
  if (inventoryCycleRisk !== "low") warnings.push("Inventory growth exceeds revenue growth; cycle risk is elevated.");
  if (customerConcentrationRisk === "high") warnings.push("Customer concentration exceeds 40%.");
  if (marginNormalizationRisk !== "low") warnings.push("Margins may normalize from elevated semiconductor-cycle levels.");
  if (memoryCycleRisk === "high") warnings.push("Memory-cycle exposure is high.");
  if (state === "very_expensive") warnings.push("Valuation is very expensive relative to semiconductor cycle anchors.");

  const fairValueContext: SemiconductorCycleOutput["fairValueContext"] = {};
  if (isPositive(input.ebitda) && isPositive(input.sharesOutstanding)) {
    let bearMultiple = 12;
    let baseMultiple = 18;
    let bullMultiple = 24;
    if (memoryCycleRisk === "high") {
      bearMultiple -= 2;
      baseMultiple -= 3;
      bullMultiple -= 4;
    }
    if (structuralGrowthExposure === "high") {
      baseMultiple += 2;
      bullMultiple += 4;
      warnings.push("High structural AI/datacenter exposure can justify higher multiples, but valuation risk remains.");
    }
    fairValueContext.bearFairValue = round2(input.ebitda * bearMultiple / input.sharesOutstanding);
    fairValueContext.baseFairValue = round2(input.ebitda * baseMultiple / input.sharesOutstanding);
    fairValueContext.bullFairValue = round2(input.ebitda * bullMultiple / input.sharesOutstanding);
  } else {
    limitations.push("EBITDA and shares outstanding missing; fair-value context not produced.");
  }

  let confidence = 3;
  if (isFiniteNumber(input.aiRevenuePct) || isFiniteNumber(input.dataCenterRevenuePct)) confidence += 1;
  if (isFiniteNumber(input.inventoryGrowthPct) && isFiniteNumber(input.revenueGrowthPct)) confidence += 1;
  if (!isPositive(input.ebitda)) confidence -= 1;
  if (warnings.length >= 4) confidence -= 1;

  return {
    modelId: "semiconductor_cycle",
    status: "success",
    cycleSignals: {
      structuralGrowthExposure,
      memoryCycleRisk,
      inventoryCycleRisk,
      marginNormalizationRisk,
      customerConcentrationRisk,
    },
    valuationContext: {
      evToSales: input.evToSales,
      evToEbitda: input.evToEbitda,
      pe: input.pe,
      valuationState: state,
    },
    fairValueContext: Object.keys(fairValueContext).length ? fairValueContext : undefined,
    confidence: clampConfidence(confidence),
    warnings,
    limitations,
  };
}
