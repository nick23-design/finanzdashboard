import { calculateMoatScore, type MoatScoreInput } from "../moat-score";
import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";

function snap(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "t", symbol: "T", price: 100, currency: "USD", isin: null, description: null,
    pe_ratio: 20, market_cap: 1_000_000_000_000, debt_to_equity: 0.5,
    revenue_growth: 0.10, free_cashflow: 50_000_000_000,
    rsi: 55, moving_average_50: 98, moving_average_200: 90,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function edgar(rev: number, gp: number): EdgarFacts {
  const q = (v: number) => Array.from({ length: 4 }, (_, i) => ({ period: `Q${4 - i}`, value: v / 4, form: "10-Q" }));
  return { cik: "1", revenue: q(rev), gross_profit: q(gp), net_income: [] };
}

describe("calculateMoatScore", () => {
  it("returns score 0-100 and valid grade", () => {
    const input: MoatScoreInput = {
      snapshot: snap(),
      edgarFacts: edgar(100e9, 70e9),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateMoatScore(input);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(["none", "narrow", "moderate", "wide", "exceptional"]).toContain(result.grade);
  });

  it("stable high gross margin → wide or exceptional moat", () => {
    // 75% gross margin = strong pricing power
    const input: MoatScoreInput = {
      snapshot: snap({ free_cashflow: 200e9, revenue_growth: 0.15 }),
      edgarFacts: edgar(400e9, 300e9),
      sectorTemplate: "saas",
    };
    const result = calculateMoatScore(input);
    expect(["wide", "exceptional"]).toContain(result.grade);
  });

  it("low gross margin → at most moderate moat", () => {
    // 8% gross margin = little pricing power, so at most moderate
    const input: MoatScoreInput = {
      snapshot: snap({ free_cashflow: 2e9, revenue_growth: 0.02 }),
      edgarFacts: edgar(100e9, 8e9),
      sectorTemplate: "automotive",
    };
    const result = calculateMoatScore(input);
    expect(["none", "narrow", "moderate"]).toContain(result.grade);
    expect(result.score).toBeLessThan(60);
  });

  it("missing EDGAR data adds limitations and doesn't crash", () => {
    const input: MoatScoreInput = {
      snapshot: snap(),
      edgarFacts: null,
      sectorTemplate: "general_quality_growth",
    };
    const result = calculateMoatScore(input);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("always includes qualitative moat limitation", () => {
    const input: MoatScoreInput = {
      snapshot: snap(),
      edgarFacts: edgar(100e9, 60e9),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateMoatScore(input);
    expect(result.limitations.some(l => l.toLowerCase().includes("qualitative") || l.toLowerCase().includes("netzwerk"))).toBe(true);
  });

  it("negative FCF reduces moat score", () => {
    const highMarginFcfPos: MoatScoreInput = {
      snapshot: snap({ free_cashflow: 50e9 }),
      edgarFacts: edgar(100e9, 70e9),
      sectorTemplate: "saas",
    };
    const highMarginFcfNeg: MoatScoreInput = {
      snapshot: snap({ free_cashflow: -5e9 }),
      edgarFacts: edgar(100e9, 70e9),
      sectorTemplate: "saas",
    };
    const posResult = calculateMoatScore(highMarginFcfPos);
    const negResult = calculateMoatScore(highMarginFcfNeg);
    expect(posResult.score).toBeGreaterThan(negResult.score);
  });

  it("consistent high margin produces evidence entries", () => {
    const input: MoatScoreInput = {
      snapshot: snap({ free_cashflow: 100e9, revenue_growth: 0.12 }),
      edgarFacts: edgar(300e9, 225e9),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateMoatScore(input);
    expect(result.evidence.length + result.drivers.length).toBeGreaterThan(0);
  });
});
