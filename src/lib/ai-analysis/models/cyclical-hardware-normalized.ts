import type { ConfidenceScore } from "../company-type-router";

export type CyclicalHardwareNormalizedInput = {
  ticker?: string;
  currentPrice?: number;
  marketCap?: number;
  enterpriseValue?: number;
  sharesOutstanding?: number;
  netDebt?: number;
  revenue?: number;
  grossMarginPct?: number;
  operatingMarginPct?: number;
  ebitda?: number;
  operatingIncome?: number;
  netIncome?: number;
  freeCashFlow?: number;
  revenueGrowthPct?: number;
  inventoryGrowthPct?: number;
  workingCapitalGrowthPct?: number;
  customerConcentrationPct?: number;
  historicalOperatingMarginPct?: number[];
  historicalGrossMarginPct?: number[];
};

export type CyclicalHardwareNormalizedOutput = {
  modelId: "cyclical_hardware_normalized";
  status: "success" | "not_run_missing_inputs" | "failed";
  valuation: {
    normalizedOperatingMarginPct?: number;
    normalizedOperatingIncome?: number;
    normalizedEbitda?: number;
    evToNormalizedEbitda?: number;
    priceToNormalizedEarnings?: number;
    bearFairValue?: number;
    baseFairValue?: number;
    bullFairValue?: number;
  };
  cycleSignals: {
    marginRisk: "low" | "moderate" | "high";
    workingCapitalRisk: "low" | "moderate" | "high";
    inventoryRisk: "low" | "moderate" | "high";
    customerConcentrationRisk: "low" | "moderate" | "high";
    fcfConversionAssessment: "weak" | "adequate" | "strong";
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

function median(values: number[]): number | null {
  const finite = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
}

function assessSpreadRisk(metricGrowth: number | undefined, revenueGrowth: number | undefined): "low" | "moderate" | "high" {
  if (!isFiniteNumber(metricGrowth) || !isFiniteNumber(revenueGrowth)) return "moderate";
  const spread = metricGrowth - revenueGrowth;
  if (spread > 10) return "high";
  if (spread > 3) return "moderate";
  return "low";
}

function assessCustomerConcentration(value: number | undefined): "low" | "moderate" | "high" {
  if (!isFiniteNumber(value)) return "moderate";
  if (value > 40) return "high";
  if (value > 20) return "moderate";
  return "low";
}

function assessMarginRisk(input: CyclicalHardwareNormalizedInput, normalizedMargin: number): "low" | "moderate" | "high" {
  const current = input.operatingMarginPct;
  const historical = input.historicalOperatingMarginPct?.filter(isFiniteNumber) ?? [];
  if (historical.length >= 3 && isFiniteNumber(current)) {
    const max = Math.max(...historical);
    if (current > max + 3) return "high";
    if (current > normalizedMargin + 3) return "moderate";
    return "low";
  }
  if (!historical.length) return "moderate";
  return "low";
}

function assessFcfConversion(input: CyclicalHardwareNormalizedInput): "weak" | "adequate" | "strong" {
  if (!isFiniteNumber(input.freeCashFlow) || !isPositive(input.netIncome)) return "weak";
  const ratio = input.freeCashFlow / input.netIncome;
  if (ratio > 0.8) return "strong";
  if (ratio >= 0.4) return "adequate";
  return "weak";
}

export function calculateCyclicalHardwareNormalized(input: CyclicalHardwareNormalizedInput): CyclicalHardwareNormalizedOutput {
  const warnings: string[] = [];
  const limitations: string[] = [];

  const hasRevenueAndMargin = isPositive(input.revenue) && (isFiniteNumber(input.operatingMarginPct) || (input.historicalOperatingMarginPct?.length ?? 0) > 0);
  const hasEarningsFallback = isPositive(input.netIncome) && isPositive(input.sharesOutstanding);

  if (!hasRevenueAndMargin && !hasEarningsFallback) {
    return {
      modelId: "cyclical_hardware_normalized",
      status: "not_run_missing_inputs",
      valuation: {},
      cycleSignals: {
        marginRisk: "moderate",
        workingCapitalRisk: "moderate",
        inventoryRisk: "moderate",
        customerConcentrationRisk: "moderate",
        fcfConversionAssessment: "weak",
      },
      confidence: 1,
      warnings: ["Normalized hardware model needs revenue plus margin history/current margin, or net income plus shares."],
      limitations: ["Revenue and normalized earnings base are missing; model cannot run."],
    };
  }

  const histMedian = median(input.historicalOperatingMarginPct ?? []);
  let normalizedOperatingMarginPct: number | undefined = histMedian ?? undefined;
  if (!isFiniteNumber(normalizedOperatingMarginPct) && isFiniteNumber(input.operatingMarginPct)) {
    normalizedOperatingMarginPct = input.operatingMarginPct - 2;
    limitations.push("Historical margins missing; current margin stress adjustment used.");
    warnings.push("Historical margins missing; normalized margin uses a 2 percentage-point stress adjustment.");
  }

  const valuation: CyclicalHardwareNormalizedOutput["valuation"] = {};
  let confidence = 3;

  if (isPositive(input.revenue) && isFiniteNumber(normalizedOperatingMarginPct)) {
    valuation.normalizedOperatingMarginPct = round2(normalizedOperatingMarginPct);
    valuation.normalizedOperatingIncome = round2(input.revenue * normalizedOperatingMarginPct / 100);
    valuation.normalizedEbitda = isPositive(input.ebitda)
      ? round2(input.ebitda * (normalizedOperatingMarginPct / Math.max(1, input.operatingMarginPct ?? normalizedOperatingMarginPct)))
      : undefined;

    const normalizedBase = valuation.normalizedEbitda ?? valuation.normalizedOperatingIncome;
    if (isPositive(normalizedBase)) {
      const bearEv = normalizedBase * 8;
      const baseEv = normalizedBase * 12;
      const bullEv = normalizedBase * 16;
      const netDebt = input.netDebt ?? 0;
      if (isPositive(input.sharesOutstanding)) {
        valuation.bearFairValue = round2((bearEv - netDebt) / input.sharesOutstanding);
        valuation.baseFairValue = round2((baseEv - netDebt) / input.sharesOutstanding);
        valuation.bullFairValue = round2((bullEv - netDebt) / input.sharesOutstanding);
      }
      if (isPositive(input.enterpriseValue) && isPositive(valuation.normalizedEbitda)) {
        valuation.evToNormalizedEbitda = round2(input.enterpriseValue / valuation.normalizedEbitda);
      }
    }
    if (histMedian != null) confidence += 1;
  } else if (hasEarningsFallback) {
    limitations.push("Revenue or operating margin missing; net income P/E fallback used.");
    valuation.bearFairValue = round2((input.netIncome! / input.sharesOutstanding!) * 10);
    valuation.baseFairValue = round2((input.netIncome! / input.sharesOutstanding!) * 15);
    valuation.bullFairValue = round2((input.netIncome! / input.sharesOutstanding!) * 20);
    if (isPositive(input.currentPrice)) {
      valuation.priceToNormalizedEarnings = round2(input.currentPrice / (input.netIncome! / input.sharesOutstanding!));
    }
    confidence -= 1;
  }

  const inventoryRisk = assessSpreadRisk(input.inventoryGrowthPct, input.revenueGrowthPct);
  const workingCapitalRisk = assessSpreadRisk(input.workingCapitalGrowthPct, input.revenueGrowthPct);
  const customerConcentrationRisk = assessCustomerConcentration(input.customerConcentrationPct);
  const fcfConversionAssessment = assessFcfConversion(input);
  const marginRisk = isFiniteNumber(normalizedOperatingMarginPct)
    ? assessMarginRisk(input, normalizedOperatingMarginPct)
    : "moderate";

  if (inventoryRisk === "high") warnings.push("Inventory growth exceeds revenue growth by more than 10 percentage points.");
  if (workingCapitalRisk === "high") warnings.push("Working-capital growth exceeds revenue growth by more than 10 percentage points.");
  if (customerConcentrationRisk === "high") warnings.push("Customer concentration exceeds 40%; cycle and customer-specific risk are elevated.");
  if (fcfConversionAssessment === "weak") warnings.push("Free cash flow conversion is weak or cannot be verified.");
  if (!isPositive(input.netIncome)) limitations.push("Net income missing; FCF conversion cannot be assessed reliably.");
  warnings.push("DCF upside may be unreliable if driven by aggressive terminal value or peak-cycle margins.");

  if (inventoryRisk === "high" || workingCapitalRisk === "high" || fcfConversionAssessment === "weak") confidence -= 1;
  if (!isPositive(input.sharesOutstanding)) confidence -= 1;

  return {
    modelId: "cyclical_hardware_normalized",
    status: "success",
    valuation,
    cycleSignals: {
      marginRisk,
      workingCapitalRisk,
      inventoryRisk,
      customerConcentrationRisk,
      fcfConversionAssessment,
    },
    confidence: clampConfidence(confidence),
    warnings,
    limitations,
  };
}
