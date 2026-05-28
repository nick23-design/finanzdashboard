import { calculateQualityScore, type QualityScoreInput } from "../quality-score";
import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";

function makeSnapshot(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "test", symbol: "TEST", price: 100, currency: "USD",
    isin: null, description: null,
    pe_ratio: 25, market_cap: 2_000_000_000_000, debt_to_equity: 0.8,
    revenue_growth: 0.08, free_cashflow: 100_000_000_000,
    rsi: 55, moving_average_50: 95, moving_average_200: 88,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeEdgarFacts(overrides: Partial<{ rev: number; gp: number; ni: number }> = {}): EdgarFacts {
  const rev = overrides.rev ?? 100_000_000_000;
  const gp = overrides.gp ?? 45_000_000_000;
  const ni = overrides.ni ?? 25_000_000_000;
  const q = (v: number) => [
    { period: "Q4", value: v / 4, form: "10-Q" },
    { period: "Q3", value: v / 4, form: "10-Q" },
    { period: "Q2", value: v / 4, form: "10-Q" },
    { period: "Q1", value: v / 4, form: "10-Q" },
  ];
  return { cik: "0001", revenue: q(rev), gross_profit: q(gp), net_income: q(ni) };
}

describe("calculateQualityScore", () => {
  it("returns a score between 0 and 100", () => {
    const input: QualityScoreInput = {
      snapshot: makeSnapshot(),
      edgarFacts: makeEdgarFacts(),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateQualityScore(input);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("high ROIC/margins/FCF produces 'good' or 'excellent' grade", () => {
    const input: QualityScoreInput = {
      snapshot: makeSnapshot({ free_cashflow: 120_000_000_000, debt_to_equity: 0.3, revenue_growth: 0.15 }),
      edgarFacts: makeEdgarFacts({ rev: 400_000_000_000, gp: 280_000_000_000, ni: 100_000_000_000 }),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateQualityScore(input);
    expect(["good", "excellent"]).toContain(result.grade);
    expect(result.score).toBeGreaterThan(55);
  });

  it("weak margins and negative FCF produces 'poor' or 'weak' grade", () => {
    const input: QualityScoreInput = {
      snapshot: makeSnapshot({ free_cashflow: -5_000_000_000, debt_to_equity: 4.5, revenue_growth: -0.05 }),
      edgarFacts: makeEdgarFacts({ rev: 50_000_000_000, gp: 5_000_000_000, ni: -3_000_000_000 }),
      sectorTemplate: "speculative_growth",
    };
    const result = calculateQualityScore(input);
    expect(["poor", "weak"]).toContain(result.grade);
    expect(result.score).toBeLessThan(45);
  });

  it("missing EDGAR data lowers confidence and adds limitations", () => {
    const input: QualityScoreInput = {
      snapshot: makeSnapshot(),
      edgarFacts: null,
      sectorTemplate: "general_quality_growth",
    };
    const result = calculateQualityScore(input);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("missing D/E adds balance sheet limitation", () => {
    const input: QualityScoreInput = {
      snapshot: makeSnapshot({ debt_to_equity: null }),
      edgarFacts: makeEdgarFacts(),
      sectorTemplate: "saas",
    };
    const result = calculateQualityScore(input);
    const hasBsLimitation = result.limitations.some(l => l.toLowerCase().includes("bilanz") || l.toLowerCase().includes("debt"));
    expect(hasBsLimitation).toBe(true);
  });

  it("very high gross margin produces strengths array entry", () => {
    const input: QualityScoreInput = {
      snapshot: makeSnapshot({ revenue_growth: 0.20 }),
      edgarFacts: makeEdgarFacts({ rev: 100_000_000_000, gp: 80_000_000_000, ni: 30_000_000_000 }),
      sectorTemplate: "saas",
    };
    const result = calculateQualityScore(input);
    expect(result.strengths.some(s => s.includes("Marge") || s.includes("margin") || s.includes("Brutto"))).toBe(true);
  });

  it("high D/E ratio adds weakness entry", () => {
    const input: QualityScoreInput = {
      snapshot: makeSnapshot({ debt_to_equity: 5.0 }),
      edgarFacts: makeEdgarFacts(),
      sectorTemplate: "automotive",
    };
    const result = calculateQualityScore(input);
    expect(result.weaknesses.some(w => w.toLowerCase().includes("verschuldung") || w.toLowerCase().includes("schuld"))).toBe(true);
  });

  it("Apple-like profile gets 'good' or 'excellent' grade", () => {
    const input: QualityScoreInput = {
      snapshot: makeSnapshot({
        free_cashflow: 100_000_000_000,
        debt_to_equity: 1.5,
        revenue_growth: 0.06,
      }),
      edgarFacts: makeEdgarFacts({ rev: 383_000_000_000, gp: 172_000_000_000, ni: 97_000_000_000 }),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateQualityScore(input);
    expect(["good", "excellent"]).toContain(result.grade);
  });

  it("all components are within 0-100", () => {
    const input: QualityScoreInput = {
      snapshot: makeSnapshot(),
      edgarFacts: makeEdgarFacts(),
      sectorTemplate: "consumer_brand",
    };
    const result = calculateQualityScore(input);
    for (const v of Object.values(result.components)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
