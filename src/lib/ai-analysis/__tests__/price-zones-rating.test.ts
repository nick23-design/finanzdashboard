import { buildPriceZones, computeRequiredMarginOfSafety } from "../price-zones";
import { deriveFinalRating } from "../final-rating";

describe("price zones", () => {
  it("requires a smaller margin of safety for high-quality, low-risk businesses", () => {
    const highQuality = computeRequiredMarginOfSafety({
      aggregateFairValue: 500,
      fairValueRange: { bear: 400, base: 500, bull: 620 },
      businessQualityScore: 90,
      balanceSheetRisk: "low",
    });
    const cyclicalLevered = computeRequiredMarginOfSafety({
      aggregateFairValue: 500,
      fairValueRange: { bear: 400, base: 500, bull: 620 },
      businessQualityScore: 45,
      balanceSheetRisk: "high",
      cyclical: true,
    });
    expect(highQuality).toBeLessThan(cyclicalLevered);
    expect(highQuality).toBeGreaterThanOrEqual(0.1);
    expect(cyclicalLevered).toBeLessThanOrEqual(0.45);
  });

  it("derives buy/hold/avoid bands from the fair value", () => {
    const zones = buildPriceZones({
      aggregateFairValue: 500,
      fairValueRange: { bear: 400, base: 500, bull: 620 },
      businessQualityScore: 90,
      balanceSheetRisk: "low",
    });
    expect(zones.buyBelow!).toBeLessThan(500);
    expect(zones.avoidAbove!).toBeGreaterThanOrEqual(500);
  });
});

describe("deriveFinalRating", () => {
  const zones = buildPriceZones({
    aggregateFairValue: 500,
    fairValueRange: { bear: 400, base: 500, bull: 620 },
    businessQualityScore: 90,
    balanceSheetRisk: "low",
  });

  it("does not auto-buy a high-quality stock with thin margin of safety", () => {
    // Small positive upside, below the required MoS.
    const r = deriveFinalRating({
      upsideDownsidePercent: 6,
      businessQualityScore: 90,
      zones,
    });
    expect(r.rating).not.toBe("Kaufen");
    expect(["Leicht kaufen", "Halten"]).toContain(r.rating);
    expect(r.marginOfSafetyAdequate).toBe(false);
  });

  it("holds (not sells) a high-quality compounder that is mildly overvalued", () => {
    const r = deriveFinalRating({
      upsideDownsidePercent: -15, // price above fair value
      businessQualityScore: 90,
      zones,
    });
    expect(r.rating).toBe("Halten");
  });

  it("issues a buy when upside exceeds the required margin of safety", () => {
    const r = deriveFinalRating({
      upsideDownsidePercent: 35,
      businessQualityScore: 90,
      zones,
    });
    expect(r.rating).toBe("Kaufen");
    expect(r.marginOfSafetyAdequate).toBe(true);
  });

  it("flags a contradiction when the LLM is far more bullish than the math", () => {
    const r = deriveFinalRating({
      upsideDownsidePercent: -25, // math says sell
      businessQualityScore: 40,
      zones,
      llmRecommendation: "Kaufen",
    });
    expect(r.contradictsLlmRecommendation).toBe(true);
  });
});
