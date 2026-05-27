/**
 * Tests für synthesis-validator.ts
 * Stufe 1b: Structured Output Validation + Repair
 */

// ─── Mocks ─────────────────────────────────────────────────────────────────
// jest.mock is hoisted before variable declarations. We get the mock create fn
// via jest.requireMock after the mock is registered.

jest.mock("@anthropic-ai/sdk", () => {
  const mockCreateFn = jest.fn();
  return {
    __esModule: true,
    __mockCreate: mockCreateFn,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreateFn },
    })),
  };
});

// ─── Imports ────────────────────────────────────────────────────────────────

import {
  normalizeRecommendation,
  stripMarkdownCodeBlock,
  parseAndExtractJSON,
  validateSynthesisOutput,
  validateAndRepairSynthesis,
  deterministicMinimalFallback,
  SynthesisValidationSchema,
} from "../synthesis-validator";
import { z } from "zod";

// Access the shared mock create function via requireMock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate: jest.Mock = (jest.requireMock("@anthropic-ai/sdk") as any).__mockCreate;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeValidSynthesis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recommendation: "Halten",
    conviction: 6,
    summary: "Eine solide Aktie mit moderatem Wachstumspotenzial.",
    bull_case: ["Starkes Umsatzwachstum", "Gute FCF-Generierung"],
    bear_case: ["Hohes KGV", "Wachstumsverlangsamung möglich"],
    growth_outlook: "Mittelfristig positiv bei stabilen Marktbedingungen.",
    ...overrides,
  };
}

function makeHaikuResponse(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

// ─── normalizeRecommendation ─────────────────────────────────────────────────

describe("normalizeRecommendation", () => {
  it('maps "buy" (lowercase) to "Kaufen"', () => {
    expect(normalizeRecommendation("buy")).toBe("Kaufen");
  });

  it('maps "Buy" (capitalized) to "Kaufen"', () => {
    expect(normalizeRecommendation("Buy")).toBe("Kaufen");
  });

  it('maps "BUY" (uppercase) to "Kaufen"', () => {
    expect(normalizeRecommendation("BUY")).toBe("Kaufen");
  });

  it('maps "hold" to "Halten"', () => {
    expect(normalizeRecommendation("hold")).toBe("Halten");
  });

  it('maps "neutral" to "Halten"', () => {
    expect(normalizeRecommendation("neutral")).toBe("Halten");
  });

  it('maps "sell" to "Verkaufen"', () => {
    expect(normalizeRecommendation("sell")).toBe("Verkaufen");
  });

  it('maps "strong buy" to "Kaufen"', () => {
    expect(normalizeRecommendation("strong buy")).toBe("Kaufen");
  });

  it('maps "strong sell" to "Verkaufen"', () => {
    expect(normalizeRecommendation("strong sell")).toBe("Verkaufen");
  });

  it('maps already valid "Kaufen" to "Kaufen"', () => {
    expect(normalizeRecommendation("Kaufen")).toBe("Kaufen");
  });

  it('maps already valid "Leicht kaufen" to "Leicht kaufen"', () => {
    expect(normalizeRecommendation("Leicht kaufen")).toBe("Leicht kaufen");
  });

  it('returns "Halten" for unknown value', () => {
    expect(normalizeRecommendation("outperform")).toBe("Halten");
  });

  it('returns "Halten" for non-string input', () => {
    expect(normalizeRecommendation(42)).toBe("Halten");
    expect(normalizeRecommendation(null)).toBe("Halten");
    expect(normalizeRecommendation(undefined)).toBe("Halten");
  });
});

// ─── stripMarkdownCodeBlock ──────────────────────────────────────────────────

describe("stripMarkdownCodeBlock", () => {
  it("removes ```json ... ``` wrapper", () => {
    const input = "```json\n{\"foo\": 1}\n```";
    expect(stripMarkdownCodeBlock(input)).toBe('{"foo": 1}');
  });

  it("removes ``` ... ``` wrapper without language tag", () => {
    const input = "```\n{\"foo\": 1}\n```";
    expect(stripMarkdownCodeBlock(input)).toBe('{"foo": 1}');
  });

  it("leaves plain JSON strings unchanged", () => {
    const input = '{"foo": 1}';
    expect(stripMarkdownCodeBlock(input)).toBe('{"foo": 1}');
  });

  it("trims surrounding whitespace", () => {
    const input = "  ```json\n{\"foo\": 1}\n```  ";
    expect(stripMarkdownCodeBlock(input)).toBe('{"foo": 1}');
  });
});

// ─── parseAndExtractJSON ─────────────────────────────────────────────────────

describe("parseAndExtractJSON", () => {
  it("parses a plain JSON object string", () => {
    const input = '{"recommendation": "Kaufen", "conviction": 7}';
    const result = parseAndExtractJSON(input) as Record<string, unknown>;
    expect(result.recommendation).toBe("Kaufen");
    expect(result.conviction).toBe(7);
  });

  it("extracts JSON from a markdown code block", () => {
    const input = "```json\n{\"recommendation\": \"Halten\"}\n```";
    const result = parseAndExtractJSON(input) as Record<string, unknown>;
    expect(result.recommendation).toBe("Halten");
  });

  it("extracts JSON when there is surrounding text", () => {
    const input = 'Here is my analysis:\n{"recommendation": "Kaufen", "conviction": 8}\nEnd.';
    const result = parseAndExtractJSON(input) as Record<string, unknown>;
    expect(result.recommendation).toBe("Kaufen");
  });

  it("throws when no JSON object is found", () => {
    expect(() => parseAndExtractJSON("no json here")).toThrow("No JSON object found");
    expect(() => parseAndExtractJSON("")).toThrow("No JSON object found");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseAndExtractJSON("{invalid json}")).toThrow();
  });
});

// ─── validateSynthesisOutput ─────────────────────────────────────────────────

describe("validateSynthesisOutput", () => {
  it("returns ok=true for valid input", () => {
    const result = validateSynthesisOutput(makeValidSynthesis(), SynthesisValidationSchema);
    expect(result.ok).toBe(true);
  });

  it("returns ok=false when recommendation is missing", () => {
    const { recommendation: _r, ...withoutRec } = makeValidSynthesis();
    const result = validateSynthesisOutput(withoutRec, SynthesisValidationSchema);
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when summary is empty string", () => {
    const result = validateSynthesisOutput(
      makeValidSynthesis({ summary: "" }),
      SynthesisValidationSchema,
    );
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when conviction is out of range", () => {
    const result = validateSynthesisOutput(
      makeValidSynthesis({ conviction: 0 }),
      SynthesisValidationSchema,
    );
    expect(result.ok).toBe(false);
  });
});

// ─── deterministicMinimalFallback ────────────────────────────────────────────

describe("deterministicMinimalFallback", () => {
  it("returns recommendation='Halten'", () => {
    const fb = deterministicMinimalFallback();
    expect(fb.recommendation).toBe("Halten");
  });

  it("returns conviction=4", () => {
    const fb = deterministicMinimalFallback();
    expect(fb.conviction).toBe(4);
  });

  it("has non-empty summary", () => {
    const fb = deterministicMinimalFallback();
    expect(fb.summary.length).toBeGreaterThan(10);
  });

  it("has bull_case and bear_case arrays", () => {
    const fb = deterministicMinimalFallback();
    expect(Array.isArray(fb.bull_case)).toBe(true);
    expect(Array.isArray(fb.bear_case)).toBe(true);
  });
});

// ─── validateAndRepairSynthesis ──────────────────────────────────────────────

describe("validateAndRepairSynthesis", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns source='opus' when Opus text is valid JSON matching schema", async () => {
    const validJson = JSON.stringify(makeValidSynthesis());
    const fallbackFn = jest.fn();
    const { result, source } = await validateAndRepairSynthesis(
      validJson,
      SynthesisValidationSchema as z.ZodSchema<unknown>,
      fallbackFn,
      "test-key",
    );
    expect(source).toBe("opus");
    expect(fallbackFn).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    const r = result as Record<string, unknown>;
    expect(r.recommendation).toBe("Halten");
  });

  it("normalizes English 'Buy' to 'Kaufen' without triggering repair", async () => {
    const validJson = JSON.stringify(makeValidSynthesis({ recommendation: "Buy" }));
    const fallbackFn = jest.fn();
    const { result, source } = await validateAndRepairSynthesis(
      validJson,
      SynthesisValidationSchema as z.ZodSchema<unknown>,
      fallbackFn,
      "test-key",
    );
    expect(source).toBe("opus");
    expect(fallbackFn).not.toHaveBeenCalled();
    const r = result as Record<string, unknown>;
    expect(r.recommendation).toBe("Kaufen");
  });

  it("calls repair when conviction is invalid (out of range)", async () => {
    // conviction=999 is invalid; after normalization recommendation becomes "Halten",
    // but conviction still fails min(1)/max(10) validation
    const invalidJson = JSON.stringify(
      makeValidSynthesis({ conviction: 999 }),
    );

    // Repair agent returns valid JSON with corrected conviction
    const repairedObj = makeValidSynthesis({ conviction: 7, recommendation: "Kaufen" });
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse(JSON.stringify(repairedObj)),
    );

    const onRepairAttempt = jest.fn();
    const fallbackFn = jest.fn();
    const { result, source } = await validateAndRepairSynthesis(
      invalidJson,
      SynthesisValidationSchema as z.ZodSchema<unknown>,
      fallbackFn,
      "test-key",
      onRepairAttempt,
    );

    expect(onRepairAttempt).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(source).toBe("repaired");
    expect(fallbackFn).not.toHaveBeenCalled();
    const r = result as Record<string, unknown>;
    expect(r.recommendation).toBe("Kaufen");
    expect(r.conviction).toBe(7);
  });

  it("calls repair when summary field is missing", async () => {
    // summary is not auto-filled by normalization, so validation fails
    const { summary: _s, ...withoutSummary } = makeValidSynthesis();
    const invalidJson = JSON.stringify(withoutSummary);

    const repairedObj = makeValidSynthesis();
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse(JSON.stringify(repairedObj)),
    );

    const { source } = await validateAndRepairSynthesis(
      invalidJson,
      SynthesisValidationSchema as z.ZodSchema<unknown>,
      jest.fn(),
      "test-key",
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(source).toBe("repaired");
  });

  it("falls back to haiku when repair fails", async () => {
    const invalidJson = '{"recommendation": "InvalidValue", "conviction": 999}';

    // Repair returns still-invalid JSON
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse('{"recommendation": "also_invalid"}'),
    );

    const haikuResult = makeValidSynthesis({ recommendation: "Leicht kaufen", source: "haiku" });
    const fallbackFn = jest.fn().mockResolvedValue(haikuResult);
    const onFallback = jest.fn();

    const { result, source } = await validateAndRepairSynthesis(
      invalidJson,
      SynthesisValidationSchema as z.ZodSchema<unknown>,
      fallbackFn,
      "test-key",
      undefined,
      onFallback,
    );

    expect(fallbackFn).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(source).toBe("haiku_fallback");
    const r = result as Record<string, unknown>;
    expect(r.recommendation).toBe("Leicht kaufen");
  });

  it("returns deterministic_fallback when repair and haiku both fail", async () => {
    const invalidJson = "this is not json at all";

    // Repair agent throws
    mockCreate.mockRejectedValueOnce(new Error("Repair failed"));

    // Haiku fallback throws
    const fallbackFn = jest.fn().mockRejectedValue(new Error("Haiku failed"));

    const { result, source } = await validateAndRepairSynthesis(
      invalidJson,
      SynthesisValidationSchema as z.ZodSchema<unknown>,
      fallbackFn,
      "test-key",
    );

    expect(source).toBe("deterministic_fallback");
    const r = result as Record<string, unknown>;
    expect(r.recommendation).toBe("Halten");
    expect(r.conviction).toBe(4);
  });

  it("recommendation is never undefined in the result", async () => {
    // Even with completely broken input, recommendation must always be set
    const { result } = await validateAndRepairSynthesis(
      "",
      SynthesisValidationSchema as z.ZodSchema<unknown>,
      jest.fn().mockRejectedValue(new Error("fail")),
      "test-key",
    );
    const r = result as Record<string, unknown>;
    expect(r.recommendation).toBeDefined();
    expect(r.recommendation).not.toBe(undefined);
  });

  it("normalizes recommendation after repair if repair returns English value", async () => {
    const invalidJson = '{"conviction": 5}'; // missing recommendation

    const repairedObj = makeValidSynthesis({ recommendation: "hold" }); // English
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse(JSON.stringify(repairedObj)),
    );

    const fallbackFn = jest.fn();
    const { result, source } = await validateAndRepairSynthesis(
      invalidJson,
      SynthesisValidationSchema as z.ZodSchema<unknown>,
      fallbackFn,
      "test-key",
    );

    // "hold" should be normalized to "Halten" before Zod validation passes
    expect(source).toBe("repaired");
    const r = result as Record<string, unknown>;
    expect(r.recommendation).toBe("Halten");
  });
});
