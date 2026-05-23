import { calculateScore } from "../engine";
import type { AssetSnapshot } from "@/types/database";

function makeSnapshot(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "test-id",
    symbol: "TEST",
    price: 100,
    currency: "USD",
    isin: null,
    description: null,
    pe_ratio: 20,
    market_cap: 1_000_000_000,
    debt_to_equity: 0.4,
    revenue_growth: 0.15,
    free_cashflow: 500_000_000,
    rsi: 50,
    moving_average_50: 95,
    moving_average_200: 88,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("calculateScore", () => {
  it("returns a score between 0 and 100", () => {
    const result = calculateScore(makeSnapshot());
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it("sub-scores are between 0 and 100", () => {
    const result = calculateScore(makeSnapshot());
    expect(result.fundamentalScore).toBeGreaterThanOrEqual(0);
    expect(result.fundamentalScore).toBeLessThanOrEqual(100);
    expect(result.technicalScore).toBeGreaterThanOrEqual(0);
    expect(result.technicalScore).toBeLessThanOrEqual(100);
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it("strong fundamentals produce high fundamental score", () => {
    const result = calculateScore(
      makeSnapshot({ pe_ratio: 10, free_cashflow: 1_000_000, revenue_growth: 0.25 })
    );
    expect(result.fundamentalScore).toBeGreaterThan(70);
  });

  it("negative free cashflow lowers fundamental score", () => {
    const good = calculateScore(makeSnapshot({ free_cashflow: 1_000_000 }));
    const bad = calculateScore(makeSnapshot({ free_cashflow: -500_000 }));
    expect(good.fundamentalScore).toBeGreaterThan(bad.fundamentalScore);
  });

  it("high debt raises risk (lowers risk score)", () => {
    const low = calculateScore(makeSnapshot({ debt_to_equity: 0.3 }));
    const high = calculateScore(makeSnapshot({ debt_to_equity: 3.0 }));
    expect(low.riskScore).toBeGreaterThan(high.riskScore);
  });

  it("price above 200MA improves technical score", () => {
    const above = calculateScore(makeSnapshot({ price: 120, moving_average_200: 100 }));
    const below = calculateScore(makeSnapshot({ price: 80, moving_average_200: 100 }));
    expect(above.technicalScore).toBeGreaterThan(below.technicalScore);
  });

  it("RSI > 70 lowers technical score vs RSI ~50", () => {
    const normal = calculateScore(makeSnapshot({ rsi: 50 }));
    const overbought = calculateScore(makeSnapshot({ rsi: 80 }));
    expect(normal.technicalScore).toBeGreaterThan(overbought.technicalScore);
  });

  it("handles all-null fields without throwing", () => {
    const sparse = makeSnapshot({
      pe_ratio: null,
      free_cashflow: null,
      revenue_growth: null,
      rsi: null,
      moving_average_50: null,
      moving_average_200: null,
      debt_to_equity: null,
    });
    expect(() => calculateScore(sparse)).not.toThrow();
    const result = calculateScore(sparse);
    expect(result.totalScore).toBe(50);
  });

  it("assigns Bullish signal for score >= 80", () => {
    const result = calculateScore(
      makeSnapshot({
        pe_ratio: 8,
        free_cashflow: 10_000_000,
        revenue_growth: 0.3,
        rsi: 45,
        price: 110,
        moving_average_50: 100,
        moving_average_200: 90,
        debt_to_equity: 0.1,
      })
    );
    expect(result.signal).toBe("Bullish");
  });

  it("assigns High Risk signal for score < 20", () => {
    const result = calculateScore(
      makeSnapshot({
        pe_ratio: 200,
        free_cashflow: -50_000_000,
        revenue_growth: -0.3,
        rsi: 85,
        price: 60,
        moving_average_50: 100,
        moving_average_200: 130,
        debt_to_equity: 5.0,
      })
    );
    expect(["High Risk", "Caution"]).toContain(result.signal);
  });

  it("explanation contains symbol", () => {
    const result = calculateScore(makeSnapshot({ symbol: "AAPL" }));
    expect(result.explanation).toContain("AAPL");
  });

  it("symbol is preserved in result", () => {
    const result = calculateScore(makeSnapshot({ symbol: "TSLA" }));
    expect(result.symbol).toBe("TSLA");
  });
});
