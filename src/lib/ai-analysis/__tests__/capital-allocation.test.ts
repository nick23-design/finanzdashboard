import { calculateCapitalAllocationScore, type CapAllocationInput } from "../capital-allocation";
import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";

function snap(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "t", symbol: "T", price: 100, currency: "USD", isin: null, description: null,
    pe_ratio: 20, market_cap: 500_000_000_000, debt_to_equity: 1.0,
    revenue_growth: 0.10, free_cashflow: 30_000_000_000,
    rsi: 50, moving_average_50: 98, moving_average_200: 90,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function edgar(rev: number): EdgarFacts {
  const q = (v: number) => Array.from({ length: 4 }, (_, i) => ({ period: `Q${i}`, value: v / 4, form: "10-Q" }));
  return { cik: "1", revenue: q(rev), gross_profit: [], net_income: [] };
}

describe("calculateCapitalAllocationScore", () => {
  it("returns score 0-100 and valid grade", () => {
    const result = calculateCapitalAllocationScore({
      snapshot: snap(),
      edgarFacts: edgar(200e9),
      sectorTemplate: "mega_cap_cloud_software",
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(["poor", "weak", "average", "good", "excellent"]).toContain(result.grade);
  });

  it("high FCF margin improves score", () => {
    const highFcf: CapAllocationInput = {
      snapshot: snap({ free_cashflow: 50e9 }),
      edgarFacts: edgar(200e9),
      sectorTemplate: "saas",
    };
    const lowFcf: CapAllocationInput = {
      snapshot: snap({ free_cashflow: 2e9 }),
      edgarFacts: edgar(200e9),
      sectorTemplate: "saas",
    };
    const h = calculateCapitalAllocationScore(highFcf);
    const l = calculateCapitalAllocationScore(lowFcf);
    expect(h.score).toBeGreaterThan(l.score);
  });

  it("negative FCF produces low score and weakness entry", () => {
    const result = calculateCapitalAllocationScore({
      snapshot: snap({ free_cashflow: -10e9, debt_to_equity: 3 }),
      edgarFacts: edgar(100e9),
      sectorTemplate: "speculative_growth",
    });
    expect(result.score).toBeLessThan(50);
    expect(result.weaknesses.some(w => w.toLowerCase().includes("negativ") || w.toLowerCase().includes("kapital"))).toBe(true);
  });

  it("low D/E adds strength entry", () => {
    const result = calculateCapitalAllocationScore({
      snapshot: snap({ debt_to_equity: 0.2 }),
      edgarFacts: edgar(100e9),
      sectorTemplate: "consumer_brand",
    });
    expect(result.strengths.some(s => s.toLowerCase().includes("bilanz") || s.toLowerCase().includes("verschuldung"))).toBe(true);
  });

  it("high D/E adds weakness entry", () => {
    const result = calculateCapitalAllocationScore({
      snapshot: snap({ debt_to_equity: 5 }),
      edgarFacts: edgar(100e9),
      sectorTemplate: "automotive",
    });
    expect(result.weaknesses.some(w => w.includes("D/E") || w.toLowerCase().includes("verschuldung"))).toBe(true);
  });

  it("always adds buyback limitation (no historical share count)", () => {
    const result = calculateCapitalAllocationScore({
      snapshot: snap(),
      edgarFacts: edgar(100e9),
      sectorTemplate: "mega_cap_cloud_software",
    });
    const hasBuybackLimitation = result.limitations.some(l => l.toLowerCase().includes("rückkauf") || l.toLowerCase().includes("buyback") || l.toLowerCase().includes("share count"));
    expect(hasBuybackLimitation).toBe(true);
  });

  it("roicVsWaccSpread is positive when FCF is high relative to invested capital", () => {
    const result = calculateCapitalAllocationScore({
      snapshot: snap({ free_cashflow: 80e9, market_cap: 500e9, debt_to_equity: 0.3 }),
      edgarFacts: edgar(300e9),
      sectorTemplate: "mega_cap_cloud_software",
    });
    expect(result.roicVsWaccSpread).toBeDefined();
    if (result.roicVsWaccSpread !== undefined) {
      expect(result.roicVsWaccSpread).toBeGreaterThan(0);
    }
  });

  it("missing FCF adds limitation", () => {
    const result = calculateCapitalAllocationScore({
      snapshot: snap({ free_cashflow: null }),
      edgarFacts: null,
      sectorTemplate: "general_quality_growth",
    });
    expect(result.limitations.some(l => l.toLowerCase().includes("fcf") || l.toLowerCase().includes("cashflow"))).toBe(true);
  });
});
