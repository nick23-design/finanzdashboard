import { buildValuationDivergence, type DivergenceInput } from "../divergence";

const PRICE = 200;
const CONSENSUS_BASE = 240;  // +20% upside
const MODEL_BASE = 220;      // +10% upside

function makeInput(overrides: Partial<DivergenceInput> = {}): DivergenceInput {
  return {
    currentPrice: PRICE,
    analystConsensus: { available: true, base: CONSENSUS_BASE, bear: 180, bull: 300, source: "structured_consensus" },
    ownModel: { available: true, base: MODEL_BASE, bear: 190, bull: 260, confidence: "medium" },
    ...overrides,
  };
}

describe("buildValuationDivergence", () => {

  // ── Status cases ───────────────────────────────────────────────────────────

  test("missing_both when neither available", () => {
    const r = buildValuationDivergence({
      analystConsensus: { available: false },
      ownModel: { available: false },
    });
    expect(r.status).toBe("missing_both");
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.consensusUpsidePct).toBeUndefined();
    expect(r.baseGapPct).toBeUndefined();
  });

  test("missing_consensus when only model available", () => {
    const r = buildValuationDivergence({
      currentPrice: PRICE,
      analystConsensus: { available: false },
      ownModel: { available: true, base: MODEL_BASE },
    });
    expect(r.status).toBe("missing_consensus");
    expect(r.warnings.some(w => w.includes("analyst consensus"))).toBe(true);
    expect(r.baseGapPct).toBeUndefined();
  });

  test("missing_own_model when only consensus available", () => {
    const r = buildValuationDivergence({
      currentPrice: PRICE,
      analystConsensus: { available: true, base: CONSENSUS_BASE },
      ownModel: { available: false },
    });
    expect(r.status).toBe("missing_own_model");
    expect(r.warnings.some(w => w.includes("own model"))).toBe(true);
  });

  test("insufficient_data when base values missing", () => {
    const r = buildValuationDivergence({
      currentPrice: PRICE,
      analystConsensus: { available: true, base: null },
      ownModel: { available: true, base: MODEL_BASE },
    });
    expect(r.status).toBe("insufficient_data");
    expect(r.gapLabel).toBe("not_calculable");
  });

  test("insufficient_data when price is missing", () => {
    const r = buildValuationDivergence({
      currentPrice: undefined,
      analystConsensus: { available: true, base: CONSENSUS_BASE },
      ownModel: { available: true, base: MODEL_BASE },
    });
    expect(r.status).toBe("insufficient_data");
  });

  test("insufficient_data when price is zero", () => {
    const r = buildValuationDivergence({
      currentPrice: 0,
      analystConsensus: { available: true, base: CONSENSUS_BASE },
      ownModel: { available: true, base: MODEL_BASE },
    });
    expect(r.status).toBe("insufficient_data");
  });

  // ── Full calculation ───────────────────────────────────────────────────────

  test("available with correct upside values", () => {
    const r = buildValuationDivergence(makeInput());
    expect(r.status).toBe("available");
    // Consensus upside: (240 - 200) / 200 * 100 = 20.0%
    expect(r.consensusUpsidePct).toBeCloseTo(20.0, 1);
    // Own model upside: (220 - 200) / 200 * 100 = 10.0%
    expect(r.ownModelUpsidePct).toBeCloseTo(10.0, 1);
    // baseGapPct: (240 - 220) / 200 * 100 = 10.0% (consensus more bullish)
    expect(r.baseGapPct).toBeCloseTo(10.0, 1);
    expect(r.gapLabel).toBe("consensus_more_bullish");
  });

  test("own_model_more_bullish when model > consensus", () => {
    const r = buildValuationDivergence(makeInput({
      analystConsensus: { available: true, base: 210 },  // +5%
      ownModel: { available: true, base: 240 },           // +20%
    }));
    expect(r.status).toBe("available");
    // baseGapPct: (210 - 240) / 200 * 100 = -15%
    expect(r.baseGapPct).toBeCloseTo(-15.0, 1);
    expect(r.gapLabel).toBe("own_model_more_bullish");
  });

  test("aligned when gap < 5%", () => {
    // Gap = (205 - 203) / 200 * 100 = 1%
    const r = buildValuationDivergence(makeInput({
      analystConsensus: { available: true, base: 205 },
      ownModel: { available: true, base: 203 },
    }));
    expect(r.gapLabel).toBe("aligned");
  });

  test("aligned boundary: exactly 4.9% gap → aligned", () => {
    // Gap = (209.8 - 200) / 200 * 100 ≈ 4.9%  (both from same base)
    // consensus = 209.8, model = 200  → gap = 9.8/200 * 100 = 4.9%
    const r = buildValuationDivergence(makeInput({
      analystConsensus: { available: true, base: 209.8 },
      ownModel: { available: true, base: 200 },
    }));
    expect(r.gapLabel).toBe("aligned"); // 4.9 < 5
  });

  test("consensus_more_bullish at exactly 5.0% boundary", () => {
    // Gap = (210 - 200) / 200 * 100 = 5.0%
    const r = buildValuationDivergence(makeInput({
      analystConsensus: { available: true, base: 210 },
      ownModel: { available: true, base: 200 },
    }));
    expect(r.gapLabel).toBe("consensus_more_bullish"); // 5.0 >= 5
  });

  // ── explanationSeed content ───────────────────────────────────────────────

  test("explanationSeed mentions upside percentages for consensus_more_bullish", () => {
    const r = buildValuationDivergence(makeInput());
    expect(r.explanationSeed).toContain("+20.0%");
    expect(r.explanationSeed).toContain("+10.0%");
  });

  test("explanationSeed present for all statuses", () => {
    const statuses = [
      buildValuationDivergence({ analystConsensus: { available: false }, ownModel: { available: false } }),
      buildValuationDivergence({ currentPrice: PRICE, analystConsensus: { available: false }, ownModel: { available: true, base: 200 } }),
      buildValuationDivergence({ currentPrice: PRICE, analystConsensus: { available: true, base: 200 }, ownModel: { available: false } }),
      buildValuationDivergence({ currentPrice: PRICE, analystConsensus: { available: true, base: null }, ownModel: { available: true, base: 200 } }),
      buildValuationDivergence(makeInput()),
    ];
    for (const r of statuses) {
      expect(typeof r.explanationSeed).toBe("string");
      expect(r.explanationSeed.length).toBeGreaterThan(10);
    }
  });

  // ── Warnings ──────────────────────────────────────────────────────────────

  test("news_derived consensus triggers warning", () => {
    const r = buildValuationDivergence(makeInput({
      analystConsensus: { available: true, base: CONSENSUS_BASE, source: "news_derived" },
    }));
    expect(r.status).toBe("available");
    expect(r.warnings.some(w => w.includes("news-derived"))).toBe(true);
  });

  test("structured_consensus produces no extra warnings", () => {
    const r = buildValuationDivergence(makeInput());
    expect(r.warnings).toHaveLength(0);
  });

  // ── Rounding ──────────────────────────────────────────────────────────────

  test("values are rounded to 1 decimal", () => {
    // Uneven price: 197, consensus: 241, model: 217
    const r = buildValuationDivergence({
      currentPrice: 197,
      analystConsensus: { available: true, base: 241 },
      ownModel: { available: true, base: 217 },
    });
    expect(r.status).toBe("available");
    // Manual: consensus upside = (241-197)/197 * 100 = 22.33...% → round to 22.3
    expect(r.consensusUpsidePct).toBe(22.3);
    // model upside = (217-197)/197 * 100 = 10.15...% → round to 10.2
    expect(r.ownModelUpsidePct).toBe(10.2);
  });

  // ── Downside scenarios ────────────────────────────────────────────────────

  test("negative upside formatted correctly (both below price)", () => {
    const r = buildValuationDivergence({
      currentPrice: 300,
      analystConsensus: { available: true, base: 270 },  // -10%
      ownModel: { available: true, base: 285 },           // -5%
    });
    expect(r.status).toBe("available");
    expect(r.consensusUpsidePct).toBeCloseTo(-10.0, 1);
    expect(r.ownModelUpsidePct).toBeCloseTo(-5.0, 1);
    // Gap: (270 - 285) / 300 * 100 = -5.0 → own_model_more_bullish
    expect(r.gapLabel).toBe("own_model_more_bullish");
    expect(r.explanationSeed).toContain("-10.0%");
    expect(r.explanationSeed).toContain("-5.0%");
  });
});
