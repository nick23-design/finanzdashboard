import { calculateRelativeValuation, type RelativeValuationInput } from "../relative-valuation";
import type { AssetSnapshot } from "@/types/database";
import type { AnalystData } from "@/lib/finance-client";

function snap(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "t", symbol: "T", price: 100, currency: "USD", isin: null, description: null,
    pe_ratio: 20, market_cap: 500_000_000_000, debt_to_equity: 1,
    revenue_growth: 0.10, free_cashflow: 20_000_000_000,
    rsi: 55, moving_average_50: 98, moving_average_200: 90,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function analyst(overrides: Partial<AnalystData> = {}): AnalystData {
  return {
    mean_target: 120, high_target: 150, low_target: 90,
    strong_buy: 10, buy: 8, hold: 5, sell: 1, strong_sell: 0,
    rating_count: 24, source: "yahoo",
    ...overrides,
  };
}

describe("calculateRelativeValuation", () => {
  it("score is between 0 and 100", () => {
    const input: RelativeValuationInput = { snapshot: snap(), analystData: analyst(), sectorTemplate: "saas" };
    const result = calculateRelativeValuation(input);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("valid valuationState returned", () => {
    const input: RelativeValuationInput = { snapshot: snap(), analystData: analyst(), sectorTemplate: "mega_cap_cloud_software" };
    const result = calculateRelativeValuation(input);
    expect(["very_expensive", "expensive", "fair", "cheap", "very_cheap"]).toContain(result.valuationState);
  });

  it("low PE relative to sector → cheaper (higher score)", () => {
    const cheapInput: RelativeValuationInput = {
      snapshot: snap({ pe_ratio: 10 }),
      analystData: analyst(),
      sectorTemplate: "saas",
    };
    const expensiveInput: RelativeValuationInput = {
      snapshot: snap({ pe_ratio: 80 }),
      analystData: analyst(),
      sectorTemplate: "saas",
    };
    const cheap = calculateRelativeValuation(cheapInput);
    const expensive = calculateRelativeValuation(expensiveInput);
    expect(cheap.score).toBeGreaterThan(expensive.score);
  });

  it("high FCF yield → higher valuation score", () => {
    const highYield: RelativeValuationInput = {
      snapshot: snap({ free_cashflow: 40_000_000_000, market_cap: 400_000_000_000 }),
      analystData: null,
      sectorTemplate: "general_quality_growth",
    };
    const lowYield: RelativeValuationInput = {
      snapshot: snap({ free_cashflow: 1_000_000_000, market_cap: 400_000_000_000 }),
      analystData: null,
      sectorTemplate: "general_quality_growth",
    };
    const h = calculateRelativeValuation(highYield);
    const l = calculateRelativeValuation(lowYield);
    expect(h.score).toBeGreaterThan(l.score);
  });

  it("positive analyst upside improves score", () => {
    const withUpside: RelativeValuationInput = {
      snapshot: snap({ price: 100 }),
      analystData: analyst({ mean_target: 140 }),
      sectorTemplate: "general_quality_growth",
    };
    const withDownside: RelativeValuationInput = {
      snapshot: snap({ price: 100 }),
      analystData: analyst({ mean_target: 75 }),
      sectorTemplate: "general_quality_growth",
    };
    const up = calculateRelativeValuation(withUpside);
    const down = calculateRelativeValuation(withDownside);
    expect(up.score).toBeGreaterThan(down.score);
  });

  it("missing analyst data adds limitation", () => {
    const input: RelativeValuationInput = {
      snapshot: snap(),
      analystData: null,
      sectorTemplate: "saas",
    };
    const result = calculateRelativeValuation(input);
    expect(result.limitations.some(l => l.toLowerCase().includes("kursziel") || l.toLowerCase().includes("analyst"))).toBe(true);
  });

  it("always adds EV/EBITDA limitation", () => {
    const input: RelativeValuationInput = { snapshot: snap(), analystData: analyst(), sectorTemplate: "saas" };
    const result = calculateRelativeValuation(input);
    expect(result.limitations.some(l => l.toLowerCase().includes("ev") || l.toLowerCase().includes("ebitda"))).toBe(true);
  });

  it("metrics.fcfYield is computed when FCF and market_cap are available", () => {
    const input: RelativeValuationInput = {
      snapshot: snap({ free_cashflow: 20_000_000_000, market_cap: 400_000_000_000 }),
      analystData: null,
      sectorTemplate: "saas",
    };
    const result = calculateRelativeValuation(input);
    expect(result.metrics.fcfYield).toBeCloseTo(0.05, 4);
  });
});
