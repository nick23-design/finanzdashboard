import { calculateAlphaFramework, type AlphaFrameworkInput } from "../alpha-framework";
import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts, AnalystData } from "@/lib/finance-client";

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

function edgar(rev: number, gp: number = rev * 0.5, ni: number = rev * 0.15): EdgarFacts {
  const q = (v: number) => Array.from({ length: 4 }, (_, i) => ({ period: `Q${i + 1}`, value: v / 4, form: "10-Q" }));
  return { cik: "1", revenue: q(rev), gross_profit: q(gp), net_income: q(ni) };
}

function analyst(overrides: Partial<AnalystData> = {}): AnalystData {
  return {
    mean_target: 120, high_target: 150, low_target: 90,
    strong_buy: 15, buy: 10, hold: 5, sell: 1, strong_sell: 0,
    rating_count: 31, source: "yahoo",
    ...overrides,
  };
}

describe("calculateAlphaFramework", () => {
  it("alphaScore is between 0 and 100", () => {
    const input: AlphaFrameworkInput = {
      snapshot: snap(),
      edgarFacts: edgar(100e9),
      analystData: analyst(),
      sectorTemplate: "saas",
    };
    const result = calculateAlphaFramework(input);
    expect(result.alphaScore).toBeGreaterThanOrEqual(0);
    expect(result.alphaScore).toBeLessThanOrEqual(100);
  });

  it("alphaGrade is a valid enum value", () => {
    const input: AlphaFrameworkInput = {
      snapshot: snap(),
      edgarFacts: edgar(100e9),
      analystData: analyst(),
      sectorTemplate: "general_quality_growth",
    };
    const result = calculateAlphaFramework(input);
    expect(["very_unattractive", "unattractive", "neutral", "attractive", "very_attractive"]).toContain(result.alphaGrade);
  });

  it("all sub-modules are present in output", () => {
    const input: AlphaFrameworkInput = {
      snapshot: snap(),
      edgarFacts: edgar(100e9),
      analystData: analyst(),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateAlphaFramework(input);
    expect(result.quality).toBeDefined();
    expect(result.moat).toBeDefined();
    expect(result.capitalAllocation).toBeDefined();
    expect(result.revisionMomentum).toBeDefined();
    expect(result.momentum).toBeDefined();
    expect(result.relativeValuation).toBeDefined();
    expect(result.risk).toBeDefined();
    expect(result.classification).toBeDefined();
    expect(result.reverseDcf).toBeDefined();
  });

  it("factorWeights sum to approximately 100", () => {
    const input: AlphaFrameworkInput = {
      snapshot: snap(),
      edgarFacts: edgar(100e9),
      analystData: null,
      sectorTemplate: "saas",
    };
    const result = calculateAlphaFramework(input);
    const total = Object.values(result.factorWeights).reduce((s, v) => s + v, 0);
    expect(total).toBeGreaterThanOrEqual(95);
    expect(total).toBeLessThanOrEqual(105);
  });

  it("high-quality compounder input → attractive or very_attractive grade", () => {
    const input: AlphaFrameworkInput = {
      snapshot: snap({
        pe_ratio: 22,
        free_cashflow: 100e9,
        market_cap: 2_000_000_000_000,
        debt_to_equity: 0.4,
        revenue_growth: 0.10,
        rsi: 58,
        moving_average_50: 195,
        moving_average_200: 175,
        price: 200,
      }),
      edgarFacts: edgar(400e9, 280e9, 100e9),
      analystData: analyst({ mean_target: 220, strong_buy: 20, buy: 8, hold: 3, sell: 0, strong_sell: 0 }),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateAlphaFramework(input);
    expect(["attractive", "very_attractive", "neutral"]).toContain(result.alphaGrade);
    expect(result.classification.primaryType).toBe("quality_compounder");
  });

  it("Apple regression: expensive high-quality stock → quality_compounder, NOT auto-sell signal", () => {
    // Apple-ähnliches Profil: DCF < Kurs (Aktie teuer), aber fundamental exzellent
    const appleInput: AlphaFrameworkInput = {
      snapshot: snap({
        symbol: "AAPL",
        price: 210,
        pe_ratio: 30,
        market_cap: 3_200_000_000_000,
        free_cashflow: 100_000_000_000,
        debt_to_equity: 1.5,
        revenue_growth: 0.06,
        rsi: 62,
        moving_average_50: 205,
        moving_average_200: 185,
      }),
      edgarFacts: edgar(383_000_000_000, 172_000_000_000, 97_000_000_000),
      analystData: analyst({ mean_target: 225, strong_buy: 18, buy: 12, hold: 6, sell: 1, strong_sell: 0 }),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateAlphaFramework(appleInput);

    // Muss quality_compounder sein — kein distressed/speculative für Apple
    expect(result.classification.primaryType).toBe("quality_compounder");

    // Alpha-Score darf nicht sehr unattraktiv sein (≥ neutral)
    expect(result.alphaScore).toBeGreaterThanOrEqual(40);
    expect(["neutral", "attractive", "very_attractive"]).toContain(result.alphaGrade);

    // Negativer DCF-Upside darf keinen distressed/speculative-Type erzeugen
    expect(["distressed", "speculative"]).not.toContain(result.classification.primaryType);

    // Qualitäts-Score muss gut oder exzellent sein
    expect(["good", "excellent"]).toContain(result.quality.grade);
  });

  it("distressed company gets very_unattractive or unattractive grade", () => {
    const input: AlphaFrameworkInput = {
      snapshot: snap({
        free_cashflow: -20e9,
        debt_to_equity: 8,
        pe_ratio: 0,
        revenue_growth: -0.20,
        rsi: 28,
        moving_average_50: 60,
        moving_average_200: 75,
        price: 50,
      }),
      edgarFacts: edgar(80e9, 8e9, -10e9),
      analystData: analyst({ mean_target: 40, strong_buy: 0, buy: 1, hold: 3, sell: 8, strong_sell: 5 }),
      sectorTemplate: "speculative_growth",
    };
    const result = calculateAlphaFramework(input);
    expect(["very_unattractive", "unattractive"]).toContain(result.alphaGrade);
  });

  it("missing all optional data → returns valid output without crashing", () => {
    const input: AlphaFrameworkInput = {
      snapshot: snap({ free_cashflow: null, pe_ratio: null, debt_to_equity: null }),
      edgarFacts: null,
      analystData: null,
      sectorTemplate: "general_quality_growth",
    };
    const result = calculateAlphaFramework(input);
    expect(result.alphaScore).toBeGreaterThanOrEqual(0);
    expect(result.alphaScore).toBeLessThanOrEqual(100);
    expect(result.reverseDcf).toBeDefined();
    expect(result.uncertaintyFlags.length).toBeGreaterThanOrEqual(0);
  });
});
