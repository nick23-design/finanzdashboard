/**
 * DCF pipeline integration tests.
 *
 * Focus: Apple-like regression — expensive premium-quality stock with
 * DCF < current price should NOT automatically yield a "Sell" signal.
 * The pipeline must return a non-null DCF range; rating logic stays in Opus.
 */

import { buildDcfInputFromSnapshot, computeDcfScenarios } from "../dcf-pipeline";
import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: "test",
    symbol: "AAPL",
    price: 195,
    currency: "USD",
    isin: null,
    description: null,
    pe_ratio: 30,
    market_cap: 3_000_000_000_000, // $3 T
    debt_to_equity: 1.5,
    revenue_growth: 0.06,
    free_cashflow: 100_000_000_000, // $100 B
    rsi: 55,
    moving_average_50: 185,
    moving_average_200: 175,
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeEdgarFacts(ttmRevenue: number): EdgarFacts {
  const quarterRevenue = ttmRevenue / 4;
  return {
    revenue: [
      { period: "Q4-2024", value: quarterRevenue },
      { period: "Q3-2024", value: quarterRevenue },
      { period: "Q2-2024", value: quarterRevenue },
      { period: "Q1-2024", value: quarterRevenue },
    ],
    net_income: [],
    gross_profit: [],
    source: undefined,
  };
}

// ─── buildDcfInputFromSnapshot ────────────────────────────────────────────────

describe("buildDcfInputFromSnapshot", () => {
  it("returns a valid DcfInput for Apple with EDGAR TTM revenue", () => {
    const snapshot = makeSnapshot();
    const edgarFacts = makeEdgarFacts(383_000_000_000); // ~$383 B TTM

    const input = buildDcfInputFromSnapshot(snapshot, edgarFacts, "mega_cap_cloud_software");
    expect(input).not.toBeNull();
    expect(input!.revenue).toBeCloseTo(383_000_000_000, -6);
    expect(input!.currentPrice).toBe(195);
    expect(input!.sharesOutstanding).toBeGreaterThan(0);
    expect(input!.revenueGrowthRates).toHaveLength(5);
    expect(input!.wacc).toBeGreaterThan(0);
  });

  it("uses FCF fallback when EDGAR has fewer than 4 quarters", () => {
    const snapshot = makeSnapshot({ free_cashflow: 100_000_000_000 });
    const sparseEdgar: EdgarFacts = {
      revenue: [{ period: "Q4-2024", value: 95_000_000_000 }], // only 1 quarter
      net_income: [],
      gross_profit: [],
      source: undefined,
    };

    const input = buildDcfInputFromSnapshot(snapshot, sparseEdgar, "mega_cap_cloud_software");
    expect(input).not.toBeNull();
    expect(input!.revenue).toBeGreaterThan(0);
  });

  it("returns null when revenue cannot be derived and FCF is missing", () => {
    const snapshot = makeSnapshot({ free_cashflow: null });
    const input = buildDcfInputFromSnapshot(snapshot, null, "mega_cap_cloud_software");
    expect(input).toBeNull();
  });

  it("returns null when market_cap is missing", () => {
    const snapshot = makeSnapshot({ market_cap: null });
    const edgarFacts = makeEdgarFacts(383_000_000_000);
    const input = buildDcfInputFromSnapshot(snapshot, edgarFacts, "mega_cap_cloud_software");
    expect(input).toBeNull();
  });

  it("returns null when price is missing", () => {
    const snapshot = makeSnapshot({ price: null });
    const edgarFacts = makeEdgarFacts(383_000_000_000);
    const input = buildDcfInputFromSnapshot(snapshot, edgarFacts, "mega_cap_cloud_software");
    expect(input).toBeNull();
  });

  it("blends revenue growth from snapshot down to terminal growth over 5 years", () => {
    const snapshot = makeSnapshot({ revenue_growth: 0.20 });
    const edgarFacts = makeEdgarFacts(383_000_000_000);

    const input = buildDcfInputFromSnapshot(snapshot, edgarFacts, "mega_cap_cloud_software");
    expect(input).not.toBeNull();

    const rates = input!.revenueGrowthRates;
    expect(rates[0]).toBeGreaterThan(rates[rates.length - 1]); // year 1 > year 5
    expect(rates[rates.length - 1]).toBeCloseTo(0.03, 3); // converges to terminal growth
  });
});

// ─── computeDcfScenarios ─────────────────────────────────────────────────────

describe("computeDcfScenarios", () => {
  it("returns non-null scenarios for Apple (premium quality stock)", () => {
    const snapshot = makeSnapshot();
    const edgarFacts = makeEdgarFacts(383_000_000_000);

    const result = computeDcfScenarios(snapshot, edgarFacts, "mega_cap_cloud_software");
    expect(result).not.toBeNull();
    expect(result!.bear.fairValuePerShare).toBeGreaterThan(0);
    expect(result!.base.fairValuePerShare).toBeGreaterThan(0);
    expect(result!.bull.fairValuePerShare).toBeGreaterThan(0);
  });

  it("Apple DCF regression: bull > base > bear", () => {
    const snapshot = makeSnapshot();
    const edgarFacts = makeEdgarFacts(383_000_000_000);

    const result = computeDcfScenarios(snapshot, edgarFacts, "mega_cap_cloud_software");
    expect(result).not.toBeNull();
    expect(result!.bull.fairValuePerShare).toBeGreaterThan(result!.base.fairValuePerShare);
    expect(result!.base.fairValuePerShare).toBeGreaterThan(result!.bear.fairValuePerShare);
  });

  it("Apple DCF regression: DCF < current price does NOT make scenarios invalid", () => {
    // Apple at $195 may have a DCF base well below current price.
    // This is expected — the pipeline should still return valid scenarios.
    const snapshot = makeSnapshot({ price: 195 });
    const edgarFacts = makeEdgarFacts(383_000_000_000);

    const result = computeDcfScenarios(snapshot, edgarFacts, "mega_cap_cloud_software");
    expect(result).not.toBeNull();

    // All scenarios must be positive (company has real value)
    expect(result!.bear.fairValuePerShare).toBeGreaterThan(0);
    expect(result!.base.fairValuePerShare).toBeGreaterThan(0);
    expect(result!.bull.fairValuePerShare).toBeGreaterThan(0);

    // At least the bear case upside/downside must be finite (not NaN)
    expect(Number.isFinite(result!.bear.upsideDownsidePct)).toBe(true);
  });

  it("returns null when there is no usable revenue data and no FCF", () => {
    const snapshot = makeSnapshot({ free_cashflow: null, market_cap: null });
    const result = computeDcfScenarios(snapshot, null, "general_quality_growth");
    expect(result).toBeNull();
  });

  it("works with speculative growth sector (high WACC, low margins)", () => {
    const snapshot = makeSnapshot({
      price: 25,
      market_cap: 5_000_000_000,
      free_cashflow: 100_000_000,
      revenue_growth: 0.40,
    });
    const edgarFacts = makeEdgarFacts(1_000_000_000);

    const result = computeDcfScenarios(snapshot, edgarFacts, "speculative_growth");
    expect(result).not.toBeNull();
    expect(result!.bull.fairValuePerShare).toBeGreaterThan(result!.bear.fairValuePerShare);
  });

  it("bull scenario is meaningfully higher than bear (>5% difference)", () => {
    const snapshot = makeSnapshot();
    const edgarFacts = makeEdgarFacts(383_000_000_000);

    const result = computeDcfScenarios(snapshot, edgarFacts, "mega_cap_cloud_software");
    expect(result).not.toBeNull();

    const spread = (result!.bull.fairValuePerShare - result!.bear.fairValuePerShare) / result!.base.fairValuePerShare;
    expect(spread).toBeGreaterThan(0.05);
  });
});
