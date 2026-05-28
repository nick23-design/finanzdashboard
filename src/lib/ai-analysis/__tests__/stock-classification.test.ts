import { classifyStock, type ClassificationInput } from "../stock-classification";
import type { AssetSnapshot } from "@/types/database";
import type { QualityScore } from "../quality-score";
import type { MoatScore } from "../moat-score";
import type { RelativeValuationScore } from "../relative-valuation";
import type { RiskScore } from "../risk-score";
import type { RevisionMomentumScore } from "../revision-momentum";

function snap(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "t", symbol: "T", price: 100, currency: "USD", isin: null, description: null,
    pe_ratio: 20, market_cap: 500_000_000_000, debt_to_equity: 1.0,
    revenue_growth: 0.10, free_cashflow: 25_000_000_000,
    rsi: 55, moving_average_50: 98, moving_average_200: 90,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeQuality(score: number, strengths: string[] = [], weaknesses: string[] = []): QualityScore {
  return {
    score, grade: score >= 70 ? "excellent" : score >= 55 ? "good" : score >= 40 ? "average" : "weak",
    components: { profitability: score, marginQuality: score, cashConversion: score, balanceSheet: score, stability: score },
    strengths, weaknesses, limitations: [],
  };
}

function makeMoat(score: number, drivers: string[] = [], risks: string[] = []): MoatScore {
  return {
    score,
    grade: score >= 70 ? "wide" : score >= 55 ? "moderate" : "narrow",
    evidence: [],
    drivers,
    risks,
    limitations: [],
  };
}

function makeRelVal(score: number): RelativeValuationScore {
  return {
    score,
    valuationState: score >= 60 ? "cheap" : score >= 40 ? "fair" : "expensive",
    metrics: {}, comparisons: {}, limitations: [],
  };
}

function makeRisk(score: number, cyclicality: number = 35, businessRisk: number = 30): RiskScore {
  return {
    score, level: score >= 60 ? "high" : score >= 45 ? "elevated" : "moderate",
    components: { valuationRisk: score, balanceSheetRisk: score, businessRisk, cyclicalityRisk: cyclicality, dataQualityRisk: 20 },
    keyRisks: [], mitigants: [], limitations: [],
  };
}

function makeRevision(score: number, direction: "positive" | "neutral" | "negative" = "neutral"): RevisionMomentumScore {
  return {
    score,
    direction,
    upwardRevisions: score > 50 ? 10 : 2,
    downwardRevisions: score > 50 ? 2 : 8,
    interpretation: "",
    limitations: [],
  };
}

function buildInput(
  snapOverrides: Partial<AssetSnapshot> = {},
  qualityScore: number = 70,
  moatScore: number = 65,
  rvScore: number = 50,
  riskScore: number = 30,
  revScore: number = 55,
  revDir: "positive" | "neutral" | "negative" = "neutral",
  sectorTemplate: ClassificationInput["sectorTemplate"] = "general_quality_growth",
): ClassificationInput {
  return {
    snapshot: snap(snapOverrides),
    sectorTemplate,
    quality: makeQuality(qualityScore),
    moat: makeMoat(moatScore),
    relativeValuation: makeRelVal(rvScore),
    risk: makeRisk(riskScore),
    revision: makeRevision(revScore, revDir),
  };
}

describe("classifyStock", () => {
  it("returns valid primaryType", () => {
    const result = classifyStock(buildInput());
    const validTypes = ["quality_compounder", "growth", "value", "deep_value", "cyclical", "turnaround", "speculative", "income", "momentum", "distressed"];
    expect(validTypes).toContain(result.primaryType);
  });

  it("confidence is 1-5", () => {
    const result = classifyStock(buildInput());
    expect([1, 2, 3, 4, 5]).toContain(result.confidence);
  });

  it("high quality + high moat + positive FCF → quality_compounder", () => {
    const input = buildInput(
      { free_cashflow: 50e9, revenue_growth: 0.08 },
      80, 75, 50, 25, 55, "neutral", "mega_cap_cloud_software",
    );
    const result = classifyStock(input);
    expect(result.primaryType).toBe("quality_compounder");
  });

  it("very high revenue growth + decent quality → growth classification", () => {
    const input = buildInput(
      { free_cashflow: 5e9, revenue_growth: 0.35 },
      50, 45, 45, 40, 55, "positive", "saas",
    );
    const result = classifyStock(input);
    expect(["growth", "speculative"]).toContain(result.primaryType);
  });

  it("cyclical sector → cyclical primaryType or secondary", () => {
    const input = buildInput(
      { free_cashflow: 10e9, revenue_growth: 0.03 },
      45, 40, 55, 55, 50, "neutral", "energy",
    );
    const result = classifyStock(input);
    const allTypes = [result.primaryType, ...result.secondaryTypes];
    expect(allTypes.some(t => t === "cyclical" || t === "speculative" || t === "value")).toBe(true);
  });

  it("very low quality + negative FCF + high risk → distressed or speculative", () => {
    const input: ClassificationInput = {
      snapshot: snap({ free_cashflow: -5e9, revenue_growth: -0.10, debt_to_equity: 8 }),
      sectorTemplate: "speculative_growth",
      quality: makeQuality(18),
      moat: makeMoat(15),
      relativeValuation: makeRelVal(30),
      risk: makeRisk(75, 50, 80),
      revision: makeRevision(30, "negative"),
    };
    const result = classifyStock(input);
    expect(["distressed", "speculative"]).toContain(result.primaryType);
  });

  it("rationale is a non-empty string", () => {
    const result = classifyStock(buildInput());
    expect(typeof result.rationale).toBe("string");
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("secondaryTypes contains no duplicates", () => {
    const result = classifyStock(buildInput());
    const unique = new Set(result.secondaryTypes);
    expect(unique.size).toBe(result.secondaryTypes.length);
  });
});
