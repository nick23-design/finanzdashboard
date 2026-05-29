import type { SectorTemplateKey } from "./valuation-model";

export type ConfidenceScore = 1 | 2 | 3 | 4 | 5;

export type CompanyType =
  | "quality_compounder"
  | "platform_conglomerate"
  | "cyclical_hardware"
  | "hypergrowth_software"
  | "financial"
  | "reit"
  | "commodity_cyclical"
  | "industrial_cyclical"
  | "turnaround"
  | "deep_value"
  | "speculative_growth"
  | "income"
  | "unknown";

export type CompanyTypeClassification = {
  primaryType: CompanyType;
  secondaryTypes: CompanyType[];
  confidence: ConfidenceScore;
  rationale: string;
  evidence: string[];
  limitations: string[];
};

export type BusinessSegmentSignal = {
  name: string;
  revenuePct?: number | null;
  operatingMargin?: number | null;
};

export type CompanyTypeRouterInput = {
  sectorTemplate?: SectorTemplateKey | string | null;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  revenueGrowth?: number | null;
  grossMargin?: number | null;
  operatingMargin?: number | null;
  fcfMargin?: number | null;
  roic?: number | null;
  debtToEquity?: number | null;
  marginVolatility?: number | null;
  revenueCyclicality?: number | null;
  stockVolatility?: number | null;
  peRatio?: number | null;
  dividendYield?: number | null;
  freeCashFlow?: number | null;
  marketCap?: number | null;
  hasDurableFcf?: boolean | null;
  accountingRisk?: boolean | null;
  complianceRisk?: boolean | null;
  workingCapitalRisk?: boolean | null;
  inventoryRisk?: boolean | null;
  turnaroundSignals?: boolean | null;
  segmentDataAvailable?: boolean | null;
  segments?: BusinessSegmentSignal[] | null;
  alpha?: {
    qualityScore?: number | null;
    moatScore?: number | null;
    riskScore?: number | null;
    valuationScore?: number | null;
  } | null;
};

export type ValuationModelFit = {
  model:
    | "fcff_dcf"
    | "reverse_dcf"
    | "relative_valuation"
    | "sotp"
    | "asset_based"
    | "nav"
    | "bank_valuation"
    | "cyclical_normalized_earnings";
  fit: "poor" | "partial" | "good" | "primary";
  confidence: ConfidenceScore;
  reason: string;
  limitations: string[];
};

export type ModelSelectionOutput = {
  companyType: CompanyTypeClassification;
  recommendedModels: ValuationModelFit[];
  primaryValuationModel: ValuationModelFit;
  warnings: string[];
};

export type ModelSelectionContext = {
  hasSegmentData?: boolean;
  hasStressCase?: boolean;
  hasBookValueData?: boolean;
  hasNavData?: boolean;
  hasNormalizedCycleData?: boolean;
};

type Candidate = {
  type: CompanyType;
  weight: number;
  evidence: string[];
};

const MODEL_PRIORITY: Record<ValuationModelFit["fit"], number> = {
  primary: 4,
  good: 3,
  partial: 2,
  poor: 1,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function clampConfidence(value: number): ConfidenceScore {
  if (value >= 5) return 5;
  if (value >= 4) return 4;
  if (value >= 3) return 3;
  if (value >= 2) return 2;
  return 1;
}

function hasAny(text: string, tokens: string[]): boolean {
  return tokens.some(token => text.includes(token));
}

function countAvailableSignals(input: CompanyTypeRouterInput): number {
  const scalarSignals = [
    input.sectorTemplate,
    input.sector,
    input.industry,
    input.description,
    input.revenueGrowth,
    input.grossMargin,
    input.operatingMargin,
    input.fcfMargin,
    input.roic,
    input.debtToEquity,
    input.marginVolatility,
    input.revenueCyclicality,
    input.stockVolatility,
    input.peRatio,
    input.dividendYield,
    input.freeCashFlow,
    input.marketCap,
    input.alpha?.qualityScore,
    input.alpha?.moatScore,
    input.alpha?.riskScore,
  ].filter(value => value != null && value !== "");

  return scalarSignals.length + (input.segments?.length ?? 0);
}

function segmentMarginSpread(segments: BusinessSegmentSignal[] | null | undefined): number | null {
  const margins = (segments ?? [])
    .map(segment => segment.operatingMargin)
    .filter((value): value is number => isFiniteNumber(value));

  if (margins.length < 2) return null;
  return Math.max(...margins) - Math.min(...margins);
}

function materialSegmentCount(segments: BusinessSegmentSignal[] | null | undefined): number {
  return (segments ?? []).filter(segment =>
    segment.name.trim().length > 0 &&
    (segment.revenuePct == null || segment.revenuePct >= 0.1),
  ).length;
}

function addCandidate(candidates: Candidate[], type: CompanyType, weight: number, evidence: string[]): void {
  if (weight <= 0) return;
  const existing = candidates.find(candidate => candidate.type === type);
  if (existing) {
    existing.weight = Math.max(existing.weight, weight);
    existing.evidence = unique([...existing.evidence, ...evidence]);
    return;
  }
  candidates.push({ type, weight, evidence: unique(evidence) });
}

function buildSearchText(input: CompanyTypeRouterInput): string {
  return [
    input.sectorTemplate,
    input.sector,
    input.industry,
    input.description,
    ...(input.segments ?? []).map(segment => segment.name),
  ].map(normalizeText).join(" ");
}

function buildUnknown(input: CompanyTypeRouterInput, limitations: string[]): CompanyTypeClassification {
  const available = countAvailableSignals(input);
  return {
    primaryType: "unknown",
    secondaryTypes: [],
    confidence: 1,
    rationale: "Insufficient structured data for a reliable company-type classification.",
    evidence: available > 0 ? [`Available structured signals: ${available}.`] : [],
    limitations: unique([
      "Missing sector, industry, margin, cash-flow, or segment signals prevent deterministic routing.",
      ...limitations,
    ]),
  };
}

function buildRationale(primaryType: CompanyType, evidence: string[]): string {
  const first = evidence[0] ?? "Structured signals support this classification.";
  switch (primaryType) {
    case "quality_compounder":
      return `Quality compounder: ${first}`;
    case "platform_conglomerate":
      return `Platform conglomerate: materially different business lines require segment-aware valuation. ${first}`;
    case "cyclical_hardware":
      return `Cyclical hardware: valuation needs cycle, margin, inventory, and working-capital stress. ${first}`;
    case "hypergrowth_software":
      return `Hypergrowth software: growth and retention economics matter more than near-term earnings. ${first}`;
    case "financial":
      return `Financial company: balance-sheet, book-value, capital, and credit metrics should dominate. ${first}`;
    case "reit":
      return `REIT: NAV, AFFO, leverage, occupancy, and rate sensitivity should dominate. ${first}`;
    case "commodity_cyclical":
      return `Commodity cyclical: normalized commodity prices and cost-curve risk should dominate. ${first}`;
    case "industrial_cyclical":
      return `Industrial cyclical: order cycle, backlog, utilization, and normalized margins should dominate. ${first}`;
    case "turnaround":
      return `Turnaround: the thesis depends on improving fundamentals after weak recent performance. ${first}`;
    case "deep_value":
      return `Deep value: valuation looks cheap, but quality and value-trap risk need emphasis. ${first}`;
    case "speculative_growth":
      return `Speculative growth: long-term optionality and funding/execution risk dominate. ${first}`;
    case "income":
      return `Income: payout durability and cash-flow stability are central. ${first}`;
    case "unknown":
      return "Insufficient structured data for a reliable company-type classification.";
  }
}

function confidenceFromCandidate(candidate: Candidate, secondWeight: number, limitations: string[]): ConfidenceScore {
  let score = 1;
  if (candidate.weight >= 95) score = 5;
  else if (candidate.weight >= 82) score = 4;
  else if (candidate.weight >= 68) score = 3;
  else if (candidate.weight >= 55) score = 2;

  if (secondWeight > 0 && candidate.weight - secondWeight < 10) score -= 1;
  if (limitations.length >= 3) score -= 1;
  if (candidate.evidence.length >= 3 && limitations.length === 0) score += 1;

  return clampConfidence(score);
}

export function routeCompanyType(input: CompanyTypeRouterInput): CompanyTypeClassification {
  const limitations: string[] = [];
  const availableSignals = countAvailableSignals(input);
  const text = buildSearchText(input);
  const candidates: Candidate[] = [];

  if (availableSignals < 3 && !input.sectorTemplate && !input.sector && !input.industry) {
    return buildUnknown(input, limitations);
  }

  if (!input.sectorTemplate && !input.sector && !input.industry) {
    limitations.push("Sector or industry signal is missing.");
  }

  const segmentCount = materialSegmentCount(input.segments);
  const marginSpread = segmentMarginSpread(input.segments);
  const hasSegmentData = input.segmentDataAvailable === true || segmentCount >= 2;
  const template = normalizeText(input.sectorTemplate);
  const fcfPositive = (input.freeCashFlow != null && input.freeCashFlow > 0) || (input.fcfMargin != null && input.fcfMargin > 0);
  const fcfDurable = input.hasDurableFcf === true || (input.fcfMargin != null && input.fcfMargin >= 0.1 && fcfPositive);
  const qualityScore = input.alpha?.qualityScore ?? null;
  const moatScore = input.alpha?.moatScore ?? null;
  const riskScore = input.alpha?.riskScore ?? null;

  if (template === "bank" || template === "insurance" || hasAny(text, ["bank", "insurance", "financial services", "brokerage"])) {
    addCandidate(candidates, "financial", 96, ["Sector/industry points to a financial balance-sheet business."]);
  }

  if (template === "reit" || hasAny(text, ["reit", "real estate investment trust", "real estate income"])) {
    addCandidate(candidates, "reit", 97, ["REIT signal found in sector, industry, or description."]);
  }

  if (template === "energy" || hasAny(text, ["oil", "gas", "mining", "commodity", "metals", "exploration", "producer"])) {
    addCandidate(candidates, "commodity_cyclical", 90, ["Commodity-sensitive sector requires normalized price assumptions."]);
  }

  const platformEvidence: string[] = [];
  if (template === "marketplace_platform") platformEvidence.push("Sector template is marketplace/platform.");
  if (segmentCount >= 3) platformEvidence.push(`${segmentCount} material business segments detected.`);
  if (marginSpread != null && marginSpread >= 0.15) platformEvidence.push(`Segment operating-margin spread is ${pct(marginSpread)}.`);
  if (hasAny(text, ["marketplace", "platform", "advertising", "aws", "cloud", "retail", "fulfillment"])) {
    platformEvidence.push("Text signals indicate platform/cloud/advertising/retail mix.");
  }
  if (platformEvidence.length >= 2 || (template === "marketplace_platform" && platformEvidence.length >= 1)) {
    addCandidate(candidates, "platform_conglomerate", 88 + Math.min(platformEvidence.length * 3, 9), platformEvidence);
    if (!hasSegmentData) limitations.push("Platform/conglomerate routing is weaker without usable segment data.");
  }

  const hardwareEvidence: string[] = [];
  if (template === "semiconductor" || template === "automotive") hardwareEvidence.push(`Sector template is ${template}.`);
  if (hasAny(text, ["semiconductor", "chip", "hardware", "server", "infrastructure", "equipment", "components", "manufacturing"])) {
    hardwareEvidence.push("Industry text indicates hardware, infrastructure, or manufacturing exposure.");
  }
  if (input.marginVolatility != null && input.marginVolatility >= 0.08) hardwareEvidence.push(`Margin volatility is elevated (${pct(input.marginVolatility)}).`);
  if (input.revenueCyclicality != null && input.revenueCyclicality >= 0.18) hardwareEvidence.push(`Revenue cyclicality is elevated (${pct(input.revenueCyclicality)}).`);
  if (input.workingCapitalRisk || input.inventoryRisk) hardwareEvidence.push("Working-capital or inventory risk is present.");
  if (input.accountingRisk || input.complianceRisk) hardwareEvidence.push("Accounting/compliance risk is present.");
  if (hardwareEvidence.length >= 2) {
    addCandidate(candidates, "cyclical_hardware", 76 + Math.min(hardwareEvidence.length * 4, 16), hardwareEvidence);
  }

  if (template === "cyclical_industrial" || hasAny(text, ["industrial", "machinery", "aerospace", "capital goods", "construction equipment"])) {
    addCandidate(candidates, "industrial_cyclical", 76, ["Industrial/capital-goods exposure suggests cyclicality."]);
  }

  if (
    (template === "saas" || hasAny(text, ["saas", "software", "subscription"])) &&
    input.revenueGrowth != null &&
    input.revenueGrowth >= 0.25 &&
    (input.grossMargin == null || input.grossMargin >= 0.6)
  ) {
    addCandidate(candidates, "hypergrowth_software", 84, [
      `Revenue growth is ${pct(input.revenueGrowth)}.`,
      input.grossMargin != null ? `Gross margin is ${pct(input.grossMargin)}.` : "Software/subscription signal present.",
    ]);
  }

  const qualityEvidence: string[] = [];
  if (qualityScore != null && qualityScore >= 75) qualityEvidence.push(`Alpha quality score is ${qualityScore}/100.`);
  if (moatScore != null && moatScore >= 65) qualityEvidence.push(`Moat score is ${moatScore}/100.`);
  if (fcfDurable) qualityEvidence.push("Free cash flow is positive and durable.");
  if (input.operatingMargin != null && input.operatingMargin >= 0.2) qualityEvidence.push(`Operating margin is ${pct(input.operatingMargin)}.`);
  if (input.roic != null && input.roic >= 0.12) qualityEvidence.push(`ROIC is ${pct(input.roic)}.`);
  if (input.debtToEquity != null && input.debtToEquity <= 1.5) qualityEvidence.push(`Debt/equity is controlled (${input.debtToEquity.toFixed(2)}).`);
  if (input.marginVolatility != null && input.marginVolatility <= 0.07) qualityEvidence.push(`Margin volatility is low (${pct(input.marginVolatility)}).`);
  if (riskScore != null && riskScore <= 40) qualityEvidence.push(`Risk score is controlled (${riskScore}/100).`);

  if (qualityEvidence.length >= 4) {
    addCandidate(candidates, "quality_compounder", 72 + Math.min(qualityEvidence.length * 4, 20), qualityEvidence);
  } else if (qualityScore != null || input.operatingMargin != null || input.fcfMargin != null || input.roic != null) {
    limitations.push("Quality-compounder routing needs stronger proof of durable FCF, margins, ROIC, and balance-sheet quality.");
  }

  if (
    (input.freeCashFlow != null && input.freeCashFlow < 0) ||
    (input.fcfMargin != null && input.fcfMargin < 0)
  ) {
    if ((input.revenueGrowth ?? 0) >= 0.15 || (input.stockVolatility ?? 0) >= 0.55 || (input.marketCap ?? 0) < 25_000_000_000) {
      addCandidate(candidates, "speculative_growth", 74, ["Negative FCF with high growth, volatility, or smaller market cap."]);
    }
  }

  if (input.turnaroundSignals || ((input.revenueGrowth ?? 0) < -0.05 && fcfPositive)) {
    addCandidate(candidates, "turnaround", 70, ["Weak recent growth with explicit turnaround or recovery signal."]);
  }

  if ((input.peRatio ?? Infinity) <= 10 && fcfPositive && (qualityScore == null || qualityScore < 55)) {
    addCandidate(candidates, "deep_value", 68, ["Low P/E with positive FCF but limited quality evidence."]);
  }

  if ((input.dividendYield ?? 0) >= 0.035 && fcfPositive && (input.revenueGrowth ?? 0) <= 0.08) {
    addCandidate(candidates, "income", 69, ["Dividend yield and cash-flow profile point to an income thesis."]);
  }

  if (candidates.length === 0) {
    return buildUnknown(input, limitations);
  }

  candidates.sort((a, b) => b.weight - a.weight);
  const primary = candidates[0];
  const secondaryTypes = candidates
    .slice(1)
    .filter(candidate => candidate.weight >= primary.weight * 0.65)
    .map(candidate => candidate.type)
    .filter(type => type !== primary.type)
    .slice(0, 3);

  const confidence = confidenceFromCandidate(primary, candidates[1]?.weight ?? 0, limitations);
  const evidence = primary.evidence;

  return {
    primaryType: primary.type,
    secondaryTypes: unique(secondaryTypes),
    confidence,
    rationale: buildRationale(primary.type, evidence),
    evidence,
    limitations: unique(limitations),
  };
}

function fit(
  model: ValuationModelFit["model"],
  fitValue: ValuationModelFit["fit"],
  confidence: ConfidenceScore,
  reason: string,
  limitations: string[] = [],
): ValuationModelFit {
  return { model, fit: fitValue, confidence, reason, limitations };
}

function choosePrimary(models: ValuationModelFit[]): ValuationModelFit {
  const sorted = [...models].sort((a, b) => {
    const fitDiff = MODEL_PRIORITY[b.fit] - MODEL_PRIORITY[a.fit];
    if (fitDiff !== 0) return fitDiff;
    return b.confidence - a.confidence;
  });
  return sorted[0];
}

function modelContextFromInput(input: CompanyTypeRouterInput): ModelSelectionContext {
  return {
    hasSegmentData: input.segmentDataAvailable === true || materialSegmentCount(input.segments) >= 2,
    hasStressCase: false,
    hasBookValueData: false,
    hasNavData: false,
    hasNormalizedCycleData: false,
  };
}

export function selectValuationModels(
  companyType: CompanyTypeClassification,
  context: ModelSelectionContext = {},
): ModelSelectionOutput {
  const warnings: string[] = [];
  let recommendedModels: ValuationModelFit[];

  switch (companyType.primaryType) {
    case "quality_compounder":
      recommendedModels = [
        fit("fcff_dcf", "primary", 4, "Durable FCF and high quality can support FCFF DCF, but valuation should remain scenario-based."),
        fit("relative_valuation", "good", 4, "Premium quality should be checked against comparable quality-growth multiples."),
        fit("reverse_dcf", "good", 4, "Useful to test what growth expectations are already embedded in the price."),
      ];
      warnings.push("Expensive valuation alone should not automatically become Sell for a quality compounder.");
      break;

    case "platform_conglomerate":
      if (!context.hasSegmentData) warnings.push("SOTP is the right primary framework, but segment data is missing or incomplete.");
      recommendedModels = [
        fit("sotp", "primary", context.hasSegmentData ? 4 : 2, "Different business lines can have different margins, growth, and multiples.", context.hasSegmentData ? [] : ["SOTP model is metadata-only until segment data is available."]),
        fit("fcff_dcf", "partial", 2, "Consolidated FCFF DCF can be too coarse for mixed-margin segments.", ["Do not let generic DCF dominate the final rating."]),
        fit("reverse_dcf", "partial", 3, "Useful as an expectations check, but segment mix can distort interpretation."),
        fit("relative_valuation", "good", 3, "Peer multiples can help triangulate, but peer selection is difficult for conglomerates."),
      ];
      break;

    case "cyclical_hardware":
      if (!context.hasStressCase) warnings.push("Cyclical hardware needs normalized margins, working-capital stress, and terminal-value checks.");
      recommendedModels = [
        fit("cyclical_normalized_earnings", "primary", context.hasNormalizedCycleData ? 4 : 3, "Cycle-aware earnings are more reliable than straight-line growth extrapolation.", context.hasNormalizedCycleData ? [] : ["Normalized-cycle data is not yet fully implemented."]),
        fit("relative_valuation", "good", 3, "Through-cycle peer multiples are useful for hardware/capex-cycle businesses."),
        fit("fcff_dcf", "partial", 2, "DCF can overstate value if growth, margins, inventory, or terminal value are not stressed."),
        fit("reverse_dcf", "partial", 2, "Expectations analysis is useful but should be capped by cyclicality and execution risk."),
      ];
      break;

    case "financial":
      if (!context.hasBookValueData) warnings.push("Financial valuation needs book value, ROE, capital ratios, and credit-quality data.");
      recommendedModels = [
        fit("bank_valuation", "primary", context.hasBookValueData ? 4 : 2, "Financials should be valued with book-value, ROE, capital, and credit metrics.", context.hasBookValueData ? [] : ["Bank/insurance valuation inputs are incomplete."]),
        fit("relative_valuation", "good", 3, "P/E and price-to-book peer checks are useful external anchors."),
        fit("fcff_dcf", "poor", 1, "Industrial FCFF DCF is usually a poor fit for financial balance sheets."),
      ];
      break;

    case "reit":
      if (!context.hasNavData) warnings.push("REIT valuation needs NAV/AFFO, occupancy, lease duration, leverage, and rate sensitivity.");
      recommendedModels = [
        fit("nav", "primary", context.hasNavData ? 4 : 2, "REIT valuation should center on NAV/AFFO and property economics.", context.hasNavData ? [] : ["NAV/AFFO inputs are incomplete."]),
        fit("relative_valuation", "good", 3, "AFFO multiple and yield spreads can anchor valuation."),
        fit("fcff_dcf", "poor", 1, "Generic FCFF DCF is usually a poor fit for REITs."),
      ];
      break;

    case "commodity_cyclical":
      recommendedModels = [
        fit("cyclical_normalized_earnings", "primary", context.hasNormalizedCycleData ? 4 : 3, "Commodity-cycle normalization is required before valuing earnings power."),
        fit("asset_based", "good", 3, "Reserve/resource base and cost curve can provide a useful anchor."),
        fit("relative_valuation", "good", 3, "Through-cycle EV/EBITDA or FCF yield checks help avoid spot-price extrapolation."),
        fit("fcff_dcf", "partial", 2, "DCF is sensitive to commodity-price assumptions and should not extrapolate peak cycle."),
      ];
      warnings.push("Normalize commodity prices; do not extrapolate peak-cycle cash flow.");
      break;

    case "industrial_cyclical":
      recommendedModels = [
        fit("cyclical_normalized_earnings", "primary", context.hasNormalizedCycleData ? 4 : 3, "Order/backlog cycles and normalized margins should drive valuation."),
        fit("relative_valuation", "good", 3, "Through-cycle P/E or EV/EBITDA peer checks are useful."),
        fit("fcff_dcf", "partial", 2, "DCF can work only with explicit downcycle margin and working-capital stress."),
      ];
      break;

    case "hypergrowth_software":
      recommendedModels = [
        fit("reverse_dcf", "primary", 3, "Expectations analysis is central when near-term FCF is immature."),
        fit("relative_valuation", "partial", 3, "Rule-of-40 and EV/Sales/EV/FCF checks help triangulate but can be volatile."),
        fit("fcff_dcf", "partial", 2, "DCF needs long-duration margin assumptions and should have low confidence when FCF is immature."),
      ];
      break;

    case "turnaround":
      recommendedModels = [
        fit("cyclical_normalized_earnings", "primary", 2, "Turnarounds need normalized earnings power after restructuring, not current depressed results."),
        fit("asset_based", "good", 2, "Asset or liquidation value can provide a downside anchor."),
        fit("relative_valuation", "partial", 2, "Peer multiples are useful only after adjusting for distress and recovery risk."),
        fit("fcff_dcf", "partial", 1, "DCF is fragile until recovery assumptions are proven."),
      ];
      warnings.push("Avoid hard ratings when turnaround proof points are missing.");
      break;

    case "deep_value":
      recommendedModels = [
        fit("asset_based", "primary", 3, "Deep value needs balance-sheet and asset downside support."),
        fit("relative_valuation", "good", 3, "Low multiples require a value-trap check against peers."),
        fit("fcff_dcf", "partial", 2, "DCF can help only if normalized FCF is credible."),
      ];
      break;

    case "speculative_growth":
      recommendedModels = [
        fit("reverse_dcf", "primary", 2, "Use reverse DCF to expose embedded expectations, not to prove intrinsic value."),
        fit("relative_valuation", "partial", 2, "Peer multiples are noisy but can frame narrative risk."),
        fit("fcff_dcf", "poor", 1, "Classic FCFF DCF is usually weak when FCF is negative and terminal optionality dominates."),
      ];
      warnings.push("Use wide scenario ranges and low valuation confidence for speculative growth.");
      break;

    case "income":
      recommendedModels = [
        fit("fcff_dcf", "primary", 3, "Stable cash flows can support a conservative FCFF or dividend-capacity model."),
        fit("relative_valuation", "good", 3, "Yield, payout, and FCF multiple checks are useful."),
      ];
      break;

    case "unknown":
      recommendedModels = [
        fit("relative_valuation", "partial", 1, "External anchors can help when company type is unknown.", ["Peer selection may be unreliable."]),
        fit("fcff_dcf", "partial", 1, "DCF should remain low confidence until company type and core drivers are known."),
      ];
      warnings.push("Company type is unknown; avoid model-driven hard Buy/Sell conclusions.");
      break;
  }

  const primaryValuationModel = choosePrimary(recommendedModels);
  return {
    companyType,
    recommendedModels,
    primaryValuationModel,
    warnings: unique(warnings),
  };
}

export function buildModelSelection(
  input: CompanyTypeRouterInput,
  context: ModelSelectionContext = {},
): ModelSelectionOutput {
  const companyType = routeCompanyType(input);
  return selectValuationModels(companyType, { ...modelContextFromInput(input), ...context });
}
