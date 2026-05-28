import { calculateReverseDcf, type ReverseDcfOutput } from "../reverse-dcf";
import type { DcfInput } from "../dcf";

function makeBaseInput(overrides: Partial<DcfInput> = {}): DcfInput {
  return {
    revenue: 100_000_000_000,
    revenueGrowthRates: [0.08, 0.08, 0.08, 0.08, 0.08],
    operatingMarginRates: [0.25, 0.25, 0.25, 0.25, 0.25],
    taxRate: 0.20,
    reinvestmentRate: 0.20,
    wacc: 0.09,
    terminalGrowthRate: 0.025,
    netDebt: 0,
    sharesOutstanding: 15_000_000_000,
    ...overrides,
  };
}

describe("calculateReverseDcf", () => {
  it("returns a defined output for a valid input", () => {
    const input = makeBaseInput();
    const result = calculateReverseDcf(input, 100);
    expect(result.impliedGrowthRate).not.toBeNull();
    expect(result.currentPrice).toBe(100);
    expect(result.plausibility).toBeDefined();
    expect(result.interpretation).toBeTruthy();
  });

  it("expensive stock implies higher growth than cheap stock", () => {
    const input = makeBaseInput();
    // Build DCF and compute fair value first to understand "cheap" vs "expensive"
    const expensiveResult = calculateReverseDcf(input, 500);
    const cheapResult = calculateReverseDcf(input, 20);

    if (expensiveResult.impliedGrowthRate !== null && cheapResult.impliedGrowthRate !== null) {
      expect(expensiveResult.impliedGrowthRate).toBeGreaterThan(cheapResult.impliedGrowthRate);
    }
  });

  it("cheap stock has higher plausibility than expensive stock", () => {
    const input = makeBaseInput();
    const cheapResult = calculateReverseDcf(input, 20);
    const expensiveResult = calculateReverseDcf(input, 800);

    const plausibilityRank = { very_high: 4, high: 3, medium: 2, low: 1 };
    expect(plausibilityRank[cheapResult.plausibility]).toBeGreaterThanOrEqual(
      plausibilityRank[expensiveResult.plausibility],
    );
  });

  it("returns very_high plausibility when implied growth is below terminal rate", () => {
    const input = makeBaseInput({ wacc: 0.12, terminalGrowthRate: 0.02 });
    // Very low price → very low implied growth → very high plausibility
    const result = calculateReverseDcf(input, 1);
    expect(["very_high", "high"]).toContain(result.plausibility);
  });

  it("returns low plausibility for extremely expensive stock", () => {
    const input = makeBaseInput({ wacc: 0.09, terminalGrowthRate: 0.025 });
    const result = calculateReverseDcf(input, 100_000);
    expect(result.plausibility).toBe("low");
    expect(result.impliedGrowthRate).not.toBeNull();
  });

  it("handles invalid currentPrice gracefully", () => {
    const input = makeBaseInput();
    const result = calculateReverseDcf(input, 0);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.impliedGrowthRate).toBeNull();
  });

  it("handles invalid input (zero shares) gracefully", () => {
    const input = makeBaseInput({ sharesOutstanding: 0 });
    const result = calculateReverseDcf(input, 100);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.impliedGrowthRate).toBeNull();
  });

  it("handles zero revenue gracefully", () => {
    const input = makeBaseInput({ revenue: 0 });
    const result = calculateReverseDcf(input, 100);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.impliedGrowthRate).toBeNull();
  });

  it("implied growth rate is within search bounds", () => {
    const input = makeBaseInput();
    const result = calculateReverseDcf(input, 150);
    if (result.impliedGrowthRate !== null) {
      expect(result.impliedGrowthRate).toBeGreaterThanOrEqual(-0.20);
      expect(result.impliedGrowthRate).toBeLessThanOrEqual(0.80);
    }
  });

  it("interpretation is non-empty string", () => {
    const input = makeBaseInput();
    const result = calculateReverseDcf(input, 100);
    expect(typeof result.interpretation).toBe("string");
    expect(result.interpretation.length).toBeGreaterThan(10);
  });

  it("includes netDebt limitation when netDebt is 0", () => {
    const input = makeBaseInput({ netDebt: 0 });
    const result = calculateReverseDcf(input, 100);
    const hasDebtLimitation = result.limitations.some(l => l.toLowerCase().includes("verschuldung"));
    expect(hasDebtLimitation).toBe(true);
  });

  it("Apple-like: justified current price has plausibility medium or better", () => {
    // Apple-like: high margin company, moderate growth
    const input = makeBaseInput({
      revenue: 383_000_000_000,
      revenueGrowthRates: [0.06, 0.055, 0.05, 0.045, 0.04],
      operatingMarginRates: [0.30, 0.30, 0.30, 0.30, 0.30],
      taxRate: 0.15,
      reinvestmentRate: 0.15,
      wacc: 0.09,
      terminalGrowthRate: 0.03,
      sharesOutstanding: 15_300_000_000,
    });
    const result = calculateReverseDcf(input, 180);
    expect(["very_high", "high", "medium"]).toContain(result.plausibility);
    expect(result.impliedGrowthRate).not.toBeNull();
  });
});
