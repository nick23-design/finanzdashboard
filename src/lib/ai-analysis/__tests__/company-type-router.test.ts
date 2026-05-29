import {
  buildModelSelection,
  routeCompanyType,
  selectValuationModels,
  type CompanyTypeClassification,
  type CompanyTypeRouterInput,
} from "../company-type-router";

function appleLike(overrides: Partial<CompanyTypeRouterInput> = {}): CompanyTypeRouterInput {
  return {
    sector: "Technology",
    industry: "Consumer Electronics",
    description: "Global premium consumer devices, services ecosystem, and recurring services revenue.",
    revenueGrowth: 0.06,
    grossMargin: 0.46,
    operatingMargin: 0.31,
    fcfMargin: 0.24,
    roic: 0.35,
    debtToEquity: 1.2,
    marginVolatility: 0.03,
    stockVolatility: 0.28,
    peRatio: 31,
    freeCashFlow: 100_000_000_000,
    marketCap: 3_000_000_000_000,
    hasDurableFcf: true,
    alpha: { qualityScore: 88, moatScore: 82, riskScore: 28 },
    ...overrides,
  };
}

function amazonLike(overrides: Partial<CompanyTypeRouterInput> = {}): CompanyTypeRouterInput {
  return {
    sectorTemplate: "marketplace_platform",
    sector: "Consumer Discretionary / Technology",
    industry: "Internet retail, cloud infrastructure, advertising platform",
    description: "Marketplace, AWS cloud, advertising, subscriptions, and retail fulfillment platform.",
    revenueGrowth: 0.11,
    grossMargin: 0.48,
    operatingMargin: 0.11,
    fcfMargin: 0.06,
    roic: 0.1,
    debtToEquity: 0.8,
    marginVolatility: 0.09,
    freeCashFlow: 45_000_000_000,
    marketCap: 2_000_000_000_000,
    segmentDataAvailable: true,
    segments: [
      { name: "AWS cloud infrastructure", revenuePct: 0.16, operatingMargin: 0.32 },
      { name: "Advertising platform", revenuePct: 0.09, operatingMargin: 0.42 },
      { name: "Marketplace services", revenuePct: 0.23, operatingMargin: 0.18 },
      { name: "Online retail fulfillment", revenuePct: 0.36, operatingMargin: 0.03 },
    ],
    alpha: { qualityScore: 73, moatScore: 80, riskScore: 45 },
    ...overrides,
  };
}

function smciLike(overrides: Partial<CompanyTypeRouterInput> = {}): CompanyTypeRouterInput {
  return {
    sector: "Technology",
    industry: "Computer hardware, AI server infrastructure, manufacturing equipment",
    description: "AI server and rack-scale infrastructure supplier with working-capital and inventory sensitivity.",
    revenueGrowth: 0.72,
    grossMargin: 0.14,
    operatingMargin: 0.08,
    fcfMargin: -0.07,
    roic: 0.08,
    debtToEquity: 1.9,
    marginVolatility: 0.13,
    revenueCyclicality: 0.32,
    stockVolatility: 0.78,
    peRatio: 18,
    freeCashFlow: -900_000_000,
    marketCap: 28_000_000_000,
    workingCapitalRisk: true,
    inventoryRisk: true,
    complianceRisk: true,
    alpha: { qualityScore: 42, moatScore: 35, riskScore: 72 },
    ...overrides,
  };
}

function classification(primaryType: CompanyTypeClassification["primaryType"]): CompanyTypeClassification {
  return {
    primaryType,
    secondaryTypes: [],
    confidence: 4,
    rationale: "test",
    evidence: ["test evidence"],
    limitations: [],
  };
}

describe("routeCompanyType", () => {
  it("classifies Apple-like profiles as quality compounders without ticker hardcoding", () => {
    const result = routeCompanyType(appleLike());

    expect(result.primaryType).toBe("quality_compounder");
    expect(result.confidence).toBeGreaterThanOrEqual(4);
    expect(result.evidence.join(" ")).toContain("Free cash flow");
  });

  it("classifies Amazon-like mixed-segment profiles as platform conglomerates", () => {
    const result = routeCompanyType(amazonLike());

    expect(result.primaryType).toBe("platform_conglomerate");
    expect(result.confidence).toBeGreaterThanOrEqual(4);
    expect(result.evidence.some(item => item.includes("segments") || item.includes("Segment"))).toBe(true);
  });

  it("classifies SMCI-like hardware/cycle profiles as cyclical hardware", () => {
    const result = routeCompanyType(smciLike());

    expect(result.primaryType).toBe("cyclical_hardware");
    expect(result.secondaryTypes).toContain("speculative_growth");
    expect(result.evidence.join(" ")).toContain("Working-capital");
  });

  it("returns unknown with limitations when structured data is insufficient", () => {
    const result = routeCompanyType({ revenueGrowth: 0.08 });

    expect(result.primaryType).toBe("unknown");
    expect(result.confidence).toBe(1);
    expect(result.limitations.length).toBeGreaterThan(0);
  });
});

describe("selectValuationModels", () => {
  it("recommends SOTP as primary for platform conglomerates", () => {
    const result = buildModelSelection(amazonLike());

    expect(result.primaryValuationModel.model).toBe("sotp");
    expect(result.primaryValuationModel.fit).toBe("primary");
    expect(result.recommendedModels.find(model => model.model === "fcff_dcf")?.fit).toBe("partial");
  });

  it("marks FCFF DCF as partial for cyclical hardware", () => {
    const result = buildModelSelection(smciLike());

    expect(result.primaryValuationModel.model).toBe("cyclical_normalized_earnings");
    expect(result.recommendedModels.find(model => model.model === "fcff_dcf")?.fit).toBe("partial");
    expect(result.warnings.join(" ")).toContain("Cyclical hardware");
  });

  it("marks FCFF DCF as poor for financials", () => {
    const result = selectValuationModels(classification("financial"), { hasBookValueData: true });

    expect(result.primaryValuationModel.model).toBe("bank_valuation");
    expect(result.recommendedModels.find(model => model.model === "fcff_dcf")?.fit).toBe("poor");
  });

  it("uses NAV as primary for REITs", () => {
    const result = selectValuationModels(classification("reit"), { hasNavData: true });

    expect(result.primaryValuationModel.model).toBe("nav");
    expect(result.recommendedModels.find(model => model.model === "fcff_dcf")?.fit).toBe("poor");
  });

  it("warns when platform SOTP is preferred but segment data is missing", () => {
    const result = buildModelSelection(amazonLike({ segmentDataAvailable: false, segments: null }));

    expect(result.primaryValuationModel.model).toBe("sotp");
    expect(result.primaryValuationModel.limitations.join(" ")).toContain("segment data");
    expect(result.warnings.join(" ")).toContain("segment data is missing");
  });
});
