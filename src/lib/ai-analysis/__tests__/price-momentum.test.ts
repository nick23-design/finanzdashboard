import { calculateMomentumScore, type MomentumInput } from "../price-momentum";
import type { AssetSnapshot } from "@/types/database";

function snap(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "t", symbol: "T", price: 100, currency: "USD", isin: null, description: null,
    pe_ratio: 25, market_cap: 1e12, debt_to_equity: 1, revenue_growth: 0.1,
    free_cashflow: 50e9, rsi: 55, moving_average_50: 95, moving_average_200: 85,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("calculateMomentumScore", () => {
  it("price above both MAs and moderate RSI → bullish trend", () => {
    const input: MomentumInput = { snapshot: snap({ price: 110, moving_average_50: 100, moving_average_200: 90, rsi: 58 }) };
    const result = calculateMomentumScore(input);
    expect(result.trend).toBe("bullish");
    expect(result.score).toBeGreaterThan(50);
  });

  it("price below both MAs and low RSI → bearish trend", () => {
    const input: MomentumInput = { snapshot: snap({ price: 75, moving_average_50: 95, moving_average_200: 88, rsi: 35 }) };
    const result = calculateMomentumScore(input);
    expect(result.trend).toBe("bearish");
    expect(result.score).toBeLessThan(50);
  });

  it("missing price returns neutral score and limitation", () => {
    const input: MomentumInput = { snapshot: snap({ price: null }) };
    const result = calculateMomentumScore(input);
    expect(result.score).toBe(50);
    expect(result.trend).toBe("neutral");
    expect(result.limitations.some(l => l.toLowerCase().includes("kurs"))).toBe(true);
  });

  it("priceVs50dPct is computed correctly", () => {
    const input: MomentumInput = { snapshot: snap({ price: 110, moving_average_50: 100, moving_average_200: 90 }) };
    const result = calculateMomentumScore(input);
    expect(result.priceVs50dPct).toBeCloseTo(0.10, 5);
  });

  it("priceVs200dPct is computed correctly", () => {
    const input: MomentumInput = { snapshot: snap({ price: 90, moving_average_200: 100, moving_average_50: 92 }) };
    const result = calculateMomentumScore(input);
    expect(result.priceVs200dPct).toBeCloseTo(-0.10, 5);
  });

  it("RSI > 70 adds overbought note to interpretation", () => {
    const input: MomentumInput = { snapshot: snap({ rsi: 78, price: 105, moving_average_50: 100, moving_average_200: 90 }) };
    const result = calculateMomentumScore(input);
    expect(result.interpretation.toLowerCase()).toMatch(/überkauft|overbought/i);
  });

  it("RSI < 30 adds oversold note to interpretation", () => {
    const input: MomentumInput = { snapshot: snap({ rsi: 25, price: 80, moving_average_50: 95, moving_average_200: 90 }) };
    const result = calculateMomentumScore(input);
    expect(result.interpretation.toLowerCase()).toMatch(/überverkauft|oversold/i);
  });

  it("always adds historical return limitation", () => {
    const input: MomentumInput = { snapshot: snap() };
    const result = calculateMomentumScore(input);
    expect(result.limitations.some(l => l.includes("3-") || l.includes("Renditen") || l.includes("Monate"))).toBe(true);
  });

  it("score is between 0 and 100", () => {
    const input: MomentumInput = { snapshot: snap() };
    const result = calculateMomentumScore(input);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
