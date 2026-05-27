/**
 * Guardrail Engine — Tests
 *
 * Covers:
 *  - Engine: deterministic execution, multiple rules firing, conservative semantics
 *  - Individual rules: G1–G6 each tested in isolation
 *  - runGuardrailEngine: integration with all lightweight rules
 *  - No LLM calls, no VERA calls in the guardrail path
 */

import { runGuardrailEngine } from "../guardrails/engine";
import {
  G1_AnalystClaimsWithoutConsensus,
  G2_NewsPriceTargetUnverified,
  G3_ConsensusModelMixing,
  G4_DivergenceWithoutOwnModel,
  G5a_WeakDataBasis,
  G5b_LowConfidenceTarget,
  G6_EntryQualityMismatch,
  G7_NoStrongRecommendationWithoutSupport,
  G8_NoPseudoPrecisionWithWideRange,
  G9_LowConfidenceModelLimitsValuationClaims,
  G10_MissingOwnModelLimitsValuationClaims,
  G11_UnclearSourceForNumericalClaim,
  G12_RecommendationConvictionConsistency,
  G13_EntryQualityBearishMismatch,
  G14_NewsSentimentCannotOverrideWeakValuationAlone,
  G15_TechnicalTimingCannotOverrideFundamentalUncertainty,
  G16_ExtremeDivergenceRequiresExplanation,
  V1_ExtremeDivergenceRequiresInterpretation,
  V2_ConservativeModelDisclaimer,
  V3_BullBearUndercalibration,
  V4_ConsensusAutoUpsideGuard,
  V5_OwnModelDivergenceCaution,
  V6_MissingCurrentPrice,
  V7_LowConfidenceDivergence,
  V8_ConsensusOnlyValuation,
  V9_OwnModelOnlyValuation,
  V10_ScenarioOrderingInvalid,
  V11_ExtremeUpsideDownside,
  V12_DivergenceLanguageGermanTemplate,
  ALL_LIGHTWEIGHT_RULES,
} from "../guardrails/index";
import type {
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailRule,
} from "../guardrails/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<GuardrailAnalysis> = {}): GuardrailAnalysis {
  return {
    recommendation: "Kaufen",
    conviction: 8,
    price_levels: {
      entry: 100,
      target: 130,
      stop_loss: 90,
      entry_rationale: "Support-Level",
      target_rationale: "Modell-Kursziel",
    },
    entry_quality: { label: "attraktiv", rationale: "Rücksetzer genutzt." },
    valuation_confidence: "medium",
    valuation_divergence: null,
    claims: [],
    data_quality_guardrails: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<GuardrailContext> = {}): GuardrailContext {
  return {
    symbol: "TEST",
    dataQualityScore: 80,
    currentPrice: 100,       // Phase 3: prevents V6 from firing in non-V6 tests
    hasAnalystConsensus: true,
    hasOwnModel: true,
    analystConsensusBase: 120,
    ownModelBase: 110,
    ...overrides,
  };
}

// ─── Engine: core semantics ───────────────────────────────────────────────────

describe("runGuardrailEngine — core semantics", () => {
  test("returns unmodified analysis when no rules fire", () => {
    const analysis = makeAnalysis();
    const context = makeContext();
    const { analysis: result, fired } = runGuardrailEngine(analysis, context, []);
    expect(result.recommendation).toBe("Kaufen");
    expect(result.conviction).toBe(8);
    expect(fired).toHaveLength(0);
  });

  test("does not mutate the original analysis object", () => {
    const analysis = makeAnalysis({ conviction: 9 });
    const context = makeContext({ dataQualityScore: 35 }); // triggers G5a
    runGuardrailEngine(analysis, context, ALL_LIGHTWEIGHT_RULES);
    expect(analysis.conviction).toBe(9); // unchanged
  });

  test("no LLM calls — engine is synchronous and returns immediately", () => {
    // If any rule calls an LLM, this test times out.
    // Simply assert the call completes synchronously.
    const start = Date.now();
    runGuardrailEngine(makeAnalysis(), makeContext(), ALL_LIGHTWEIGHT_RULES);
    expect(Date.now() - start).toBeLessThan(50); // ≪ 50ms, no I/O
  });

  test("rule that throws is skipped, engine continues", () => {
    const throwingRule: GuardrailRule = {
      id: "THROW",
      scope: "global",
      severity: "warning",
      description: "Throws intentionally.",
      condition: () => { throw new Error("oops"); },
      apply: () => null,
    };
    const goodRule: GuardrailRule = {
      id: "GOOD",
      scope: "global",
      severity: "info",
      description: "Always fires.",
      condition: () => true,
      apply: () => ({
        id: "GOOD",
        scope: "global",
        severity: "info",
        issueType: "unsupported_claim",
        message: "fired",
        patch: { warnings: ["good rule"] },
      }),
    };
    const { fired, analysis } = runGuardrailEngine(
      makeAnalysis(),
      makeContext(),
      [throwingRule, goodRule],
    );
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("GOOD");
    expect(analysis.data_quality_guardrails).toContain("good rule");
  });

  test("multiple rules fire simultaneously", () => {
    const analysis = makeAnalysis({
      conviction: 9,
      claims: [{ claim: "c1", evidence: "e1", source_type: "analyst", confidence: 8 }],
      price_levels: { entry: 100, target: 130, stop_loss: 90, entry_rationale: "r", target_rationale: "r" },
    });
    const context = makeContext({
      dataQualityScore: 30,   // G5a fires (< 40)
      hasAnalystConsensus: false, // G1 fires (analyst claim present)
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, context, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    expect(ids).toContain("G1");
    expect(ids).toContain("G5a");
    expect(result.conviction).toBe(5);
    expect(result.recommendation).toBe("Halten"); // G5a downgrades from Kaufen
    // G1: analyst claim confidence capped
    expect(result.claims[0].confidence).toBe(4);
  });

  test("deterministic: same input always produces same output", () => {
    const analysis = makeAnalysis({ conviction: 9 });
    const context = makeContext({ dataQualityScore: 35 });
    const { analysis: r1 } = runGuardrailEngine(analysis, context, ALL_LIGHTWEIGHT_RULES);
    const { analysis: r2 } = runGuardrailEngine(analysis, context, ALL_LIGHTWEIGHT_RULES);
    expect(r1).toEqual(r2);
  });
});

// ─── Conservative semantics ───────────────────────────────────────────────────

describe("runGuardrailEngine — conservative merging", () => {
  test("lowest convictionMax wins across multiple rules", () => {
    const rule5: GuardrailRule = {
      id: "A",
      scope: "data_quality",
      severity: "warning",
      description: "Cap at 5",
      condition: () => true,
      apply: () => ({
        id: "A",
        scope: "data_quality",
        severity: "warning",
        issueType: "weak_data_quality",
        message: "cap 5",
        patch: { convictionMax: 5 },
      }),
    };
    const rule7: GuardrailRule = {
      id: "B",
      scope: "data_quality",
      severity: "warning",
      description: "Cap at 7",
      condition: () => true,
      apply: () => ({
        id: "B",
        scope: "data_quality",
        severity: "warning",
        issueType: "weak_data_quality",
        message: "cap 7",
        patch: { convictionMax: 7 },
      }),
    };
    const { analysis } = runGuardrailEngine(makeAnalysis({ conviction: 9 }), makeContext(), [rule5, rule7]);
    expect(analysis.conviction).toBe(5); // lowest wins
  });

  test("most conservative recommendation wins", () => {
    const ruleHalten: GuardrailRule = {
      id: "H",
      scope: "data_quality",
      severity: "warning",
      description: "Set Halten",
      condition: () => true,
      apply: () => ({
        id: "H",
        scope: "data_quality",
        severity: "warning",
        issueType: "weak_data_quality",
        message: "Halten",
        patch: { recommendation: "Halten" },
      }),
    };
    const ruleLK: GuardrailRule = {
      id: "LK",
      scope: "data_quality",
      severity: "warning",
      description: "Set Leicht kaufen",
      condition: () => true,
      apply: () => ({
        id: "LK",
        scope: "data_quality",
        severity: "warning",
        issueType: "weak_data_quality",
        message: "Leicht kaufen",
        patch: { recommendation: "Leicht kaufen" },
      }),
    };
    // ruleHalten fires first; its "Halten" patch is applied
    // ruleLK then runs against the patched state: moreConservative("Halten", "Leicht kaufen")
    // → "Halten" (lower rank) wins
    const { analysis } = runGuardrailEngine(makeAnalysis({ recommendation: "Kaufen" }), makeContext(), [ruleHalten, ruleLK]);
    expect(analysis.recommendation).toBe("Halten");
  });

  test("removeTarget=true wins (once null, stays null)", () => {
    const removeRule: GuardrailRule = {
      id: "R",
      scope: "data_quality",
      severity: "warning",
      description: "Remove target",
      condition: () => true,
      apply: () => ({
        id: "R",
        scope: "data_quality",
        severity: "warning",
        issueType: "weak_data_quality",
        message: "remove",
        patch: { removeTarget: true },
      }),
    };
    const { analysis } = runGuardrailEngine(makeAnalysis(), makeContext(), [removeRule]);
    expect(analysis.price_levels?.target).toBeNull();
  });

  test("valuationDivergence=null wins once set", () => {
    const nullDivRule: GuardrailRule = {
      id: "ND",
      scope: "valuation",
      severity: "warning",
      description: "Null divergence",
      condition: () => true,
      apply: () => ({
        id: "ND",
        scope: "valuation",
        severity: "warning",
        issueType: "divergence_unavailable",
        message: "null div",
        patch: { valuationDivergence: null },
      }),
    };
    const analysis = makeAnalysis({
      valuation_divergence: {
        status: "available",
        baseGapPct: 10,
        gapLabel: "consensus_more_bullish",
        explanationSeed: "test",
        warnings: [],
      },
    });
    const { analysis: result } = runGuardrailEngine(analysis, makeContext(), [nullDivRule]);
    expect(result.valuation_divergence).toBeNull();
  });
});

// ─── G1: Analyst claims without consensus ────────────────────────────────────

describe("G1_AnalystClaimsWithoutConsensus", () => {
  test("fires when no consensus and analyst claims present", () => {
    const analysis = makeAnalysis({
      claims: [{ claim: "c", evidence: "e", source_type: "analyst", confidence: 8 }],
    });
    const ctx = makeContext({ hasAnalystConsensus: false });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G1_AnalystClaimsWithoutConsensus]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G1");
    expect(result.claims[0].confidence).toBe(4); // capped
    expect(result.data_quality_guardrails[0]).toMatch(/Analyst-Claim/);
  });

  test("does not fire when consensus exists", () => {
    const analysis = makeAnalysis({
      claims: [{ claim: "c", evidence: "e", source_type: "analyst", confidence: 8 }],
    });
    const ctx = makeContext({ hasAnalystConsensus: true });
    const { fired } = runGuardrailEngine(analysis, ctx, [G1_AnalystClaimsWithoutConsensus]);
    expect(fired).toHaveLength(0);
  });

  test("does not fire when no analyst claims", () => {
    const analysis = makeAnalysis({
      claims: [{ claim: "c", evidence: "e", source_type: "metrics", confidence: 8 }],
    });
    const ctx = makeContext({ hasAnalystConsensus: false });
    const { fired } = runGuardrailEngine(analysis, ctx, [G1_AnalystClaimsWithoutConsensus]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G2: News price targets ───────────────────────────────────────────────────

describe("G2_NewsPriceTargetUnverified", () => {
  test("fires when news claim contains price target ($xxx)", () => {
    const analysis = makeAnalysis({
      claims: [{ claim: "Analyst sieht Kursziel $250", evidence: "Reuters", source_type: "news", confidence: 7 }],
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [G2_NewsPriceTargetUnverified]);
    expect(fired).toHaveLength(1);
    expect(result.claims[0].evidence).toMatch(/\[News-Kursziel, unverified\]/);
  });

  test("fires for 'Kursziel 450 USD' pattern", () => {
    const analysis = makeAnalysis({
      claims: [{ claim: "Kursziel 450 USD gesetzt", evidence: "Bloomberg", source_type: "news", confidence: 7 }],
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G2_NewsPriceTargetUnverified]);
    expect(fired).toHaveLength(1);
  });

  test("does not fire for news claims without price targets", () => {
    const analysis = makeAnalysis({
      claims: [{ claim: "Umsatz gestiegen", evidence: "News", source_type: "news", confidence: 7 }],
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G2_NewsPriceTargetUnverified]);
    expect(fired).toHaveLength(0);
  });

  test("does not re-prefix already-prefixed evidence (idempotent)", () => {
    const analysis = makeAnalysis({
      claims: [{
        claim: "Ziel $200",
        evidence: "[News-Kursziel, unverified] Original evidence",
        source_type: "news",
        confidence: 7,
      }],
    });
    const { analysis: result } = runGuardrailEngine(analysis, makeContext(), [G2_NewsPriceTargetUnverified]);
    // Should not add the prefix twice
    expect(result.claims[0].evidence.indexOf("[News-Kursziel, unverified]")).toBe(0);
    expect(result.claims[0].evidence.indexOf("[News-Kursziel, unverified]", 1)).toBe(-1);
  });

  test("does not fire for non-news claims with price target", () => {
    const analysis = makeAnalysis({
      claims: [{ claim: "Kursziel $300", evidence: "SEC filing", source_type: "metrics", confidence: 7 }],
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G2_NewsPriceTargetUnverified]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G3: Consensus/model mixing ───────────────────────────────────────────────

describe("G3_ConsensusModelMixing", () => {
  test("fires when consensus and model share identical base value", () => {
    const ctx = makeContext({ hasAnalystConsensus: true, hasOwnModel: true, analystConsensusBase: 120, ownModelBase: 120 });
    const { fired, analysis: result } = runGuardrailEngine(makeAnalysis(), ctx, [G3_ConsensusModelMixing]);
    expect(fired).toHaveLength(1);
    expect(result.data_quality_guardrails).toContain(
      "Analystenkonsens und eigenes Modell haben identischen Basiswert — möglicherweise vermischt.",
    );
  });

  test("does not fire when values differ", () => {
    const ctx = makeContext({ analystConsensusBase: 120, ownModelBase: 110 });
    const { fired } = runGuardrailEngine(makeAnalysis(), ctx, [G3_ConsensusModelMixing]);
    expect(fired).toHaveLength(0);
  });

  test("does not fire when one base is null", () => {
    const ctx = makeContext({ analystConsensusBase: null, ownModelBase: 120 });
    const { fired } = runGuardrailEngine(makeAnalysis(), ctx, [G3_ConsensusModelMixing]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G4: Divergence without own model ────────────────────────────────────────

describe("G4_DivergenceWithoutOwnModel", () => {
  test("fires when divergence status=available but no own model", () => {
    const analysis = makeAnalysis({
      valuation_divergence: {
        status: "available",
        baseGapPct: 15,
        gapLabel: "consensus_more_bullish",
        explanationSeed: "seed",
        warnings: [],
      },
    });
    const ctx = makeContext({ hasOwnModel: false });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G4_DivergenceWithoutOwnModel]);
    expect(fired).toHaveLength(1);
    expect(result.valuation_divergence).toBeNull();
  });

  test("does not fire when own model exists", () => {
    const analysis = makeAnalysis({
      valuation_divergence: {
        status: "available",
        baseGapPct: 15,
        gapLabel: "consensus_more_bullish",
        explanationSeed: "seed",
        warnings: [],
      },
    });
    const ctx = makeContext({ hasOwnModel: true });
    const { fired } = runGuardrailEngine(analysis, ctx, [G4_DivergenceWithoutOwnModel]);
    expect(fired).toHaveLength(0);
  });

  test("does not fire when status is not 'available'", () => {
    const analysis = makeAnalysis({
      valuation_divergence: {
        status: "missing_own_model",
        explanationSeed: "seed",
        warnings: [],
      },
    });
    const ctx = makeContext({ hasOwnModel: false });
    const { fired } = runGuardrailEngine(analysis, ctx, [G4_DivergenceWithoutOwnModel]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G5a: Weak data basis ─────────────────────────────────────────────────────

describe("G5a_WeakDataBasis", () => {
  test("completeness < 40: downgrades Kaufen → Halten, caps conviction to 5", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", conviction: 8 });
    const ctx = makeContext({ dataQualityScore: 35 });
    const { analysis: result } = runGuardrailEngine(analysis, ctx, [G5a_WeakDataBasis]);
    expect(result.recommendation).toBe("Halten");
    expect(result.conviction).toBe(5);
    expect(result.data_quality_guardrails[0]).toMatch(/kritisch lückenhaft/);
  });

  test("completeness < 40: downgrades Leicht kaufen → Halten", () => {
    const analysis = makeAnalysis({ recommendation: "Leicht kaufen", conviction: 7 });
    const ctx = makeContext({ dataQualityScore: 35 });
    const { analysis: result } = runGuardrailEngine(analysis, ctx, [G5a_WeakDataBasis]);
    expect(result.recommendation).toBe("Halten");
    expect(result.conviction).toBe(5);
  });

  test("completeness < 40: caps conviction even if rec already Halten (no message)", () => {
    const analysis = makeAnalysis({ recommendation: "Halten", conviction: 7 });
    const ctx = makeContext({ dataQualityScore: 35 });
    const { analysis: result, fired } = runGuardrailEngine(analysis, ctx, [G5a_WeakDataBasis]);
    expect(result.conviction).toBe(5);
    expect(result.recommendation).toBe("Halten"); // unchanged
    expect(fired).toHaveLength(1);
    // No guardrail message for recommendation (it wasn't changed)
    expect(result.data_quality_guardrails).toHaveLength(0);
  });

  test("completeness 40–49: downgrades Kaufen → Leicht kaufen, caps to 6", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", conviction: 8 });
    const ctx = makeContext({ dataQualityScore: 45 });
    const { analysis: result } = runGuardrailEngine(analysis, ctx, [G5a_WeakDataBasis]);
    expect(result.recommendation).toBe("Leicht kaufen");
    expect(result.conviction).toBe(6);
  });

  test("completeness 40–49: does not change Halten (only caps conviction)", () => {
    const analysis = makeAnalysis({ recommendation: "Halten", conviction: 8 });
    const ctx = makeContext({ dataQualityScore: 45 });
    const { analysis: result } = runGuardrailEngine(analysis, ctx, [G5a_WeakDataBasis]);
    expect(result.recommendation).toBe("Halten");
    expect(result.conviction).toBe(6);
  });

  test("completeness >= 50: does not fire", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", conviction: 9 });
    const ctx = makeContext({ dataQualityScore: 55 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G5a_WeakDataBasis]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G5b: Low confidence target ──────────────────────────────────────────────

describe("G5b_LowConfidenceTarget", () => {
  test("fires when model confidence is low and target exists", () => {
    const analysis = makeAnalysis({ valuation_confidence: "low" });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [G5b_LowConfidenceTarget]);
    expect(fired).toHaveLength(1);
    expect(result.price_levels?.target).toBeNull();
    expect(result.data_quality_guardrails[0]).toMatch(/Präzises Kursziel entfernt/);
  });

  test("fires when completeness < 55 and target exists", () => {
    const ctx = makeContext({ dataQualityScore: 50 });
    const { fired, analysis: result } = runGuardrailEngine(makeAnalysis(), ctx, [G5b_LowConfidenceTarget]);
    expect(fired).toHaveLength(1);
    expect(result.price_levels?.target).toBeNull();
  });

  test("does not fire when target is already null", () => {
    const analysis = makeAnalysis({
      price_levels: { entry: 100, target: null, stop_loss: 90, entry_rationale: "r", target_rationale: "r" },
      valuation_confidence: "low",
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G5b_LowConfidenceTarget]);
    expect(fired).toHaveLength(0);
  });

  test("does not fire when confidence=medium and completeness >= 55", () => {
    const analysis = makeAnalysis({ valuation_confidence: "medium" });
    const ctx = makeContext({ dataQualityScore: 60 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G5b_LowConfidenceTarget]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G6: Entry quality mismatch ──────────────────────────────────────────────

describe("G6_EntryQualityMismatch", () => {
  test("fires when Halten + attraktiv + no undervaluation evidence", () => {
    const analysis = makeAnalysis({
      recommendation: "Halten",
      entry_quality: { label: "attraktiv", rationale: "günstig." },
      valuation_confidence: "medium",
      price_levels: { entry: 100, target: 130, stop_loss: 90, entry_rationale: "r", target_rationale: "r" },
    });
    const ctx = makeContext({ hasOwnModel: false, ownModelBase: null, dataQualityScore: 70 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G6_EntryQualityMismatch]);
    expect(fired).toHaveLength(1);
    expect(result.entry_quality?.label).toBe("fair");
  });

  test("does NOT fire when Halten + attraktiv + clear undervaluation (modelBase > entry * 1.15)", () => {
    const analysis = makeAnalysis({
      recommendation: "Halten",
      entry_quality: { label: "attraktiv", rationale: "klar unterbewertet." },
      valuation_confidence: "medium",
      price_levels: { entry: 100, target: null, stop_loss: 90, entry_rationale: "r", target_rationale: "r" },
    });
    // modelBase = 120, entry = 100 → 120 > 100 * 1.15 = 115 → clear undervaluation
    const ctx = makeContext({ hasOwnModel: true, ownModelBase: 120, dataQualityScore: 65 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G6_EntryQualityMismatch]);
    // G6 fires (condition met: Halten + attraktiv) but apply() returns info (no patch)
    const patching = fired.find(r => r.id === "G6" && r.patch?.entryQuality);
    expect(patching).toBeUndefined();
    expect(result.entry_quality?.label).toBe("attraktiv"); // unchanged
  });

  test("does not fire when recommendation is Kaufen", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", entry_quality: { label: "attraktiv", rationale: "r" } });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G6_EntryQualityMismatch]);
    const g6 = fired.find(r => r.id === "G6");
    expect(g6).toBeUndefined();
  });

  test("fires when Leicht verkaufen + attraktiv (no model)", () => {
    const analysis = makeAnalysis({
      recommendation: "Leicht verkaufen",
      entry_quality: { label: "attraktiv", rationale: "r" },
    });
    const ctx = makeContext({ hasOwnModel: false, ownModelBase: null, dataQualityScore: 70 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G6_EntryQualityMismatch]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G6");
  });

  test("G6 sees G5a's patched recommendation (sequential execution)", () => {
    // G5a fires first (completeness 35, Kaufen → Halten)
    // Then G6 checks if the patched Halten + attraktiv combination triggers
    const analysis = makeAnalysis({
      recommendation: "Kaufen",  // G5a will change to Halten
      entry_quality: { label: "attraktiv", rationale: "r" },
    });
    const ctx = makeContext({
      dataQualityScore: 35,
      hasOwnModel: false,
      ownModelBase: null,
    });
    const { analysis: result, fired } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    expect(ids).toContain("G5a"); // downgrades to Halten
    expect(ids).toContain("G6");  // then catches the Halten+attraktiv combination
    expect(result.recommendation).toBe("Halten");
    expect(result.entry_quality?.label).toBe("fair");
  });
});

// ─── Integration: ALL_LIGHTWEIGHT_RULES ──────────────────────────────────────

describe("ALL_LIGHTWEIGHT_RULES — integration", () => {
  test("clean analysis with good data: no rules fire", () => {
    const analysis = makeAnalysis();
    const ctx = makeContext({ dataQualityScore: 80 });
    const { fired } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    expect(fired).toHaveLength(0);
  });

  test("output format matches legacy runLightweightGuardrails expectations", () => {
    const analysis = makeAnalysis({ conviction: 9 });
    const ctx = makeContext({ dataQualityScore: 35 }); // G5a fires
    const { analysis: result } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    // All expected output fields must be present
    expect(typeof result.recommendation).toBe("string");
    expect(typeof result.conviction).toBe("number");
    expect(Array.isArray(result.claims)).toBe(true);
    expect(Array.isArray(result.data_quality_guardrails)).toBe(true);
  });

  test("SECTOR_RULES is empty (Phase 1 placeholder)", () => {
    const { SECTOR_RULES } = require("../guardrails/sector/index");
    expect(Array.isArray(SECTOR_RULES)).toBe(true);
    expect(SECTOR_RULES).toHaveLength(0);
  });

  test("no VERA calls in engine (structural: rules are synchronous plain functions)", () => {
    // All rules must return synchronously (no async/Promise). Verified by:
    //   1. condition() must return a plain boolean (not a thenable)
    //   2. apply() must return GuardrailResult | null (not a thenable)
    for (const rule of ALL_LIGHTWEIGHT_RULES) {
      const ctx = makeContext();
      const analysis = makeAnalysis();
      const condResult = rule.condition(ctx, analysis);
      expect(typeof condResult).toBe("boolean");
      if (condResult) {
        const applyResult = rule.apply(ctx, analysis);
        // Must not be a Promise (check for thenable)
        const isThenable =
          applyResult != null &&
          typeof (applyResult as unknown as { then?: unknown }).then === "function";
        expect(isThenable).toBe(false);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2 — Global Research Guardrails (G7–G16)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Engine: new patch semantics ─────────────────────────────────────────────

describe("runGuardrailEngine — Phase 2 patch semantics", () => {
  test("recommendationExact overrides conservative merge (Verkaufen → Leicht verkaufen)", () => {
    // Conservative merge would keep "Verkaufen" when patching toward "Leicht verkaufen".
    // recommendationExact forces the exact value regardless.
    const exactRule: GuardrailRule = {
      id: "EXACT",
      scope: "global",
      severity: "warning",
      description: "Force Leicht verkaufen via recommendationExact",
      condition: () => true,
      apply: () => ({
        id: "EXACT",
        scope: "global",
        severity: "warning",
        issueType: "recommendation_unsupported",
        message: "exact",
        patch: { recommendationExact: "Leicht verkaufen" },
      }),
    };
    const { analysis } = runGuardrailEngine(
      makeAnalysis({ recommendation: "Verkaufen" }),
      makeContext(),
      [exactRule],
    );
    expect(analysis.recommendation).toBe("Leicht verkaufen");
  });

  test("recommendationExact is applied AFTER conservative recommendation patch", () => {
    // Rule A: conservative patch → Halten
    // Rule B: recommendationExact → Leicht verkaufen
    // Result: Leicht verkaufen (exact wins last)
    const conservativeRule: GuardrailRule = {
      id: "CONS",
      scope: "global",
      severity: "warning",
      description: "Set Halten conservatively",
      condition: () => true,
      apply: () => ({
        id: "CONS",
        scope: "global",
        severity: "warning",
        issueType: "weak_data_quality",
        message: "halten",
        patch: { recommendation: "Halten" },
      }),
    };
    const exactRule: GuardrailRule = {
      id: "EXACT",
      scope: "global",
      severity: "warning",
      description: "Force Leicht verkaufen",
      condition: () => true,
      apply: () => ({
        id: "EXACT",
        scope: "global",
        severity: "warning",
        issueType: "recommendation_unsupported",
        message: "exact",
        patch: { recommendationExact: "Leicht verkaufen" },
      }),
    };
    const { analysis } = runGuardrailEngine(
      makeAnalysis({ recommendation: "Kaufen" }),
      makeContext(),
      [conservativeRule, exactRule],
    );
    expect(analysis.recommendation).toBe("Leicht verkaufen");
  });

  test("claimCapByPattern caps only matching claims, not all claims of that type", () => {
    const patternRule: GuardrailRule = {
      id: "PAT",
      scope: "research",
      severity: "info",
      description: "Cap inference claims with % pattern",
      condition: () => true,
      apply: () => ({
        id: "PAT",
        scope: "research",
        severity: "info",
        issueType: "unsupported_claim",
        message: "pattern cap",
        patch: {
          claimCapByPattern: {
            sourceType: "inference",
            pattern: String.raw`\d+\s*%`,
            cap: 5,
          },
        },
      }),
    };
    const analysis = makeAnalysis({
      claims: [
        { claim: "Upside 30%", evidence: "Modellschätzung", source_type: "inference", confidence: 8 },
        { claim: "Starke Marke", evidence: "Marktposition", source_type: "inference", confidence: 7 },
        { claim: "$250 Ziel", evidence: "Analystenschätzung", source_type: "metrics", confidence: 8 },
      ],
    });
    const { analysis: result } = runGuardrailEngine(analysis, makeContext(), [patternRule]);
    expect(result.claims[0].confidence).toBe(5);  // matches pattern → capped
    expect(result.claims[1].confidence).toBe(7);  // no % → unchanged
    expect(result.claims[2].confidence).toBe(8);  // metrics → unchanged
  });
});

// ─── G7: No strong recommendation without support ────────────────────────────

describe("G7_NoStrongRecommendationWithoutSupport", () => {
  // Test 1: "Kaufen" without model and dq < 60 → "Leicht kaufen", conviction ≤ 6
  test("Kaufen without own model and dq < 60 → Leicht kaufen, conviction ≤ 6", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", conviction: 8 });
    const ctx = makeContext({ hasOwnModel: false, dataQualityScore: 55 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G7_NoStrongRecommendationWithoutSupport]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G7");
    expect(result.recommendation).toBe("Leicht kaufen");
    expect(result.conviction).toBeLessThanOrEqual(6);
    expect(result.data_quality_guardrails[0]).toMatch(/abgeschwächt/);
  });

  // Test 2: "Verkaufen" without model support → "Leicht verkaufen", conviction ≤ 6
  test("Verkaufen without model support → Leicht verkaufen, conviction ≤ 6", () => {
    const analysis = makeAnalysis({ recommendation: "Verkaufen", conviction: 7 });
    const ctx = makeContext({ hasOwnModel: false, dataQualityScore: 65 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G7_NoStrongRecommendationWithoutSupport]);
    expect(fired).toHaveLength(1);
    expect(result.recommendation).toBe("Leicht verkaufen");
    expect(result.conviction).toBeLessThanOrEqual(6);
  });

  test("Kaufen with modelConf=low → downgraded", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", valuation_confidence: "low" });
    const ctx = makeContext({ hasOwnModel: true, dataQualityScore: 70 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G7_NoStrongRecommendationWithoutSupport]);
    expect(fired).toHaveLength(1);
    expect(result.recommendation).toBe("Leicht kaufen");
  });

  test("Kaufen with dq 50–59 (G5a does NOT fire) → G7 fires", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", conviction: 8 });
    const ctx = makeContext({ hasOwnModel: true, dataQualityScore: 55, ownModelBase: 140 });
    // valuation_confidence defaults to "medium" in makeAnalysis, dq=55 < 60 → G7 fires
    const { fired } = runGuardrailEngine(analysis, ctx, [G7_NoStrongRecommendationWithoutSupport]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G7");
  });

  test("Kaufen fully supported (own model + high conf + dq >= 60) → does NOT fire", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", valuation_confidence: "high" });
    const ctx = makeContext({ hasOwnModel: true, dataQualityScore: 75 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G7_NoStrongRecommendationWithoutSupport]);
    expect(fired).toHaveLength(0);
  });

  test("Halten recommendation: G7 does NOT fire (only fires for Kaufen/Verkaufen)", () => {
    const analysis = makeAnalysis({ recommendation: "Halten" });
    const ctx = makeContext({ hasOwnModel: false, dataQualityScore: 50 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G7_NoStrongRecommendationWithoutSupport]);
    expect(fired).toHaveLength(0);
  });

  test("G7 does not fire for Kaufen when G5a already downgraded it (sequential order)", () => {
    // G5a fires (dq=35, Kaufen→Halten), then G7 sees "Halten" → does NOT fire
    const analysis = makeAnalysis({ recommendation: "Kaufen", conviction: 8 });
    const ctx = makeContext({ hasOwnModel: false, dataQualityScore: 35 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    expect(ids).toContain("G5a");
    expect(ids).not.toContain("G7"); // G7 skipped — G5a already downgraded past "Kaufen"
    expect(result.recommendation).toBe("Halten");
  });
});

// ─── G8: No pseudo-precision with wide scenario range ────────────────────────

describe("G8_NoPseudoPrecisionWithWideRange", () => {
  // Test 3: Wide range → target removed, conviction capped
  test("wide spread (>60% of base) removes target and caps conviction to 7", () => {
    // bear=80, base=200, bull=240 → spread=(240-80)/200=0.8 > 0.6
    const analysis = makeAnalysis({ conviction: 9 });
    const ctx = makeContext({
      hasOwnModel: true,
      ownModelBase: 200,
      modelBear: 80,
      modelBull: 240,
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G8_NoPseudoPrecisionWithWideRange]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G8");
    expect(result.price_levels?.target).toBeNull();
    expect(result.conviction).toBe(7);
    expect(result.data_quality_guardrails[0]).toMatch(/Szenario-Spanne/);
  });

  test("bull/bear > 2 triggers even with narrower absolute spread", () => {
    // bear=50, base=120, bull=120 → ratio=120/50=2.4 > 2.0
    const analysis = makeAnalysis({ conviction: 8 });
    const ctx = makeContext({
      hasOwnModel: true,
      ownModelBase: 120,
      modelBear: 50,
      modelBull: 120,
    });
    const { fired } = runGuardrailEngine(analysis, ctx, [G8_NoPseudoPrecisionWithWideRange]);
    expect(fired).toHaveLength(1);
  });

  test("narrow range (spread = 30%) does NOT fire", () => {
    // bear=170, base=200, bull=230 → spread=(230-170)/200=0.3 ≤ 0.6
    const ctx = makeContext({
      hasOwnModel: true,
      ownModelBase: 200,
      modelBear: 170,
      modelBull: 230,
    });
    const { fired } = runGuardrailEngine(makeAnalysis(), ctx, [G8_NoPseudoPrecisionWithWideRange]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire when own model is absent", () => {
    const ctx = makeContext({
      hasOwnModel: false,
      ownModelBase: null,
      modelBear: 80,
      modelBull: 300,
    });
    const { fired } = runGuardrailEngine(makeAnalysis(), ctx, [G8_NoPseudoPrecisionWithWideRange]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire when scenario values are null", () => {
    const ctx = makeContext({
      hasOwnModel: true,
      ownModelBase: 200,
      modelBear: null,
      modelBull: null,
    });
    const { fired } = runGuardrailEngine(makeAnalysis(), ctx, [G8_NoPseudoPrecisionWithWideRange]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G9: Low confidence model limits valuation claims ────────────────────────

describe("G9_LowConfidenceModelLimitsValuationClaims", () => {
  // Test 4: modelConf=low → target removed + conviction capped
  test("own model with modelConf=low → removes target and caps conviction to 6", () => {
    const analysis = makeAnalysis({ valuation_confidence: "low", conviction: 8 });
    const ctx = makeContext({ hasOwnModel: true });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G9_LowConfidenceModelLimitsValuationClaims]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G9");
    expect(result.price_levels?.target).toBeNull();
    expect(result.conviction).toBe(6);
    expect(result.data_quality_guardrails[0]).toMatch(/Konfidenz/);
  });

  test("does NOT fire when model confidence is medium", () => {
    const analysis = makeAnalysis({ valuation_confidence: "medium" });
    const ctx = makeContext({ hasOwnModel: true });
    const { fired } = runGuardrailEngine(analysis, ctx, [G9_LowConfidenceModelLimitsValuationClaims]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire when model is absent (even if confidence is low)", () => {
    const analysis = makeAnalysis({ valuation_confidence: "low" });
    const ctx = makeContext({ hasOwnModel: false });
    const { fired } = runGuardrailEngine(analysis, ctx, [G9_LowConfidenceModelLimitsValuationClaims]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G10: Missing own model limits valuation ownership claims ─────────────────

describe("G10_MissingOwnModelLimitsValuationClaims", () => {
  // Test 5: Valuation ownership claim without model → unsupported_claim prefix
  test("inference claim with 'unterbewertet' without model → evidence prefixed", () => {
    const analysis = makeAnalysis({
      claims: [{
        claim: "Aktie ist stark unterbewertet",
        evidence: "KGV deutlich unter Sektor",
        source_type: "inference",
        confidence: 7,
      }],
    });
    const ctx = makeContext({ hasOwnModel: false });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G10_MissingOwnModelLimitsValuationClaims]);
    expect(fired).toHaveLength(1);
    expect(fired[0].issueType).toBe("unsupported_claim");
    expect(result.claims[0].evidence).toContain("[Kein eigenes Modell");
  });

  test("inference claim with 'fair value' without model → marked unsupported", () => {
    const analysis = makeAnalysis({
      claims: [{
        claim: "Fair Value liegt bei 180 USD",
        evidence: "Basierend auf Peer-Vergleich",
        source_type: "inference",
        confidence: 6,
      }],
    });
    const ctx = makeContext({ hasOwnModel: false });
    const { fired } = runGuardrailEngine(analysis, ctx, [G10_MissingOwnModelLimitsValuationClaims]);
    expect(fired).toHaveLength(1);
  });

  test("does NOT fire when own model is present", () => {
    const analysis = makeAnalysis({
      claims: [{
        claim: "Aktie ist unterbewertet",
        evidence: "Modell zeigt 20% Upside",
        source_type: "inference",
        confidence: 7,
      }],
    });
    const ctx = makeContext({ hasOwnModel: true });
    const { fired } = runGuardrailEngine(analysis, ctx, [G10_MissingOwnModelLimitsValuationClaims]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire for non-valuation inference claims (no keywords)", () => {
    const analysis = makeAnalysis({
      claims: [{
        claim: "Management ist erfahren",
        evidence: "CEO seit 10 Jahren im Amt",
        source_type: "inference",
        confidence: 6,
      }],
    });
    const ctx = makeContext({ hasOwnModel: false });
    const { fired } = runGuardrailEngine(analysis, ctx, [G10_MissingOwnModelLimitsValuationClaims]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire for non-inference source types", () => {
    const analysis = makeAnalysis({
      claims: [{
        claim: "Aktie ist unterbewertet",
        evidence: "KGV 12x vs. Sektor 18x",
        source_type: "metrics",
        confidence: 7,
      }],
    });
    const ctx = makeContext({ hasOwnModel: false });
    const { fired } = runGuardrailEngine(analysis, ctx, [G10_MissingOwnModelLimitsValuationClaims]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G11: Unclear source for numerical claim ─────────────────────────────────

describe("G11_UnclearSourceForNumericalClaim", () => {
  // Test 6: Numerical inference claim → confidence capped to ≤ 5
  test("inference claim with percentage → confidence capped to ≤ 5", () => {
    const analysis = makeAnalysis({
      claims: [
        { claim: "Upside-Potenzial von 35%", evidence: "Trendeinschätzung", source_type: "inference", confidence: 8 },
        { claim: "Solide Marktstellung", evidence: "Keine Zahlen", source_type: "inference", confidence: 7 },
      ],
    });
    const ctx = makeContext();
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G11_UnclearSourceForNumericalClaim]);
    expect(fired).toHaveLength(1);
    expect(result.claims[0].confidence).toBe(5);  // capped (had %)
    expect(result.claims[1].confidence).toBe(7);  // unchanged (no numbers)
  });

  test("inference claim with USD price → confidence capped", () => {
    const analysis = makeAnalysis({
      claims: [{
        claim: "Ziel bei 200 USD realistisch",
        evidence: "Bewertung basierend auf Multiplikatoren",
        source_type: "inference",
        confidence: 7,
      }],
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [G11_UnclearSourceForNumericalClaim]);
    expect(fired).toHaveLength(1);
    expect(result.claims[0].confidence).toBe(5);
  });

  test("does NOT fire when inference claim already has confidence ≤ 5", () => {
    const analysis = makeAnalysis({
      claims: [{ claim: "Upside 20%", evidence: "Grobe Schätzung", source_type: "inference", confidence: 5 }],
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G11_UnclearSourceForNumericalClaim]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT cap non-inference claims with numbers", () => {
    const analysis = makeAnalysis({
      claims: [{ claim: "Umsatz +15% YoY", evidence: "Q3-Report", source_type: "metrics", confidence: 9 }],
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [G11_UnclearSourceForNumericalClaim]);
    expect(fired).toHaveLength(0);
    expect(result.claims[0].confidence).toBe(9); // unchanged
  });
});

// ─── G12: Recommendation/conviction consistency ───────────────────────────────

describe("G12_RecommendationConvictionConsistency", () => {
  // Test 7: "Halten" with conviction 9 → capped to 7
  test("Halten with conviction 9 → capped to 7", () => {
    const analysis = makeAnalysis({ recommendation: "Halten", conviction: 9 });
    const ctx = makeContext({ dataQualityScore: 75 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G12_RecommendationConvictionConsistency]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G12");
    expect(result.conviction).toBe(7);
    expect(result.data_quality_guardrails[0]).toMatch(/Halten/);
  });

  // Test 8: dq < 55 → conviction capped to 6
  test("dataQualityScore 50 (< 55) with conviction 8 → capped to 6", () => {
    const analysis = makeAnalysis({ recommendation: "Leicht kaufen", conviction: 8 });
    const ctx = makeContext({ dataQualityScore: 50 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G12_RecommendationConvictionConsistency]);
    expect(fired).toHaveLength(1);
    expect(result.conviction).toBe(6);
    expect(result.data_quality_guardrails[0]).toMatch(/Datenbasis/);
  });

  test("Leicht kaufen with conviction 9 → capped to 8", () => {
    const analysis = makeAnalysis({ recommendation: "Leicht kaufen", conviction: 9 });
    const ctx = makeContext({ dataQualityScore: 75 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G12_RecommendationConvictionConsistency]);
    expect(fired).toHaveLength(1);
    expect(result.conviction).toBe(8);
  });

  test("Leicht verkaufen with conviction 9 → capped to 8", () => {
    const analysis = makeAnalysis({ recommendation: "Leicht verkaufen", conviction: 9 });
    const ctx = makeContext({ dataQualityScore: 80 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G12_RecommendationConvictionConsistency]);
    expect(fired).toHaveLength(1);
    expect(result.conviction).toBe(8);
  });

  test("modelConf=low with conviction 8 → capped to 6", () => {
    const analysis = makeAnalysis({ valuation_confidence: "low", conviction: 8 });
    const ctx = makeContext({ dataQualityScore: 80 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G12_RecommendationConvictionConsistency]);
    expect(fired).toHaveLength(1);
    expect(result.conviction).toBe(6);
  });

  test("multiple conditions: takes the most restrictive cap", () => {
    // Halten (→ cap 7) AND dq < 55 (→ cap 6) → min = 6
    const analysis = makeAnalysis({ recommendation: "Halten", conviction: 9 });
    const ctx = makeContext({ dataQualityScore: 50 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G12_RecommendationConvictionConsistency]);
    expect(fired).toHaveLength(1);
    expect(result.conviction).toBe(6);
  });

  test("does NOT fire when conviction is already within limits", () => {
    // Halten + conviction 7 → exactly at limit, should not fire
    const analysis = makeAnalysis({ recommendation: "Halten", conviction: 7 });
    const ctx = makeContext({ dataQualityScore: 80 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G12_RecommendationConvictionConsistency]);
    expect(fired).toHaveLength(0);
  });

  test("Kaufen with conviction 8 and good data: does NOT fire (no cap for Kaufen)", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", conviction: 8, valuation_confidence: "medium" });
    const ctx = makeContext({ dataQualityScore: 80 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G12_RecommendationConvictionConsistency]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G13: Entry quality bearish mismatch ────────────────────────────────────

describe("G13_EntryQualityBearishMismatch", () => {
  // Test 9: Sell recommendation + "attraktiv" → bearish entry label
  test("Verkaufen + attraktiv → Rücksetzer abwarten", () => {
    const analysis = makeAnalysis({
      recommendation: "Verkaufen",
      entry_quality: { label: "attraktiv", rationale: "KGV niedrig." },
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [G13_EntryQualityBearishMismatch]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G13");
    expect(result.entry_quality?.label).toBe("Rücksetzer abwarten");
    expect(result.data_quality_guardrails[0]).toMatch(/korrigiert/);
  });

  test("Leicht verkaufen + attraktiv → nicht hinterherrennen", () => {
    const analysis = makeAnalysis({
      recommendation: "Leicht verkaufen",
      entry_quality: { label: "attraktiv", rationale: "Einstieg günstig." },
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [G13_EntryQualityBearishMismatch]);
    expect(fired).toHaveLength(1);
    expect(result.entry_quality?.label).toBe("nicht hinterherrennen");
  });

  test("Leicht verkaufen + fair → nicht hinterherrennen (fair also contradicts sell)", () => {
    const analysis = makeAnalysis({
      recommendation: "Leicht verkaufen",
      entry_quality: { label: "fair", rationale: "Kurs fair bewertet." },
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [G13_EntryQualityBearishMismatch]);
    expect(fired).toHaveLength(1);
    expect(result.entry_quality?.label).toBe("nicht hinterherrennen");
  });

  test("G6 patches Halten+attraktiv to fair; G13 then catches the residual sell case", () => {
    // After G6 patches Leicht verkaufen+attraktiv→fair, G13 further corrects fair→nicht hinterherrennen
    const analysis = makeAnalysis({
      recommendation: "Leicht verkaufen",
      entry_quality: { label: "attraktiv", rationale: "r" },
    });
    const ctx = makeContext({ hasOwnModel: false, ownModelBase: null, dataQualityScore: 70 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    expect(ids).toContain("G6");   // G6 fires first: attraktiv → fair
    expect(ids).toContain("G13");  // G13 fires after: fair → nicht hinterherrennen
    expect(result.entry_quality?.label).toBe("nicht hinterherrennen");
  });

  test("does NOT fire for Kaufen + attraktiv (G13 only handles sell)", () => {
    const analysis = makeAnalysis({ recommendation: "Kaufen", entry_quality: { label: "attraktiv", rationale: "r" } });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G13_EntryQualityBearishMismatch]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire for Halten + attraktiv (G6 handles that case)", () => {
    const analysis = makeAnalysis({ recommendation: "Halten", entry_quality: { label: "attraktiv", rationale: "r" } });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G13_EntryQualityBearishMismatch]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire for sell recommendation with already-corrected entry label", () => {
    const analysis = makeAnalysis({
      recommendation: "Verkaufen",
      entry_quality: { label: "Rücksetzer abwarten", rationale: "r" },
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G13_EntryQualityBearishMismatch]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G14: News sentiment cannot override weak valuation alone ─────────────────

describe("G14_NewsSentimentCannotOverrideWeakValuationAlone", () => {
  // Test 10: Positive news sentiment alone → no strong buy recommendation
  test("Kaufen driven by news (>50% news claims, no model/consensus, dq < 70) → Leicht kaufen", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      conviction: 7,
      claims: [
        { claim: "Positive Headline", evidence: "Reuters", source_type: "news", confidence: 6 },
        { claim: "CEO bullish", evidence: "CNBC Interview", source_type: "news", confidence: 5 },
        { claim: "Sektor Momentum", evidence: "Bloomberg", source_type: "news", confidence: 6 },
        { claim: "Cashflow positiv", evidence: "SEC Filing", source_type: "metrics", confidence: 7 },
      ],
    });
    const ctx = makeContext({
      hasOwnModel: false,
      hasAnalystConsensus: false,
      dataQualityScore: 60,
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G14_NewsSentimentCannotOverrideWeakValuationAlone]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G14");
    expect(result.recommendation).toBe("Leicht kaufen");
    expect(result.conviction).toBeLessThanOrEqual(6);
  });

  test("does NOT fire when own model exists (even if news-heavy)", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      claims: [
        { claim: "News1", evidence: "e", source_type: "news", confidence: 6 },
        { claim: "News2", evidence: "e", source_type: "news", confidence: 6 },
        { claim: "News3", evidence: "e", source_type: "news", confidence: 6 },
      ],
    });
    const ctx = makeContext({ hasOwnModel: true, dataQualityScore: 60 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G14_NewsSentimentCannotOverrideWeakValuationAlone]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire when analyst consensus exists", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      claims: [
        { claim: "News1", evidence: "e", source_type: "news", confidence: 6 },
        { claim: "News2", evidence: "e", source_type: "news", confidence: 6 },
        { claim: "News3", evidence: "e", source_type: "news", confidence: 6 },
      ],
    });
    const ctx = makeContext({ hasOwnModel: false, hasAnalystConsensus: true, dataQualityScore: 55 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G14_NewsSentimentCannotOverrideWeakValuationAlone]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire when dq >= 70", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      claims: [
        { claim: "News1", evidence: "e", source_type: "news", confidence: 6 },
        { claim: "News2", evidence: "e", source_type: "news", confidence: 6 },
        { claim: "News3", evidence: "e", source_type: "news", confidence: 6 },
      ],
    });
    const ctx = makeContext({ hasOwnModel: false, hasAnalystConsensus: false, dataQualityScore: 72 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G14_NewsSentimentCannotOverrideWeakValuationAlone]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire when news claims do not dominate (<=50%)", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      claims: [
        { claim: "News", evidence: "e", source_type: "news", confidence: 6 },
        { claim: "Metrics", evidence: "e", source_type: "metrics", confidence: 7 },
        { claim: "Analyse", evidence: "e", source_type: "inference", confidence: 6 },
      ],
    });
    const ctx = makeContext({ hasOwnModel: false, hasAnalystConsensus: false, dataQualityScore: 60 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G14_NewsSentimentCannotOverrideWeakValuationAlone]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G15: Technical timing cannot override fundamental uncertainty ────────────

describe("G15_TechnicalTimingCannotOverrideFundamentalUncertainty", () => {
  // Test 11: Technical timing alone (>50% market_intel claims) with weak fundamentals → cap
  test("Kaufen with >50% market_intel claims and no own model → downgraded", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      conviction: 7,
      claims: [
        { claim: "RSI überverkauft", evidence: "RSI=28", source_type: "market_intel", confidence: 6 },
        { claim: "Über MA200", evidence: "+5% über MA200", source_type: "market_intel", confidence: 6 },
        { claim: "Momentum positiv", evidence: "MA50 steigt", source_type: "market_intel", confidence: 5 },
        { claim: "Umsatz stieg", evidence: "Q3 Report", source_type: "metrics", confidence: 7 },
      ],
    });
    const ctx = makeContext({ hasOwnModel: false, dataQualityScore: 55 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [G15_TechnicalTimingCannotOverrideFundamentalUncertainty]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G15");
    expect(result.conviction).toBeLessThanOrEqual(6);
    expect(result.data_quality_guardrails[0]).toMatch(/Technisch/);
  });

  test("Kaufen with market_intel dominance but own model present and dq >= 60 → does NOT fire", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      claims: [
        { claim: "RSI günstig", evidence: "e", source_type: "market_intel", confidence: 6 },
        { claim: "Trend", evidence: "e", source_type: "market_intel", confidence: 6 },
        { claim: "Momentum", evidence: "e", source_type: "market_intel", confidence: 6 },
      ],
    });
    const ctx = makeContext({ hasOwnModel: true, dataQualityScore: 65 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G15_TechnicalTimingCannotOverrideFundamentalUncertainty]);
    expect(fired).toHaveLength(0);
  });

  test("does NOT fire for Verkaufen (G15 only handles buy signals)", () => {
    const analysis = makeAnalysis({
      recommendation: "Verkaufen",
      claims: [
        { claim: "RSI", evidence: "e", source_type: "market_intel", confidence: 6 },
        { claim: "MA", evidence: "e", source_type: "market_intel", confidence: 6 },
        { claim: "Momentum", evidence: "e", source_type: "market_intel", confidence: 6 },
      ],
    });
    const ctx = makeContext({ hasOwnModel: false, dataQualityScore: 50 });
    const { fired } = runGuardrailEngine(analysis, ctx, [G15_TechnicalTimingCannotOverrideFundamentalUncertainty]);
    expect(fired).toHaveLength(0);
  });
});

// ─── G16: Extreme divergence requires explanation ────────────────────────────

describe("G16_ExtremeDivergenceRequiresExplanation", () => {
  // Test 12: |gap| >= 40% → warning + conviction capped (if not high confidence)
  test("|gap| >= 40% with medium confidence → warning + conviction capped to 7", () => {
    const analysis = makeAnalysis({
      valuation_divergence: {
        status: "available",
        baseGapPct: 45,
        gapLabel: "consensus_more_bullish",
        explanationSeed: "Konsens +45% bullischer als eigenes Modell.",
        warnings: [],
      },
      valuation_confidence: "medium",
      conviction: 9,
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [G16_ExtremeDivergenceRequiresExplanation]);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe("G16");
    expect(result.conviction).toBe(7);
    expect(result.data_quality_guardrails[0]).toMatch(/Extreme Divergenz/);
    expect(result.data_quality_guardrails[0]).toMatch(/\+45/);
  });

  test("|gap| >= 40% with HIGH confidence → warning only, conviction NOT capped", () => {
    const analysis = makeAnalysis({
      valuation_divergence: {
        status: "available",
        baseGapPct: -50,
        gapLabel: "own_model_more_bullish",
        explanationSeed: "seed",
        warnings: [],
      },
      valuation_confidence: "high",
      conviction: 9,
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [G16_ExtremeDivergenceRequiresExplanation]);
    expect(fired).toHaveLength(1);
    expect(result.conviction).toBe(9);  // NOT capped — high confidence
    expect(result.data_quality_guardrails[0]).toMatch(/Extreme Divergenz/);
  });

  test("|gap| = 39% → does NOT fire (threshold is strictly >= 40)", () => {
    const analysis = makeAnalysis({
      valuation_divergence: {
        status: "available",
        baseGapPct: 39,
        gapLabel: "consensus_more_bullish",
        explanationSeed: "seed",
        warnings: [],
      },
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G16_ExtremeDivergenceRequiresExplanation]);
    expect(fired).toHaveLength(0);
  });

  test("divergence status != 'available' → does NOT fire", () => {
    const analysis = makeAnalysis({
      valuation_divergence: {
        status: "missing_own_model",
        explanationSeed: "seed",
        warnings: [],
      },
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G16_ExtremeDivergenceRequiresExplanation]);
    expect(fired).toHaveLength(0);
  });

  test("divergence null → does NOT fire", () => {
    const analysis = makeAnalysis({ valuation_divergence: null });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [G16_ExtremeDivergenceRequiresExplanation]);
    expect(fired).toHaveLength(0);
  });
});

// ─── Phase 2 integration ─────────────────────────────────────────────────────

describe("Phase 2 integration — ALL_LIGHTWEIGHT_RULES", () => {
  // Test 13: Phase 1 guardrails function unchanged
  test("Phase 1 rules still fire correctly in full Phase 2 rule set", () => {
    // Setup that should trigger exactly G1 and G5a from Phase 1
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      conviction: 8,
      claims: [{ claim: "Analyst sieht Upside", evidence: "Konsensschätzung", source_type: "analyst", confidence: 8 }],
    });
    const ctx = makeContext({ hasAnalystConsensus: false, dataQualityScore: 35 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    // Phase 1 rules fire
    expect(ids).toContain("G1");   // analyst claims without consensus
    expect(ids).toContain("G5a");  // weak data basis
    // Phase 1 effects still apply
    expect(result.claims[0].confidence).toBe(4); // G1 capped
    expect(result.recommendation).toBe("Halten"); // G5a downgraded
    expect(result.conviction).toBe(5);            // G5a capped
    // G7 does NOT fire because G5a already downgraded Kaufen → Halten
    expect(ids).not.toContain("G7");
  });

  test("no rules fire for clean analysis with strong support", () => {
    // All conditions met: own model, good conf, good data, matching conviction, no extreme divergence
    const analysis = makeAnalysis({
      recommendation: "Leicht kaufen",
      conviction: 7,
      valuation_confidence: "medium",
      entry_quality: { label: "fair", rationale: "Moderat bewertet." },
      claims: [
        { claim: "Solides Wachstum", evidence: "Revenue +12% YoY", source_type: "metrics", confidence: 8 },
        { claim: "Konsens positiv", evidence: "Konsens: Kaufen", source_type: "analyst", confidence: 7 },
      ],
    });
    const ctx = makeContext({
      dataQualityScore: 75,
      hasOwnModel: true,
      hasAnalystConsensus: true,
      ownModelBase: 130,
      modelBear: 115,
      modelBull: 145,
    });
    const { fired } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    expect(fired).toHaveLength(0);
  });

  test("Phase 2 rules are all synchronous (no LLM/VERA calls)", () => {
    const phase2Rules = ALL_LIGHTWEIGHT_RULES.filter(r =>
      ["G7","G8","G9","G10","G11","G12","G13","G14","G15","G16"].includes(r.id),
    );
    expect(phase2Rules).toHaveLength(10);

    const ctx = makeContext();
    const analysis = makeAnalysis();
    const start = Date.now();
    for (const rule of phase2Rules) {
      rule.condition(ctx, analysis);
    }
    expect(Date.now() - start).toBeLessThan(20);
  });

  test("G12 runs after G7 and sees the patched recommendation", () => {
    // G7 fires: Kaufen (no model) → Leicht kaufen, convictionMax=6
    // G12 then checks: Leicht kaufen + conviction=6 → ≤ 8? Yes → does NOT fire
    const analysis = makeAnalysis({ recommendation: "Kaufen", conviction: 7 });
    const ctx = makeContext({ hasOwnModel: false, dataQualityScore: 65 });
    const { fired } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    expect(ids).toContain("G7"); // G7 fires
    expect(ids).not.toContain("G12"); // G12 does NOT fire (G7 already capped to 6)
  });

  test("G7 + G16 can both fire — independent rules", () => {
    // G7: Kaufen with poor data quality (dq=55 < 60) → Leicht kaufen
    // G16: extreme divergence (gap=50% ≥ 40%) → warning + conviction cap to 7
    // IMPORTANT: hasOwnModel=true so G4 does NOT fire and null out the divergence first
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      conviction: 8,
      valuation_confidence: "medium",
      valuation_divergence: {
        status: "available",
        baseGapPct: 50,
        gapLabel: "consensus_more_bullish",
        explanationSeed: "seed",
        warnings: [],
      },
    });
    const ctx = makeContext({
      hasOwnModel: true,       // keeps G4 from firing (G4 fires only when hasOwnModel=false)
      dataQualityScore: 55,   // dq=55 < 60 → G7 fires
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    expect(ids).toContain("G7");
    expect(ids).toContain("G16");
    expect(ids).not.toContain("G4"); // G4 must NOT have fired (would null divergence)
    expect(result.recommendation).toBe("Leicht kaufen"); // G7 patch
    expect(result.conviction).toBe(6); // G7 caps to 6, G16 caps to 7 → min wins = 6
    expect(result.data_quality_guardrails.some(w => w.includes("Divergenz"))).toBe(true);
  });
});

// ─── Helpers for Phase 3 ──────────────────────────────────────────────────────

/** Full DivergenceResult with all required fields for Phase 3 tests. */
function makeAvailableDivergence(overrides: {
  baseGapPct?: number;
  gapLabel?: "aligned" | "consensus_more_bullish" | "own_model_more_bullish";
  consensusUpsidePct?: number;
  ownModelUpsidePct?: number;
} = {}) {
  return {
    status: "available" as const,
    baseGapPct: overrides.baseGapPct ?? 10,
    gapLabel: overrides.gapLabel ?? "consensus_more_bullish",
    consensusUpsidePct: overrides.consensusUpsidePct ?? 20,
    ownModelUpsidePct: overrides.ownModelUpsidePct ?? 10,
    explanationSeed: "Consensus +20% vs model +10%",
    warnings: [],
  };
}

// ─── V1: Extreme divergence with high confidence but weak data ────────────────

describe("V1_ExtremeDivergenceRequiresInterpretation", () => {
  test("fires when |gap|≥40, high conf, dq=70 (< 75) → cap to 7", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "high",
      valuation_divergence: makeAvailableDivergence({ baseGapPct: 45, gapLabel: "consensus_more_bullish" }),
    });
    const ctx = makeContext({ dataQualityScore: 70 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [V1_ExtremeDivergenceRequiresInterpretation]);
    expect(fired.map(r => r.id)).toContain("V1");
    expect(result.conviction).toBe(7);
  });

  test("does NOT fire when |gap|≥40 but modelConf=medium (G16 handles it, V1 is the high-conf incremental case)", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "medium",
      valuation_divergence: makeAvailableDivergence({ baseGapPct: 45 }),
    });
    const ctx = makeContext({ dataQualityScore: 70 });
    const { fired } = runGuardrailEngine(analysis, ctx, [V1_ExtremeDivergenceRequiresInterpretation]);
    expect(fired.map(r => r.id)).not.toContain("V1");
  });

  test("does NOT fire when high conf and dq=80 (≥75) — both conditions met, no cap needed", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "high",
      valuation_divergence: makeAvailableDivergence({ baseGapPct: 45 }),
    });
    const ctx = makeContext({ dataQualityScore: 80 });
    const { fired } = runGuardrailEngine(analysis, ctx, [V1_ExtremeDivergenceRequiresInterpretation]);
    expect(fired.map(r => r.id)).not.toContain("V1");
  });

  test("does NOT fire when |gap|=38 (below 40 threshold)", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "high",
      valuation_divergence: makeAvailableDivergence({ baseGapPct: 38 }),
    });
    const ctx = makeContext({ dataQualityScore: 60 });
    const { fired } = runGuardrailEngine(analysis, ctx, [V1_ExtremeDivergenceRequiresInterpretation]);
    expect(fired.map(r => r.id)).not.toContain("V1");
  });
});

// ─── V2: Conservative model disclaimer ───────────────────────────────────────

describe("V2_ConservativeModelDisclaimer", () => {
  test("fires when ownModelUpsidePct=-30 (≤-25) → informational warning added", () => {
    const analysis = makeAnalysis({
      valuation_divergence: makeAvailableDivergence({ ownModelUpsidePct: -30 }),
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [V2_ConservativeModelDisclaimer]);
    expect(fired.map(r => r.id)).toContain("V2");
    expect(result.data_quality_guardrails.some(w => w.includes("Überbewertung"))).toBe(true);
    // informational only — no structural mutations
    expect(result.conviction).toBe(8);
    expect(result.recommendation).toBe("Kaufen");
  });

  test("does NOT fire when ownModelUpsidePct=-20 (> -25)", () => {
    const analysis = makeAnalysis({
      valuation_divergence: makeAvailableDivergence({ ownModelUpsidePct: -20 }),
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V2_ConservativeModelDisclaimer]);
    expect(fired.map(r => r.id)).not.toContain("V2");
  });

  test("does NOT fire when div.status is not 'available'", () => {
    const analysis = makeAnalysis({
      valuation_divergence: { status: "missing_own_model", explanationSeed: "...", warnings: [] },
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V2_ConservativeModelDisclaimer]);
    expect(fired.map(r => r.id)).not.toContain("V2");
  });
});

// ─── V3: Bull/bear undercalibration ──────────────────────────────────────────

describe("V3_BullBearUndercalibration", () => {
  test("fires when modelBull < analystConsensusBear → warning + convictionMax=7", () => {
    const analysis = makeAnalysis({ conviction: 9 });
    const ctx = makeContext({ modelBull: 100, analystConsensusBear: 120 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [V3_BullBearUndercalibration]);
    expect(fired.map(r => r.id)).toContain("V3");
    expect(result.conviction).toBe(7);
    expect(result.data_quality_guardrails.some(w => w.includes("Kalibrierungslücke"))).toBe(true);
  });

  test("does NOT fire when modelBull ≥ analystConsensusBear", () => {
    const ctx = makeContext({ modelBull: 130, analystConsensusBear: 100 });
    const { fired } = runGuardrailEngine(makeAnalysis(), ctx, [V3_BullBearUndercalibration]);
    expect(fired.map(r => r.id)).not.toContain("V3");
  });

  test("does NOT fire when either value is null (cannot compare)", () => {
    const ctxNullBull = makeContext({ modelBull: null, analystConsensusBear: 120 });
    const { fired: f1 } = runGuardrailEngine(makeAnalysis(), ctxNullBull, [V3_BullBearUndercalibration]);
    expect(f1.map(r => r.id)).not.toContain("V3");

    const ctxNullBear = makeContext({ modelBull: 90, analystConsensusBear: null });
    const { fired: f2 } = runGuardrailEngine(makeAnalysis(), ctxNullBear, [V3_BullBearUndercalibration]);
    expect(f2.map(r => r.id)).not.toContain("V3");
  });
});

// ─── V4: Consensus auto-upside guard ─────────────────────────────────────────

describe("V4_ConsensusAutoUpsideGuard", () => {
  test("fires: consensus_more_bullish + gap≥25 + Kaufen + ownModelUpside≤0 → Leicht kaufen + cap=6", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      conviction: 8,
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "consensus_more_bullish",
        baseGapPct: 30,
        ownModelUpsidePct: -5,
        consensusUpsidePct: 25,
      }),
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [V4_ConsensusAutoUpsideGuard]);
    expect(fired.map(r => r.id)).toContain("V4");
    expect(result.recommendation).toBe("Leicht kaufen");
    expect(result.conviction).toBe(6);
  });

  test("does NOT fire when ownModelUpsidePct=+5 (own model shows upside)", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "consensus_more_bullish",
        baseGapPct: 30,
        ownModelUpsidePct: 5,
      }),
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V4_ConsensusAutoUpsideGuard]);
    expect(fired.map(r => r.id)).not.toContain("V4");
  });

  test("does NOT fire when rec=Leicht kaufen (already moderated)", () => {
    const analysis = makeAnalysis({
      recommendation: "Leicht kaufen",
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "consensus_more_bullish",
        baseGapPct: 30,
        ownModelUpsidePct: -5,
      }),
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V4_ConsensusAutoUpsideGuard]);
    expect(fired.map(r => r.id)).not.toContain("V4");
  });

  test("does NOT fire when gap=20 (< 25 threshold)", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "consensus_more_bullish",
        baseGapPct: 20,
        ownModelUpsidePct: -5,
      }),
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V4_ConsensusAutoUpsideGuard]);
    expect(fired.map(r => r.id)).not.toContain("V4");
  });
});

// ─── V5: Own model divergence caution ────────────────────────────────────────

describe("V5_OwnModelDivergenceCaution", () => {
  test("fires when own_model_more_bullish + |gap|=30 + medium conf → warning + cap=7", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "medium",
      conviction: 9,
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "own_model_more_bullish",
        baseGapPct: -30,
        ownModelUpsidePct: 40,
        consensusUpsidePct: 10,
      }),
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [V5_OwnModelDivergenceCaution]);
    expect(fired.map(r => r.id)).toContain("V5");
    expect(result.conviction).toBe(7);
  });

  test("fires when high conf but dq=60 (< 75) → still caps", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "high",
      conviction: 9,
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "own_model_more_bullish",
        baseGapPct: -30,
      }),
    });
    const ctx = makeContext({ dataQualityScore: 60 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [V5_OwnModelDivergenceCaution]);
    expect(fired.map(r => r.id)).toContain("V5");
    expect(result.conviction).toBe(7);
  });

  test("does NOT fire when high conf AND dq=80 (≥75) — well-supported case", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "high",
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "own_model_more_bullish",
        baseGapPct: -30,
      }),
    });
    const ctx = makeContext({ dataQualityScore: 80 });
    const { fired } = runGuardrailEngine(analysis, ctx, [V5_OwnModelDivergenceCaution]);
    expect(fired.map(r => r.id)).not.toContain("V5");
  });

  test("does NOT fire when |gap|=20 (< 25 threshold)", () => {
    const analysis = makeAnalysis({
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "own_model_more_bullish",
        baseGapPct: -20,
      }),
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V5_OwnModelDivergenceCaution]);
    expect(fired.map(r => r.id)).not.toContain("V5");
  });
});

// ─── V6: Missing current price ────────────────────────────────────────────────

describe("V6_MissingCurrentPrice", () => {
  test("fires when currentPrice=null and divergence is not null → nullifies divergence", () => {
    const analysis = makeAnalysis({
      valuation_divergence: makeAvailableDivergence(),
    });
    const ctx = makeContext({ currentPrice: null });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [V6_MissingCurrentPrice]);
    expect(fired.map(r => r.id)).toContain("V6");
    expect(result.valuation_divergence).toBeNull();
  });

  test("fires when currentPrice=0 → nullifies divergence", () => {
    const analysis = makeAnalysis({
      valuation_divergence: makeAvailableDivergence(),
    });
    const ctx = makeContext({ currentPrice: 0 });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [V6_MissingCurrentPrice]);
    expect(fired.map(r => r.id)).toContain("V6");
    expect(result.valuation_divergence).toBeNull();
  });

  test("does NOT fire when divergence is already null", () => {
    const analysis = makeAnalysis({ valuation_divergence: null });
    const ctx = makeContext({ currentPrice: null });
    const { fired } = runGuardrailEngine(analysis, ctx, [V6_MissingCurrentPrice]);
    expect(fired.map(r => r.id)).not.toContain("V6");
  });

  test("does NOT fire when currentPrice=150 (valid)", () => {
    const analysis = makeAnalysis({ valuation_divergence: makeAvailableDivergence() });
    const ctx = makeContext({ currentPrice: 150 });
    const { fired } = runGuardrailEngine(analysis, ctx, [V6_MissingCurrentPrice]);
    expect(fired.map(r => r.id)).not.toContain("V6");
  });
});

// ─── V7: Low confidence divergence ───────────────────────────────────────────

describe("V7_LowConfidenceDivergence", () => {
  test("fires when div.status=available and modelConf=low → warning + convictionMax=6", () => {
    const analysis = makeAnalysis({
      conviction: 8,
      valuation_confidence: "low",
      valuation_divergence: makeAvailableDivergence(),
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [V7_LowConfidenceDivergence]);
    expect(fired.map(r => r.id)).toContain("V7");
    expect(result.conviction).toBe(6);
  });

  test("does NOT fire when modelConf=medium", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "medium",
      valuation_divergence: makeAvailableDivergence(),
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V7_LowConfidenceDivergence]);
    expect(fired.map(r => r.id)).not.toContain("V7");
  });

  test("does NOT fire when div.status=missing_own_model", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "low",
      valuation_divergence: { status: "missing_own_model", explanationSeed: "...", warnings: [] },
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V7_LowConfidenceDivergence]);
    expect(fired.map(r => r.id)).not.toContain("V7");
  });
});

// ─── V8: Consensus-only valuation ────────────────────────────────────────────

describe("V8_ConsensusOnlyValuation", () => {
  test("fires when hasAnalystConsensus=true and hasOwnModel=false → informational warning", () => {
    const ctx = makeContext({ hasAnalystConsensus: true, hasOwnModel: false });
    const { fired, analysis: result } = runGuardrailEngine(makeAnalysis(), ctx, [V8_ConsensusOnlyValuation]);
    expect(fired.map(r => r.id)).toContain("V8");
    expect(result.data_quality_guardrails.some(w => w.includes("Analystenkonsens"))).toBe(true);
    // informational — no structural mutations
    expect(result.conviction).toBe(8);
  });

  test("does NOT fire when both model and consensus present", () => {
    const { fired } = runGuardrailEngine(makeAnalysis(), makeContext(), [V8_ConsensusOnlyValuation]);
    expect(fired.map(r => r.id)).not.toContain("V8");
  });
});

// ─── V9: Own model only valuation ────────────────────────────────────────────

describe("V9_OwnModelOnlyValuation", () => {
  test("fires when hasOwnModel=true and hasAnalystConsensus=false → informational warning", () => {
    const ctx = makeContext({ hasOwnModel: true, hasAnalystConsensus: false });
    const { fired, analysis: result } = runGuardrailEngine(makeAnalysis(), ctx, [V9_OwnModelOnlyValuation]);
    expect(fired.map(r => r.id)).toContain("V9");
    expect(result.data_quality_guardrails.some(w => w.includes("Modell"))).toBe(true);
    expect(result.conviction).toBe(8);
  });

  test("does NOT fire when both model and consensus present", () => {
    const { fired } = runGuardrailEngine(makeAnalysis(), makeContext(), [V9_OwnModelOnlyValuation]);
    expect(fired.map(r => r.id)).not.toContain("V9");
  });
});

// ─── V10: Scenario ordering invalid ──────────────────────────────────────────

describe("V10_ScenarioOrderingInvalid", () => {
  test("fires when modelBear > modelBase → removeTarget + convictionMax=5 + setValuationConfidenceLow + null divergence", () => {
    const analysis = makeAnalysis({
      conviction: 8,
      valuation_confidence: "medium",
      price_levels: { entry: 100, target: 130, stop_loss: 90, entry_rationale: "", target_rationale: "" },
      valuation_divergence: makeAvailableDivergence(),
    });
    const ctx = makeContext({
      modelBear: 150,   // bear > base → invalid
      ownModelBase: 100,
      modelBull: 200,
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [V10_ScenarioOrderingInvalid]);
    expect(fired.map(r => r.id)).toContain("V10");
    expect(result.price_levels?.target).toBeNull();
    expect(result.conviction).toBe(5);
    expect(result.valuation_confidence).toBe("low");
    expect(result.valuation_divergence).toBeNull();
  });

  test("fires when consensusBull < consensusBase → same reset", () => {
    const analysis = makeAnalysis({ conviction: 8 });
    const ctx = makeContext({
      analystConsensusBear: 90,
      analystConsensusBase: 120,
      analystConsensusBull: 100, // bull < base → invalid
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, [V10_ScenarioOrderingInvalid]);
    expect(fired.map(r => r.id)).toContain("V10");
    expect(result.conviction).toBe(5);
    expect(result.valuation_confidence).toBe("low");
  });

  test("does NOT fire when bear ≤ base ≤ bull (valid ordering)", () => {
    const ctx = makeContext({
      modelBear: 80,
      ownModelBase: 100,
      modelBull: 130,
      analystConsensusBear: 100,
      analystConsensusBase: 120,
      analystConsensusBull: 150,
    });
    const { fired } = runGuardrailEngine(makeAnalysis(), ctx, [V10_ScenarioOrderingInvalid]);
    expect(fired.map(r => r.id)).not.toContain("V10");
  });

  test("does NOT fire when values are null (incomplete range — cannot validate)", () => {
    const ctx = makeContext({
      modelBear: null,
      ownModelBase: 100,
      modelBull: 130,
    });
    const { fired } = runGuardrailEngine(makeAnalysis(), ctx, [V10_ScenarioOrderingInvalid]);
    expect(fired.map(r => r.id)).not.toContain("V10");
  });

  test("V10 fires → V12 does NOT fire (divergence nullified)", () => {
    const analysis = makeAnalysis({
      conviction: 8,
      valuation_divergence: makeAvailableDivergence({
        consensusUpsidePct: 20,
        ownModelUpsidePct: 10,
      }),
    });
    const ctx = makeContext({
      modelBear: 150,   // invalid
      ownModelBase: 100,
      modelBull: 200,
    });
    const { fired } = runGuardrailEngine(analysis, ctx, [V10_ScenarioOrderingInvalid, V12_DivergenceLanguageGermanTemplate]);
    const ids = fired.map(r => r.id);
    expect(ids).toContain("V10");
    expect(ids).not.toContain("V12"); // divergence was nullified by V10
  });
});

// ─── V11: Extreme upside/downside ─────────────────────────────────────────────

describe("V11_ExtremeUpsideDownside", () => {
  test("fires when ownModelUpsidePct=80 (≥75) → warning + convictionMax=7", () => {
    const analysis = makeAnalysis({
      conviction: 9,
      valuation_divergence: makeAvailableDivergence({ ownModelUpsidePct: 80, consensusUpsidePct: 30 }),
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [V11_ExtremeUpsideDownside]);
    expect(fired.map(r => r.id)).toContain("V11");
    expect(result.conviction).toBe(7);
  });

  test("fires when consensusUpsidePct=-80 (|value|≥75) → warning + cap=7", () => {
    const analysis = makeAnalysis({
      conviction: 9,
      valuation_divergence: makeAvailableDivergence({ ownModelUpsidePct: 10, consensusUpsidePct: -80 }),
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [V11_ExtremeUpsideDownside]);
    expect(fired.map(r => r.id)).toContain("V11");
    expect(result.conviction).toBe(7);
  });

  test("does NOT fire when both upsides < 75", () => {
    const analysis = makeAnalysis({
      valuation_divergence: makeAvailableDivergence({ ownModelUpsidePct: 30, consensusUpsidePct: 20 }),
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V11_ExtremeUpsideDownside]);
    expect(fired.map(r => r.id)).not.toContain("V11");
  });
});

// ─── V12: German divergence template ─────────────────────────────────────────

describe("V12_DivergenceLanguageGermanTemplate", () => {
  test("fires when gapLabel=consensus_more_bullish → German text contains 'optimistischer'", () => {
    const analysis = makeAnalysis({
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "consensus_more_bullish",
        baseGapPct: 15,
        consensusUpsidePct: 25,
        ownModelUpsidePct: 10,
      }),
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [V12_DivergenceLanguageGermanTemplate]);
    expect(fired.map(r => r.id)).toContain("V12");
    expect(result.data_quality_guardrails.some(w => w.includes("optimistischer"))).toBe(true);
    expect(result.data_quality_guardrails.some(w => w.includes("Bewertungsüberblick"))).toBe(true);
  });

  test("fires when gapLabel=aligned → German text contains 'übereinstimmend'", () => {
    const analysis = makeAnalysis({
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "aligned",
        baseGapPct: 2,
        consensusUpsidePct: 15,
        ownModelUpsidePct: 13,
      }),
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, makeContext(), [V12_DivergenceLanguageGermanTemplate]);
    expect(fired.map(r => r.id)).toContain("V12");
    expect(result.data_quality_guardrails.some(w => w.includes("übereinstimmend"))).toBe(true);
  });

  test("does NOT fire when div.status=missing_own_model (no upside numbers)", () => {
    const analysis = makeAnalysis({
      valuation_divergence: { status: "missing_own_model", explanationSeed: "...", warnings: [] },
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V12_DivergenceLanguageGermanTemplate]);
    expect(fired.map(r => r.id)).not.toContain("V12");
  });

  test("does NOT fire when upsidePct values are missing (partial divergence data)", () => {
    // No consensusUpsidePct / ownModelUpsidePct set
    const analysis = makeAnalysis({
      valuation_divergence: {
        status: "available",
        baseGapPct: 10,
        gapLabel: "consensus_more_bullish",
        explanationSeed: "seed",
        warnings: [],
        // consensusUpsidePct and ownModelUpsidePct intentionally absent
      },
    });
    const { fired } = runGuardrailEngine(analysis, makeContext(), [V12_DivergenceLanguageGermanTemplate]);
    expect(fired.map(r => r.id)).not.toContain("V12");
  });
});

// ─── Phase 3 integration — ALL_LIGHTWEIGHT_RULES ────────────────────────────

describe("Phase 3 integration — ALL_LIGHTWEIGHT_RULES", () => {
  test("Broadcom-like: extreme divergence (consensus bullish, own model conservative) → V rules fire", () => {
    // Broadcom: consensus ~+50% upside, own model ~0% (very conservative), gap ~50pp
    // G16 fires (|gap|≥40, medium conf → caps to 7)
    // V5 does NOT fire (consensus_more_bullish, not own_model_more_bullish)
    // V4 fires (consensus_more_bullish + gap≥25 + Kaufen + ownModelUpside≤0)
    // V12 fires (adds German template)
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      conviction: 9,
      valuation_confidence: "medium",
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "consensus_more_bullish",
        baseGapPct: 50,
        consensusUpsidePct: 55,
        ownModelUpsidePct: 5,  // own model shows slight upside, so V4 doesn't fire (ownModelUpside > 0)
      }),
    });
    const ctx = makeContext({
      hasOwnModel: true,
      hasAnalystConsensus: true,
      dataQualityScore: 70,
      currentPrice: 100,
    });
    const { fired } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    // G16 fires for extreme divergence
    expect(ids).toContain("G16");
    // V12 adds German template
    expect(ids).toContain("V12");
    // V4 does NOT fire (ownModelUpsidePct=5 > 0)
    expect(ids).not.toContain("V4");
  });

  test("V4 fires for Broadcom when own model shows no upside", () => {
    const analysis = makeAnalysis({
      recommendation: "Kaufen",
      conviction: 9,
      valuation_confidence: "medium",
      valuation_divergence: makeAvailableDivergence({
        gapLabel: "consensus_more_bullish",
        baseGapPct: 50,
        consensusUpsidePct: 50,
        ownModelUpsidePct: -2,  // own model shows negative upside → V4 fires
      }),
    });
    const ctx = makeContext({
      hasOwnModel: true,
      hasAnalystConsensus: true,
      dataQualityScore: 70,
      currentPrice: 100,
    });
    const { fired, analysis: result } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    expect(ids).toContain("V4");
    expect(result.recommendation).toBe("Leicht kaufen");
  });

  test("V6 fires (missing price) → divergence nullified → V1/V7/V12 do NOT fire", () => {
    const analysis = makeAnalysis({
      valuation_confidence: "high",
      valuation_divergence: makeAvailableDivergence({
        baseGapPct: 45,
        consensusUpsidePct: 50,
        ownModelUpsidePct: 5,
      }),
    });
    const ctx = makeContext({ currentPrice: null });
    const { fired } = runGuardrailEngine(analysis, ctx, ALL_LIGHTWEIGHT_RULES);
    const ids = fired.map(r => r.id);
    expect(ids).toContain("V6");    // safety net fires
    expect(ids).not.toContain("V1");  // needs div.status=available
    expect(ids).not.toContain("V7");  // needs div.status=available
    expect(ids).not.toContain("V12"); // needs div.status=available with upside numbers
  });

  test("Phase 3 rules are all synchronous (no LLM/VERA calls)", () => {
    const analysis = makeAnalysis({
      valuation_divergence: makeAvailableDivergence({
        consensusUpsidePct: 20,
        ownModelUpsidePct: 10,
      }),
    });
    const start = Date.now();
    runGuardrailEngine(analysis, makeContext(), ALL_LIGHTWEIGHT_RULES);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // synchronous → completes in < 100ms
  });

  test("V8 fires for consensus-only analysis, V9 for model-only, V12 only when both available", () => {
    // Consensus only
    const ctxConsensusOnly = makeContext({ hasAnalystConsensus: true, hasOwnModel: false });
    const analysisNoDiv = makeAnalysis({ valuation_divergence: null });
    const { fired: f1 } = runGuardrailEngine(analysisNoDiv, ctxConsensusOnly, ALL_LIGHTWEIGHT_RULES);
    expect(f1.map(r => r.id)).toContain("V8");
    expect(f1.map(r => r.id)).not.toContain("V9");

    // Model only
    const ctxModelOnly = makeContext({ hasOwnModel: true, hasAnalystConsensus: false });
    const { fired: f2 } = runGuardrailEngine(analysisNoDiv, ctxModelOnly, ALL_LIGHTWEIGHT_RULES);
    expect(f2.map(r => r.id)).toContain("V9");
    expect(f2.map(r => r.id)).not.toContain("V8");
    // V12 needs div.status=available with upside numbers → not present here
    expect(f2.map(r => r.id)).not.toContain("V12");
  });
});
