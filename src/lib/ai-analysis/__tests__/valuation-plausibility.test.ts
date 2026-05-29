import type { DcfOutput } from "../dcf";
import type { ReverseDcfOutput } from "../reverse-dcf";
import {
  analyzeValuationDivergence,
  evaluateDcfPlausibility,
  evaluateReverseDcfPlausibility,
} from "../valuation-plausibility";
import type { CompanyTypeClassification } from "../company-type-router";

function companyType(primaryType: CompanyTypeClassification["primaryType"]): CompanyTypeClassification {
  return {
    primaryType,
    secondaryTypes: [],
    confidence: 4,
    rationale: "fixture",
    evidence: ["fixture"],
    limitations: [],
  };
}

function dcf(overrides: Partial<DcfOutput> = {}): DcfOutput {
  return {
    enterpriseValue: 1_000,
    equityValue: 900,
    fairValuePerShare: 100,
    upsideDownsidePct: 0,
    assumptions: {
      revenueGrowthRates: [0.1, 0.08, 0.06, 0.04, 0.03],
      operatingMarginRates: [0.2, 0.21, 0.22, 0.22, 0.22],
      taxRate: 0.21,
      wacc: 0.09,
      terminalGrowthRate: 0.025,
    },
    yearlyForecasts: [
      { year: 1, revenue: 110, operatingIncome: 22, nopat: 17.38, freeCashFlow: 14, discountFactor: 0.92, presentValueOfFcf: 12.9 },
      { year: 2, revenue: 119, operatingIncome: 25, nopat: 19.75, freeCashFlow: 16, discountFactor: 0.84, presentValueOfFcf: 13.4 },
      { year: 3, revenue: 126, operatingIncome: 28, nopat: 22.12, freeCashFlow: 18, discountFactor: 0.77, presentValueOfFcf: 13.9 },
      { year: 4, revenue: 131, operatingIncome: 29, nopat: 22.91, freeCashFlow: 19, discountFactor: 0.71, presentValueOfFcf: 13.5 },
      { year: 5, revenue: 135, operatingIncome: 30, nopat: 23.7, freeCashFlow: 20, discountFactor: 0.65, presentValueOfFcf: 13 },
    ],
    terminalValue: 1_200,
    presentValueOfTerminalValue: 700,
    limitations: [],
    ...overrides,
  };
}

function reverse(overrides: Partial<ReverseDcfOutput> = {}): ReverseDcfOutput {
  return {
    impliedGrowthRate: 0.12,
    currentPrice: 120,
    requiredFairValuePerShare: 120,
    plausibility: "medium",
    interpretation: "fixture",
    limitations: [],
    ...overrides,
  };
}

describe("evaluateDcfPlausibility", () => {
  it("flags high terminal-value share", () => {
    const result = evaluateDcfPlausibility({
      companyType: companyType("quality_compounder"),
      dcf: dcf({ enterpriseValue: 1_000, presentValueOfTerminalValue: 860 }),
      currentPrice: 100,
    });

    expect(result.fit).toBe("poor");
    expect(result.diagnostics.terminalValuePctOfEnterpriseValue).toBe(86);
    expect(result.warnings.join(" ")).toContain("85%");
  });

  it("flags DCF fair value far from current price", () => {
    const result = evaluateDcfPlausibility({
      companyType: companyType("quality_compounder"),
      dcf: dcf({ fairValuePerShare: 180 }),
      currentPrice: 100,
    });

    expect(result.fit).toBe("partial");
    expect(result.diagnostics.fairValueVsCurrentPricePct).toBe(80);
    expect(result.warnings.join(" ")).toContain("current price");
  });

  it("flags DCF fair value far from analyst consensus", () => {
    const result = evaluateDcfPlausibility({
      companyType: companyType("quality_compounder"),
      dcf: dcf({ fairValuePerShare: 100 }),
      currentPrice: 100,
      analystConsensusFairValue: 180,
    });

    expect(result.fit).toBe("good");
    expect(result.diagnostics.fairValueVsConsensusPct).toBe(-44.4);
    expect(result.warnings.join(" ")).not.toContain("analyst consensus by more than 50%");

    const largeGap = evaluateDcfPlausibility({
      companyType: companyType("quality_compounder"),
      dcf: dcf({ fairValuePerShare: 80 }),
      currentPrice: 100,
      analystConsensusFairValue: 180,
    });
    expect(largeGap.fit).toBe("partial");
    expect(largeGap.warnings.join(" ")).toContain("analyst consensus by more than 50%");
  });

  it("lowers DCF fit for platform conglomerates without segment data", () => {
    const result = evaluateDcfPlausibility({
      companyType: companyType("platform_conglomerate"),
      dcf: dcf(),
      currentPrice: 100,
      hasSegmentData: false,
    });

    expect(result.fit).toBe("partial");
    expect(result.warnings.join(" ")).toContain("segment/SOTP data is missing");
  });

  it("lowers DCF fit for cyclical hardware without stress assumptions", () => {
    const result = evaluateDcfPlausibility({
      companyType: companyType("cyclical_hardware"),
      dcf: dcf(),
      currentPrice: 100,
      hasWorkingCapitalStress: false,
      hasNormalizedMargins: true,
    });

    expect(result.fit).toBe("partial");
    expect(result.warnings.join(" ")).toContain("working-capital stress");
  });
});

describe("evaluateReverseDcfPlausibility", () => {
  it("flags directionally inconsistent implied growth", () => {
    const result = evaluateReverseDcfPlausibility({
      reverseDcf: reverse({ impliedGrowthRate: -0.04, currentPrice: 160 }),
      currentPrice: 160,
      baseDcfFairValue: 100,
      baseGrowthAssumption: 0.08,
    });

    expect(result.status).toBe("suspicious");
    expect(result.diagnostics.directionallyConsistent).toBe(false);
    expect(result.warnings.join(" ")).toContain("materially above base DCF");
  });

  it("marks impossible far-above-price negative implied growth as invalid", () => {
    const result = evaluateReverseDcfPlausibility({
      reverseDcf: reverse({ impliedGrowthRate: -0.08, currentPrice: 160 }),
      currentPrice: 160,
      baseDcfFairValue: 100,
      baseGrowthAssumption: 0.08,
    });

    expect(result.status).toBe("invalid");
  });

  it("flags solver boundary results", () => {
    const result = evaluateReverseDcfPlausibility({
      reverseDcf: reverse({
        impliedGrowthRate: 0.8,
        limitations: ["Kurs liegt über dem DCF-Wert bei maximaler Wachstumsrate. Implizite Wachstumsrate liegt oberhalb der Obergrenze."],
      }),
      currentPrice: 200,
      baseDcfFairValue: 100,
      baseGrowthAssumption: 0.08,
    });

    expect(result.status).toBe("suspicious");
    expect(result.warnings.join(" ")).toContain("boundary");
  });

  it("passes valid directionally consistent implied growth", () => {
    const result = evaluateReverseDcfPlausibility({
      reverseDcf: reverse({ impliedGrowthRate: 0.14, currentPrice: 130 }),
      currentPrice: 130,
      baseDcfFairValue: 100,
      baseGrowthAssumption: 0.08,
    });

    expect(result.status).toBe("valid");
    expect(result.confidence).toBe(4);
    expect(result.diagnostics.directionallyConsistent).toBe(true);
  });
});

describe("analyzeValuationDivergence", () => {
  it("produces high or extreme divergence for Amazon-like platform cases and lowers rating confidence", () => {
    const result = analyzeValuationDivergence({
      companyType: companyType("platform_conglomerate"),
      currentPrice: 180,
      ownModel: { bear: 120, base: 155, bull: 210 },
      dcf: { bear: 75, base: 90, bull: 130 },
      analystConsensus: { bear: 170, base: 235, bull: 300 },
      dcfPlausibility: {
        fit: "partial",
        confidence: 2,
        warnings: [],
        limitations: [],
        diagnostics: {},
      },
    });

    expect(["high", "extreme"]).toContain(result.divergenceLevel);
    expect(result.ratingImpact.lowerRatingConfidence).toBe(true);
    expect(result.warnings.join(" ")).toContain("SOTP");
  });

  it("warns that SMCI-like cyclical hardware DCF may be too optimistic", () => {
    const result = analyzeValuationDivergence({
      companyType: companyType("cyclical_hardware"),
      currentPrice: 45,
      ownModel: { bear: 20, base: 35, bull: 55 },
      dcf: { bear: 65, base: 110, bull: 180 },
      analystConsensus: { bear: 35, base: 50, bull: 75 },
      dcfPlausibility: {
        fit: "partial",
        confidence: 2,
        warnings: [],
        limitations: [],
        diagnostics: {},
      },
    });

    expect(result.divergenceLevel).toBe("extreme");
    expect(result.warnings.join(" ")).toContain("too optimistic");
    expect(result.ratingImpact.avoidHardBuySell).toBe(true);
  });

  it("keeps Apple-like quality compounder divergence from becoming automatic hard Sell logic", () => {
    const result = analyzeValuationDivergence({
      companyType: companyType("quality_compounder"),
      currentPrice: 220,
      ownModel: { bear: 140, base: 175, bull: 230 },
      dcf: { bear: 120, base: 170, bull: 245 },
      analystConsensus: { bear: 200, base: 240, bull: 285 },
      dcfPlausibility: {
        fit: "good",
        confidence: 4,
        warnings: [],
        limitations: [],
        diagnostics: {},
      },
    });

    expect(result.warnings.join(" ")).toContain("avoid automatic Sell");
    expect(result.summary).toContain("quality compounders");
  });
});
