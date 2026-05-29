import type { ConfidenceScore } from "../company-type-router";

export type PlatformSegmentType =
  | "cloud"
  | "advertising"
  | "marketplace"
  | "retail"
  | "subscriptions"
  | "payments"
  | "hardware_devices"
  | "software"
  | "other"
  | "corporate";

export type PlatformSotpSegmentInput = {
  name: string;
  type: PlatformSegmentType;
  revenue?: number;
  operatingIncome?: number;
  ebitda?: number;
  freeCashFlow?: number;
  revenueGrowthPct?: number;
  operatingMarginPct?: number;
};

export type PlatformSotpInput = {
  ticker?: string;
  currentPrice?: number;
  marketCap?: number;
  netDebt?: number;
  sharesOutstanding?: number;
  segments: PlatformSotpSegmentInput[];
  corporateCost?: number;
  unallocatedCapex?: number;
};

export type PlatformSotpOutput = {
  modelId: "platform_sotp";
  status: "success" | "not_run_missing_inputs" | "failed";
  valuation: {
    segmentValues: Array<{
      name: string;
      type: PlatformSegmentType;
      value?: number;
      method: "revenue_multiple" | "operating_income_multiple" | "ebitda_multiple" | "fcf_multiple" | "not_valued";
      multipleUsed?: number;
      warnings: string[];
      limitations: string[];
    }>;
    enterpriseValue?: number;
    equityValue?: number;
    fairValuePerShare?: number;
    bearFairValue?: number;
    baseFairValue?: number;
    bullFairValue?: number;
    currentPriceUpsideDownsidePct?: number;
  };
  confidence: ConfidenceScore;
  warnings: string[];
  limitations: string[];
};

type MultipleSet = { operatingIncome: number; ebitda: number; revenue: number };

const BASE_MULTIPLES: Record<PlatformSegmentType, MultipleSet> = {
  cloud: { operatingIncome: 22, ebitda: 18, revenue: 6 },
  advertising: { operatingIncome: 20, ebitda: 16, revenue: 5 },
  marketplace: { operatingIncome: 18, ebitda: 14, revenue: 3 },
  retail: { operatingIncome: 10, ebitda: 8, revenue: 0.8 },
  subscriptions: { operatingIncome: 18, ebitda: 14, revenue: 4 },
  payments: { operatingIncome: 18, ebitda: 14, revenue: 4 },
  hardware_devices: { operatingIncome: 10, ebitda: 8, revenue: 1.2 },
  software: { operatingIncome: 22, ebitda: 18, revenue: 6 },
  other: { operatingIncome: 12, ebitda: 9, revenue: 1.5 },
  corporate: { operatingIncome: 0, ebitda: 0, revenue: 0 },
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

function valueSegment(
  segment: PlatformSotpSegmentInput,
  scenarioMultiplier = 1,
): PlatformSotpOutput["valuation"]["segmentValues"][number] {
  const warnings: string[] = [];
  const limitations: string[] = [];
  const multiples = BASE_MULTIPLES[segment.type] ?? BASE_MULTIPLES.other;

  if (segment.type === "corporate") {
    return { name: segment.name, type: segment.type, method: "not_valued", warnings, limitations: ["Corporate segment is treated as cost center, not valued as standalone business."] };
  }

  if (isFiniteNumber(segment.operatingIncome) && segment.operatingIncome !== 0) {
    const multiple = multiples.operatingIncome * scenarioMultiplier;
    return {
      name: segment.name,
      type: segment.type,
      value: round2(segment.operatingIncome * multiple),
      method: "operating_income_multiple",
      multipleUsed: round2(multiple),
      warnings,
      limitations,
    };
  }

  if (isFiniteNumber(segment.ebitda) && segment.ebitda !== 0) {
    const multiple = multiples.ebitda * scenarioMultiplier;
    return {
      name: segment.name,
      type: segment.type,
      value: round2(segment.ebitda * multiple),
      method: "ebitda_multiple",
      multipleUsed: round2(multiple),
      warnings,
      limitations,
    };
  }

  if (isFiniteNumber(segment.freeCashFlow) && segment.freeCashFlow !== 0) {
    const multiple = multiples.operatingIncome * scenarioMultiplier;
    return {
      name: segment.name,
      type: segment.type,
      value: round2(segment.freeCashFlow * multiple),
      method: "fcf_multiple",
      multipleUsed: round2(multiple),
      warnings,
      limitations,
    };
  }

  if (isPositive(segment.revenue)) {
    const multiple = multiples.revenue * scenarioMultiplier;
    limitations.push("Revenue multiple used due to missing segment profitability.");
    return {
      name: segment.name,
      type: segment.type,
      value: round2(segment.revenue * multiple),
      method: "revenue_multiple",
      multipleUsed: round2(multiple),
      warnings,
      limitations,
    };
  }

  return {
    name: segment.name,
    type: segment.type,
    method: "not_valued",
    warnings,
    limitations: ["No segment revenue, operating income, EBITDA, or free cash flow available."],
  };
}

function sumValues(items: PlatformSotpOutput["valuation"]["segmentValues"]): number {
  return items.reduce((sum, item) => sum + (item.value ?? 0), 0);
}

function equityValueFromEnterpriseValue(ev: number, netDebt?: number): number {
  return ev - (isFiniteNumber(netDebt) ? netDebt : 0);
}

export function calculatePlatformSotp(input: PlatformSotpInput): PlatformSotpOutput {
  const warnings: string[] = [];
  const limitations: string[] = [];

  if (!Array.isArray(input.segments) || input.segments.length === 0) {
    return {
      modelId: "platform_sotp",
      status: "not_run_missing_inputs",
      valuation: { segmentValues: [] },
      confidence: 1,
      warnings: ["Platform SOTP is recommended but segment data is missing."],
      limitations: ["No segment inputs available; SOTP cannot value platform business lines."],
    };
  }

  const baseSegments = input.segments.map(segment => valueSegment(segment, 1));
  const bearSegments = input.segments.map(segment => valueSegment(segment, 0.8));
  const bullSegments = input.segments.map(segment => valueSegment(segment, 1.2));
  const valuedSegments = baseSegments.filter(segment => segment.value != null);
  const revenueOnlySegments = baseSegments.filter(segment => segment.method === "revenue_multiple");

  if (valuedSegments.length < 2) warnings.push("Fewer than two valued segments; SOTP may not capture platform mix.");
  if (baseSegments.some(segment => segment.method === "not_valued")) warnings.push("Some segments could not be valued due to missing segment metrics.");
  if (revenueOnlySegments.length > 0) {
    warnings.push("At least one segment uses revenue multiple due to missing profitability.");
    limitations.push("Revenue multiple used due to missing segment profitability.");
  }
  if (!isFiniteNumber(input.corporateCost)) limitations.push("Corporate/unallocated costs missing; enterprise value may be overstated.");
  if (!isFiniteNumber(input.unallocatedCapex)) limitations.push("Unallocated capex missing; capital intensity drag not separately modeled.");
  if (!isFiniteNumber(input.netDebt)) limitations.push("Net debt missing; equity value assumes no net debt adjustment.");
  if (!isPositive(input.sharesOutstanding)) limitations.push("Shares outstanding missing; fair value per share cannot be calculated.");
  warnings.push("Generic consolidated DCF should not dominate if SOTP segment data is available.");

  const valueDrag =
    Math.max(0, input.corporateCost ?? 0) +
    Math.max(0, input.unallocatedCapex ?? 0);
  const enterpriseValue = Math.max(0, sumValues(baseSegments) - valueDrag);
  const bearEnterpriseValue = Math.max(0, sumValues(bearSegments) - valueDrag);
  const bullEnterpriseValue = Math.max(0, sumValues(bullSegments) - valueDrag);
  const equityValue = equityValueFromEnterpriseValue(enterpriseValue, input.netDebt);
  const bearEquityValue = equityValueFromEnterpriseValue(bearEnterpriseValue, input.netDebt);
  const bullEquityValue = equityValueFromEnterpriseValue(bullEnterpriseValue, input.netDebt);

  const valuation: PlatformSotpOutput["valuation"] = {
    segmentValues: baseSegments,
    enterpriseValue: round2(enterpriseValue),
    equityValue: round2(equityValue),
  };

  if (isPositive(input.sharesOutstanding)) {
    valuation.fairValuePerShare = round2(equityValue / input.sharesOutstanding);
    valuation.baseFairValue = valuation.fairValuePerShare;
    valuation.bearFairValue = round2(bearEquityValue / input.sharesOutstanding);
    valuation.bullFairValue = round2(bullEquityValue / input.sharesOutstanding);
    if (isPositive(input.currentPrice)) {
      valuation.currentPriceUpsideDownsidePct = round2((valuation.fairValuePerShare / input.currentPrice - 1) * 100);
    }
  }

  let confidence = 3;
  if (valuedSegments.length >= 3) confidence += 1;
  if (revenueOnlySegments.length > 0) confidence -= 1;
  if (!isPositive(input.sharesOutstanding)) confidence -= 1;
  if (baseSegments.some(segment => segment.method === "not_valued")) confidence -= 1;

  return {
    modelId: "platform_sotp",
    status: "success",
    valuation,
    confidence: clampConfidence(confidence),
    warnings,
    limitations: [...new Set(limitations.concat(baseSegments.flatMap(segment => segment.limitations)))],
  };
}
