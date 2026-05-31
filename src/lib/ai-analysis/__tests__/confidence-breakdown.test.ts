import { buildConfidenceBreakdown } from "../confidence-breakdown";

describe("buildConfidenceBreakdown", () => {
  it("does not let high data quality lift valuation confidence when assumptions are heavy", () => {
    const c = buildConfidenceBreakdown({
      dataCompletenessScore: 95,
      businessQualityScore: 85,
      valuationModelConfidence: "high",
      valuationAssumptionHeavy: true, // capex/AI/terminal-multiple dependent
    });
    expect(c.dataConfidence).toBe("high");
    expect(c.businessQualityConfidence).toBe("high");
    expect(c.valuationConfidence).toBe("medium"); // capped despite high data
    expect(c.overallConfidence).toBe("medium"); // bound by valuation
  });

  it("matches the Meta-style profile (data high, quality high, valuation medium, overall medium)", () => {
    const c = buildConfidenceBreakdown({
      dataCompletenessScore: 92,
      businessQualityScore: 88,
      valuationModelConfidence: "medium",
      technicalScore: 55,
      valuationAssumptionHeavy: true,
    });
    expect(c.dataConfidence).toBe("high");
    expect(c.businessQualityConfidence).toBe("high");
    expect(c.valuationConfidence).toBe("medium");
    expect(c.overallConfidence).toBe("medium");
  });

  it("overall confidence can never exceed data confidence", () => {
    const c = buildConfidenceBreakdown({
      dataCompletenessScore: 50, // low data
      businessQualityScore: 90,
      valuationModelConfidence: "high",
    });
    expect(c.dataConfidence).toBe("low");
    expect(c.overallConfidence).toBe("low");
  });

  it("downgrades valuation confidence when methods diverge strongly", () => {
    const c = buildConfidenceBreakdown({
      dataCompletenessScore: 90,
      valuationModelConfidence: "high",
      bridgeDispersionPct: 45,
    });
    expect(c.valuationConfidence).toBe("medium");
  });

  it("caps timing confidence at medium", () => {
    const c = buildConfidenceBreakdown({
      dataCompletenessScore: 90,
      technicalScore: 95,
      valuationModelConfidence: "high",
    });
    expect(c.timingConfidence).toBe("medium");
  });
});
