import {
  buildValuationBridge,
  DEFAULT_BRIDGE_WEIGHTS,
  type BridgeMethodInput,
} from "../valuation-bridge";
import type { RawValuationRange } from "../valuation-model";

function range(
  partial: Partial<RawValuationRange> & Pick<RawValuationRange, "currency" | "base">,
): RawValuationRange {
  return {
    bear: partial.base != null ? partial.base * 0.8 : null,
    bull: partial.base != null ? partial.base * 1.2 : null,
    rationale: "test",
    source: "own_model",
    confidence: "medium",
    methods: ["test"],
    limitations: [],
    ...partial,
  };
}

function method(over: Partial<BridgeMethodInput> & Pick<BridgeMethodInput, "name">): BridgeMethodInput {
  return {
    label: over.name,
    range: null,
    baseWeight: DEFAULT_BRIDGE_WEIGHTS[over.name],
    ...over,
  };
}

describe("buildValuationBridge", () => {
  it("aggregates a divergent DCF and own model into one fair value between them", () => {
    const bridge = buildValuationBridge({
      primaryCurrency: "USD",
      eurUsd: 1.16,
      currentPrice: 600,
      methods: [
        method({ name: "own_model", range: range({ currency: "USD", base: 500, confidence: "high" }) }),
        method({ name: "dcf", range: range({ currency: "USD", base: 437, confidence: "medium" }) }),
      ],
    });

    expect(bridge.aggregateFairValue).not.toBeNull();
    // Aggregate must lie strictly between the two method values.
    expect(bridge.aggregateFairValue!).toBeGreaterThan(437);
    expect(bridge.aggregateFairValue!).toBeLessThan(500);
    // Higher-confidence own model carries more weight than the medium DCF.
    const own = bridge.methods.find((m) => m.name === "own_model")!;
    const dcf = bridge.methods.find((m) => m.name === "dcf")!;
    expect(own.included && dcf.included).toBe(true);
    expect(own.weight).toBeGreaterThan(dcf.weight);
    // Weights of included methods sum to 1.
    expect(own.weight + dcf.weight).toBeCloseTo(1, 3);
    // Conservative range spans below bear and above bull of the inputs.
    expect(bridge.fairValueRange.bear!).toBeLessThanOrEqual(437 * 0.8 + 0.01);
    expect(bridge.fairValueRange.bull!).toBeGreaterThanOrEqual(500 * 1.2 - 0.01);
  });

  it("computes upside/downside and margin of safety against the current price", () => {
    const bridge = buildValuationBridge({
      primaryCurrency: "USD",
      eurUsd: 1.16,
      currentPrice: 632,
      methods: [
        method({ name: "own_model", range: range({ currency: "USD", base: 536, confidence: "high" }) }),
      ],
    });
    expect(bridge.aggregateFairValue).toBeCloseTo(536, 1);
    expect(bridge.upsideDownsidePercent).toBeCloseTo(-15.2, 1);
    // Price above fair value → negative margin of safety.
    expect(bridge.marginOfSafety!).toBeLessThan(0);
  });

  it("excludes a non-structured analyst consensus instead of blending it silently", () => {
    const bridge = buildValuationBridge({
      primaryCurrency: "USD",
      eurUsd: 1.16,
      currentPrice: 600,
      methods: [
        method({ name: "own_model", range: range({ currency: "USD", base: 500, confidence: "high" }) }),
        method({
          name: "analyst_consensus",
          structured: false,
          range: range({ currency: "USD", base: 700, confidence: "medium", source: "analyst_consensus" }),
        }),
      ],
    });
    const consensus = bridge.methods.find((m) => m.name === "analyst_consensus")!;
    expect(consensus.included).toBe(false);
    expect(consensus.weight).toBe(0);
    expect(consensus.exclusionReason).toMatch(/strukturiert/i);
    // Aggregate must equal the own model alone (consensus did not leak in).
    expect(bridge.aggregateFairValue).toBeCloseTo(500, 1);
  });

  it("includes a structured analyst consensus", () => {
    const bridge = buildValuationBridge({
      primaryCurrency: "USD",
      eurUsd: 1.16,
      currentPrice: 600,
      methods: [
        method({ name: "own_model", range: range({ currency: "USD", base: 500, confidence: "high" }) }),
        method({
          name: "analyst_consensus",
          structured: true,
          range: range({ currency: "USD", base: 700, confidence: "medium", source: "analyst_consensus" }),
        }),
      ],
    });
    const consensus = bridge.methods.find((m) => m.name === "analyst_consensus")!;
    expect(consensus.included).toBe(true);
    expect(bridge.aggregateFairValue!).toBeGreaterThan(500);
  });

  it("excludes a method without reliable base data", () => {
    const bridge = buildValuationBridge({
      primaryCurrency: "USD",
      eurUsd: 1.16,
      currentPrice: 600,
      methods: [
        method({ name: "own_model", range: range({ currency: "USD", base: 500, confidence: "high" }) }),
        method({ name: "dcf", range: range({ currency: "USD", base: null as unknown as number }) }),
      ],
    });
    const dcf = bridge.methods.find((m) => m.name === "dcf")!;
    expect(dcf.included).toBe(false);
    expect(dcf.exclusionReason).toMatch(/keine belastbaren daten/i);
  });

  it("normalises mixed currencies into the primary currency", () => {
    const bridge = buildValuationBridge({
      primaryCurrency: "USD",
      eurUsd: 1.16,
      currentPrice: 600,
      methods: [
        // 460 EUR → 533.6 USD
        method({ name: "own_model", range: range({ currency: "EUR", base: 460, confidence: "high" }) }),
      ],
    });
    const own = bridge.methods.find((m) => m.name === "own_model")!;
    expect(own.originalCurrency).toBe("EUR");
    expect(own.currency).toBe("USD");
    expect(own.fairValue).toBeCloseTo(533.6, 1);
    expect(bridge.fxConvertedValues.aggregateEur).toBeCloseTo(460, 0);
  });
});
