import { buildVeraQualityGate } from "../vera-quality-gate";
import { buildInvestmentCard } from "../investment-card";
import { buildScoreAttribution } from "../score-attribution";
import { buildValuationBridge, DEFAULT_BRIDGE_WEIGHTS } from "../valuation-bridge";
import { buildPriceZones } from "../price-zones";
import { buildConfidenceBreakdown } from "../confidence-breakdown";
import type { VeraFactCheckResult } from "@/types/vera";

describe("buildVeraQualityGate", () => {
  it("requires review on a high-severity Vera issue", () => {
    const vera: VeraFactCheckResult = {
      status: "needs_revision",
      checkedAt: new Date().toISOString(),
      severity: "high",
      issues: [{ type: "number_mismatch", message: "Widersprüchliche Kursziele", severity: "high" } as never],
    };
    const gate = buildVeraQualityGate({ vera });
    expect(gate.status).toBe("review_required");
    expect(gate.blocksFinalRating).toBe(true);
    expect(gate.reduceConfidence).toBe(true);
  });

  it("requires review on a deterministic rating/upside contradiction even with clean Vera", () => {
    const gate = buildVeraQualityGate({ vera: null, ratingContradiction: true });
    expect(gate.status).toBe("review_required");
    expect(gate.severity).toBe("high");
    expect(gate.suggestedFixes.length).toBeGreaterThan(0);
  });

  it("requires review on mixed currencies", () => {
    const gate = buildVeraQualityGate({ vera: null, currencyMixed: true });
    expect(gate.status).toBe("review_required");
  });

  it("stays ok with only low/medium issues", () => {
    const vera: VeraFactCheckResult = {
      status: "verified_with_warnings",
      checkedAt: new Date().toISOString(),
      severity: "medium",
      issues: [{ type: "unsupported_claim", message: "kleiner Hinweis", severity: "medium" } as never],
    };
    const gate = buildVeraQualityGate({ vera });
    expect(gate.status).toBe("ok");
    expect(gate.blocksFinalRating).toBe(false);
  });
});

describe("buildInvestmentCard", () => {
  it("assembles a Meta-style card: high quality, limited valuation attractiveness, hold", () => {
    const bridge = buildValuationBridge({
      primaryCurrency: "USD",
      eurUsd: 1.16,
      currentPrice: 632,
      methods: [
        { name: "own_model", label: "Eigenes Modell", baseWeight: DEFAULT_BRIDGE_WEIGHTS.own_model,
          range: { currency: "USD", base: 536, bear: 430, bull: 660, rationale: "", source: "own_model", confidence: "high", methods: [], limitations: [] } },
      ],
    });
    const zones = buildPriceZones({
      aggregateFairValue: bridge.aggregateFairValue,
      fairValueRange: bridge.fairValueRange,
      businessQualityScore: 90,
      balanceSheetRisk: "low",
    });
    const confidence = buildConfidenceBreakdown({
      dataCompletenessScore: 92,
      businessQualityScore: 90,
      valuationModelConfidence: "medium",
      valuationAssumptionHeavy: true,
    });
    const card = buildInvestmentCard({
      rating: "Halten",
      ratingWarning: false,
      marginOfSafetyAdequate: false,
      bridge,
      zones,
      confidence,
      businessQualityScore: 90,
      fallback: { redFlags: ["Capex steigt schneller als Umsatz"], bullCase: ["starkes Werbe-Ökosystem"], bearCase: ["AI-Capex belastet FCF"] },
    });
    expect(card.businessQuality).toBe("sehr hoch");
    expect(card.valuationAttractiveness).toBe("mittel bis niedrig"); // ~-15% upside
    expect(card.marginOfSafety.adequate).toBe(false);
    expect(card.reassessTriggers).toContain("Capex steigt schneller als Umsatz");
    expect(card.buyZone!).toBeLessThan(card.aggregateFairValue!);
  });
});

describe("buildScoreAttribution", () => {
  it("explains why a 90/60/45 profile is only a hold (valuation/risk binding)", () => {
    const attr = buildScoreAttribution({
      fundamentalScore: 90,
      technicalScore: 60,
      riskScore: 45,
      totalScore: 68,
      rating: "Halten",
      marginOfSafetyAdequate: false,
      upsideDownsidePercent: -15,
    });
    expect(attr.positiveContributors.some((p) => /Fundamental/i.test(p))).toBe(true);
    expect(attr.bindingConstraint).toMatch(/Bewertung/);
    expect(attr.explanation).toMatch(/Halten/);
  });
});
