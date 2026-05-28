import { calculateRevisionMomentum, type RevisionInput } from "../revision-momentum";
import type { AssetSnapshot } from "@/types/database";
import type { AnalystData } from "@/lib/finance-client";

function snap(price: number = 100): AssetSnapshot {
  return {
    id: "t", symbol: "T", price, currency: "USD", isin: null, description: null,
    pe_ratio: 25, market_cap: 1e12, debt_to_equity: 1, revenue_growth: 0.1,
    free_cashflow: 50e9, rsi: 55, moving_average_50: 98, moving_average_200: 90,
    fetched_at: new Date().toISOString(),
  };
}

function analyst(overrides: Partial<AnalystData> = {}): AnalystData {
  return {
    mean_target: 120, high_target: 150, low_target: 90,
    strong_buy: 15, buy: 10, hold: 5, sell: 1, strong_sell: 0,
    rating_count: 31, source: "yahoo",
    ...overrides,
  };
}

describe("calculateRevisionMomentum", () => {
  it("positive analyst sentiment produces positive direction", () => {
    const input: RevisionInput = { snapshot: snap(), analystData: analyst() };
    const result = calculateRevisionMomentum(input);
    expect(result.direction).toBe("positive");
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it("negative analyst distribution produces negative direction", () => {
    const input: RevisionInput = {
      snapshot: snap(100),
      analystData: analyst({ strong_buy: 0, buy: 1, hold: 5, sell: 10, strong_sell: 5, mean_target: 80 }),
    };
    const result = calculateRevisionMomentum(input);
    expect(result.direction).toBe("negative");
    expect(result.score).toBeLessThan(50);
  });

  it("no analyst data returns neutral score with limitations", () => {
    const input: RevisionInput = { snapshot: snap(), analystData: null };
    const result = calculateRevisionMomentum(input);
    expect(result.score).toBe(50);
    expect(result.direction).toBe("neutral");
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("always includes EPS revision limitation", () => {
    const input: RevisionInput = { snapshot: snap(), analystData: analyst() };
    const result = calculateRevisionMomentum(input);
    expect(result.limitations.some(l => l.toLowerCase().includes("revision") || l.toLowerCase().includes("eps") || l.toLowerCase().includes("zeitreihe"))).toBe(true);
  });

  it("upward revisions count ≥ downward for positive result", () => {
    const input: RevisionInput = {
      snapshot: snap(),
      analystData: analyst({ strong_buy: 20, buy: 10, hold: 3, sell: 1, strong_sell: 0 }),
    };
    const result = calculateRevisionMomentum(input);
    if (result.upwardRevisions !== undefined && result.downwardRevisions !== undefined) {
      expect(result.upwardRevisions).toBeGreaterThanOrEqual(result.downwardRevisions);
    }
    expect(result.direction).toBe("positive");
  });

  it("large target spread reduces score vs. narrow spread", () => {
    const narrowInput: RevisionInput = {
      snapshot: snap(100),
      analystData: analyst({ mean_target: 120, high_target: 125, low_target: 115 }),
    };
    const wideInput: RevisionInput = {
      snapshot: snap(100),
      analystData: analyst({ mean_target: 120, high_target: 200, low_target: 60 }),
    };
    const narrow = calculateRevisionMomentum(narrowInput);
    const wide = calculateRevisionMomentum(wideInput);
    expect(narrow.score).toBeGreaterThanOrEqual(wide.score);
  });

  it("score is between 0 and 100", () => {
    const input: RevisionInput = { snapshot: snap(), analystData: analyst() };
    const result = calculateRevisionMomentum(input);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
