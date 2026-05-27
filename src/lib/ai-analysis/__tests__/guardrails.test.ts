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
    // All rules must return synchronously. If any returns a Promise, this fails.
    for (const rule of ALL_LIGHTWEIGHT_RULES) {
      const ctx = makeContext();
      const analysis = makeAnalysis();
      const condResult = rule.condition(ctx, analysis);
      expect(condResult instanceof Promise).toBe(false);
      if (condResult) {
        const applyResult = rule.apply(ctx, analysis);
        expect(applyResult instanceof Promise).toBe(false);
      }
    }
  });
});
