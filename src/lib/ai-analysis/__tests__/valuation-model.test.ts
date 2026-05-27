import {
  buildAnalystConsensusValuation,
  buildBusinessDriverAnalysis,
  buildOwnModelValuation,
} from "../valuation-model";
import type { AssetSnapshot } from "@/types/database";

function makeSnapshot(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "snap-1",
    symbol: "MSFT",
    price: 416,
    currency: "USD",
    isin: null,
    description: null,
    pe_ratio: 25,
    market_cap: 3_100_000_000_000,
    debt_to_equity: 35,
    revenue_growth: 0.12,
    free_cashflow: 75_000_000_000,
    rsi: 55,
    moving_average_50: 420,
    moving_average_200: 430,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("valuation-model", () => {
  it("classifies known hyperscaler tickers with sector-specific drivers", () => {
    const drivers = buildBusinessDriverAnalysis("MSFT", makeSnapshot());

    expect(drivers.sector_template).toBe("mega_cap_cloud_software");
    expect(drivers.classification_confidence).toBe("high");
    expect(drivers.red_flags.join(" ")).toContain("Capex");
    expect(drivers.model_instructions.valuation_methods).toContain("EV/FCF");
  });

  it("keeps analyst consensus separate from own valuation", () => {
    const consensus = buildAnalystConsensusValuation({
      mean_target: 560.63,
      high_target: 870,
      low_target: 400,
      strong_buy: 10,
      buy: 30,
      hold: 12,
      sell: 2,
      strong_sell: 1,
    });

    expect(consensus?.source).toBe("analyst_consensus");
    expect(consensus?.base).toBe(560.63);
    expect(consensus?.rationale).toContain("Marktmeinung");
  });

  it("builds a deterministic own model from PE and FCF inputs", () => {
    const snapshot = makeSnapshot();
    const drivers = buildBusinessDriverAnalysis("MSFT", snapshot);
    const model = buildOwnModelValuation(snapshot, drivers, { completeness_score: 90, missing_fields: [] });

    expect(model?.source).toBe("own_model");
    expect(model?.methods.length).toBeGreaterThanOrEqual(2);
    expect(model?.bear).toBeLessThan(model?.base ?? 0);
    expect(model?.bull).toBeGreaterThan(model?.base ?? 0);
    expect(model?.confidence).toBe("high");
  });

  it("uses low confidence for speculative growth even when a rough model exists", () => {
    const snapshot = makeSnapshot({
      symbol: "RKLB",
      price: 45,
      pe_ratio: 120,
      market_cap: 20_000_000_000,
      free_cashflow: -250_000_000,
      revenue_growth: 0.35,
    });
    const drivers = buildBusinessDriverAnalysis("RKLB", snapshot);
    const model = buildOwnModelValuation(snapshot, drivers, { completeness_score: 80, missing_fields: [] });

    expect(drivers.sector_template).toBe("speculative_growth");
    expect(model?.confidence).toBe("low");
    expect(model?.limitations.join(" ")).toContain("Story");
  });
});
