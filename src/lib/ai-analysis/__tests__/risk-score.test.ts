import { calculateRiskScore, type RiskScoreInput } from "../risk-score";
import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";

function snap(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "t", symbol: "T", price: 100, currency: "USD", isin: null, description: null,
    pe_ratio: 20, market_cap: 500_000_000_000, debt_to_equity: 1.0,
    revenue_growth: 0.08, free_cashflow: 20_000_000_000,
    rsi: 55, moving_average_50: 98, moving_average_200: 90,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function edgar(rev: number, ni: number = rev * 0.15): EdgarFacts {
  const q = (v: number) => Array.from({ length: 4 }, (_, i) => ({ period: `Q${i}`, value: v / 4, form: "10-Q" }));
  return { cik: "1", revenue: q(rev), gross_profit: q(rev * 0.5), net_income: q(ni) };
}

describe("calculateRiskScore", () => {
  it("score is between 0 and 100", () => {
    const input: RiskScoreInput = { snapshot: snap(), edgarFacts: edgar(100e9), sectorTemplate: "saas" };
    const result = calculateRiskScore(input);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("valid risk level returned", () => {
    const input: RiskScoreInput = { snapshot: snap(), edgarFacts: edgar(100e9), sectorTemplate: "saas" };
    const result = calculateRiskScore(input);
    expect(["low", "moderate", "elevated", "high", "severe"]).toContain(result.level);
  });

  it("solid company has lower risk than distressed one", () => {
    const solidInput: RiskScoreInput = {
      snapshot: snap({ debt_to_equity: 0.3, free_cashflow: 30e9, pe_ratio: 18, revenue_growth: 0.12 }),
      edgarFacts: edgar(100e9, 20e9),
      sectorTemplate: "saas",
    };
    const distressedInput: RiskScoreInput = {
      snapshot: snap({ debt_to_equity: 6, free_cashflow: -10e9, pe_ratio: 0, revenue_growth: -0.15 }),
      edgarFacts: edgar(50e9, -8e9),
      sectorTemplate: "speculative_growth",
    };
    const solid = calculateRiskScore(solidInput);
    const distressed = calculateRiskScore(distressedInput);
    expect(solid.score).toBeLessThan(distressed.score);
  });

  it("high D/E raises balance sheet risk", () => {
    const lowDebt: RiskScoreInput = { snapshot: snap({ debt_to_equity: 0.2 }), edgarFacts: null, sectorTemplate: "general_quality_growth" };
    const highDebt: RiskScoreInput = { snapshot: snap({ debt_to_equity: 5 }), edgarFacts: null, sectorTemplate: "general_quality_growth" };
    const l = calculateRiskScore(lowDebt);
    const h = calculateRiskScore(highDebt);
    expect(h.components.balanceSheetRisk).toBeGreaterThan(l.components.balanceSheetRisk);
  });

  it("cyclical sector has higher cyclicalityRisk component", () => {
    const saasSInput: RiskScoreInput = { snapshot: snap(), edgarFacts: null, sectorTemplate: "saas" };
    const energyInput: RiskScoreInput = { snapshot: snap(), edgarFacts: null, sectorTemplate: "energy" };
    const saas = calculateRiskScore(saasSInput);
    const energy = calculateRiskScore(energyInput);
    expect(energy.components.cyclicalityRisk).toBeGreaterThan(saas.components.cyclicalityRisk);
  });

  it("negative FCF adds key risk entry", () => {
    const input: RiskScoreInput = {
      snapshot: snap({ free_cashflow: -15e9 }),
      edgarFacts: edgar(80e9, -5e9),
      sectorTemplate: "speculative_growth",
    };
    const result = calculateRiskScore(input);
    expect(result.keyRisks.length).toBeGreaterThan(0);
  });

  it("positive FCF adds mitigant entry", () => {
    const input: RiskScoreInput = {
      snapshot: snap({ free_cashflow: 25e9 }),
      edgarFacts: edgar(100e9, 20e9),
      sectorTemplate: "mega_cap_cloud_software",
    };
    const result = calculateRiskScore(input);
    expect(result.mitigants.some(m => m.toLowerCase().includes("fcf") || m.toLowerCase().includes("cashflow"))).toBe(true);
  });

  it("always adds geopolitical/regulatory limitation", () => {
    const input: RiskScoreInput = { snapshot: snap(), edgarFacts: null, sectorTemplate: "general_quality_growth" };
    const result = calculateRiskScore(input);
    expect(result.limitations.some(l => l.toLowerCase().includes("geopolit") || l.toLowerCase().includes("regulat"))).toBe(true);
  });

  it("all components are within 0-100", () => {
    const input: RiskScoreInput = { snapshot: snap(), edgarFacts: edgar(100e9), sectorTemplate: "automotive" };
    const result = calculateRiskScore(input);
    for (const v of Object.values(result.components)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
