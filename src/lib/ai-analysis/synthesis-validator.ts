/**
 * synthesis-validator.ts
 * Stufe 1b: Structured Output Validation + Repair nach der Opus-Synthese.
 *
 * Pipeline:
 *   Opus-Rohtext
 *     → normalizeRecommendation (EN→DE)
 *     → Zod-Validierung
 *     → [FALLBACK 1] Haiku-Repair-Agent (20 s)
 *     → [FALLBACK 2] runSynthesisFastAgent (Haiku)
 *     → [FALLBACK 3] deterministicMinimalFallback
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const DEFAULT_GROWTH_OUTLOOK =
  "Insufficient reliable data for a high-conviction growth outlook.";

export interface SchemaNormalizationEvent {
  path: string;
  reason: string;
  before: unknown;
  after: unknown;
}

// ─── Allowed recommendation values ────────────────────────────────────────────

export const ALLOWED_RECOMMENDATIONS = [
  "Kaufen",
  "Leicht kaufen",
  "Halten",
  "Leicht verkaufen",
  "Verkaufen",
] as const;

export type AllowedRecommendation = (typeof ALLOWED_RECOMMENDATIONS)[number];

// ─── EN→DE mapping ────────────────────────────────────────────────────────────

const RECOMMENDATION_MAP: Record<string, AllowedRecommendation> = {
  buy: "Kaufen",
  "strong buy": "Kaufen",
  kaufen: "Kaufen",
  "leicht kaufen": "Leicht kaufen",
  "slight buy": "Leicht kaufen",
  hold: "Halten",
  halten: "Halten",
  neutral: "Halten",
  "slight sell": "Leicht verkaufen",
  "leicht verkaufen": "Leicht verkaufen",
  sell: "Verkaufen",
  "strong sell": "Verkaufen",
  verkaufen: "Verkaufen",
};

export function normalizeRecommendation(raw: unknown): AllowedRecommendation {
  if (typeof raw !== "string") return "Halten";
  const lower = raw.trim().toLowerCase();
  if (RECOMMENDATION_MAP[lower]) return RECOMMENDATION_MAP[lower];
  // Exact match (case-insensitive)
  const exact = ALLOWED_RECOMMENDATIONS.find((r) => r.toLowerCase() === lower);
  return exact ?? "Halten";
}

export function normalizeGrowthOutlookValue(raw: unknown): string {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return DEFAULT_GROWTH_OUTLOOK;
}

export function normalizeClaimConfidenceValue(raw: unknown): number {
  if (raw == null) return 1;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return 1;
  if (n > 0 && n <= 1) return Math.max(1, Math.min(5, Math.ceil(n * 5)));
  return Math.max(1, Math.min(5, Math.round(n)));
}

function addNormalizationEvent(
  events: SchemaNormalizationEvent[],
  path: string,
  reason: string,
  before: unknown,
  after: unknown,
): void {
  if (!Object.is(before, after)) {
    events.push({ path, reason, before, after });
  }
}

export function normalizeSynthesisForSchema(raw: unknown): {
  value: unknown;
  events: SchemaNormalizationEvent[];
} {
  const events: SchemaNormalizationEvent[] = [];
  if (!raw || typeof raw !== "object") {
    return { value: raw, events };
  }

  const obj = { ...(raw as Record<string, unknown>) };
  const growthOutlook = normalizeGrowthOutlookValue(obj.growth_outlook);
  addNormalizationEvent(
    events,
    "growth_outlook",
    "missing_or_blank_growth_outlook_defaulted",
    obj.growth_outlook,
    growthOutlook,
  );
  obj.growth_outlook = growthOutlook;

  if (Array.isArray(obj.claims)) {
    obj.claims = obj.claims.map((claim, index) => {
      if (!claim || typeof claim !== "object") return claim;
      const normalizedClaim = { ...(claim as Record<string, unknown>) };
      const confidence = normalizeClaimConfidenceValue(normalizedClaim.confidence);
      addNormalizationEvent(
        events,
        `claims.${index}.confidence`,
        "claim_confidence_normalized_to_integer_1_5",
        normalizedClaim.confidence,
        confidence,
      );
      normalizedClaim.confidence = confidence;
      return normalizedClaim;
    });
  }

  return { value: obj, events };
}

export function logSynthesisNormalizationEvents(
  events: SchemaNormalizationEvent[],
): void {
  if (!events.length) return;
  console.warn(
    "[AI_ANALYSIS_SCHEMA_NORMALIZATION]",
    JSON.stringify(events),
  );
}

// ─── JSON parsing helpers ─────────────────────────────────────────────────────

export function stripMarkdownCodeBlock(raw: string): string {
  // Remove leading/trailing whitespace first, then strip ```json ... ``` or ``` ... ``` wrappers
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

export function parseAndExtractJSON(raw: string): unknown {
  const stripped = stripMarkdownCodeBlock(raw);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

// ─── Minimal SynthesisResult shape (matches route.ts interface) ───────────────

export interface MinimalSynthesisResult {
  recommendation: string;
  conviction: number;
  summary: string;
  bull_case: string[];
  bear_case: string[];
  growth_outlook: string;
}

// ─── Zod schema for validation (subset matching SynthesisResult requirements) ─

export const SynthesisValidationSchema = z.object({
  recommendation: z.enum([
    "Kaufen",
    "Leicht kaufen",
    "Halten",
    "Leicht verkaufen",
    "Verkaufen",
  ]),
  conviction: z.number().min(1).max(10),
  summary: z.string().min(1),
  bull_case: z.array(z.string()),
  bear_case: z.array(z.string()),
  growth_outlook: z.preprocess(
    normalizeGrowthOutlookValue,
    z.string().min(1),
  ),
}).passthrough();

export type SynthesisValidationInput = z.infer<typeof SynthesisValidationSchema>;

// ─── Validation result type ───────────────────────────────────────────────────

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: z.ZodError };

export function validateSynthesisOutput<T>(
  raw: unknown,
  schema: z.ZodSchema<T>,
): ValidationResult<T> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: result.error };
}

// ─── Normalize nested fields ──────────────────────────────────────────────────

export function normalizeRecommendationInObject(
  obj: Record<string, unknown>,
): void {
  if (obj.recommendation !== undefined) {
    obj.recommendation = normalizeRecommendation(obj.recommendation);
  }
  // Nested-field check: if final.recommendation exists instead of recommendation
  if (!obj.recommendation && obj.final && typeof obj.final === "object") {
    const nested = obj.final as Record<string, unknown>;
    if (nested.recommendation) {
      obj.recommendation = normalizeRecommendation(nested.recommendation);
    }
    if (nested.summary) obj.summary = nested.summary;
  }
}

// ─── Deterministic minimal fallback ──────────────────────────────────────────

export function deterministicMinimalFallback(): MinimalSynthesisResult {
  return {
    recommendation: "Halten",
    conviction: 4,
    summary:
      "Die Analyse konnte nicht vollständig validiert werden. Bitte erneut versuchen oder die Daten manuell prüfen.",
    bull_case: ["Nicht verfügbar"],
    bear_case: ["Nicht verfügbar"],
    growth_outlook: DEFAULT_GROWTH_OUTLOOK,
  };
}

// ─── Repair-Agent (Haiku) ─────────────────────────────────────────────────────

export async function repairSynthesisOutput(
  opusRawText: string,
  zodErrors: z.ZodError,
  anthropicApiKey: string,
): Promise<unknown> {
  const client = new Anthropic({
    apiKey: anthropicApiKey,
    timeout: 20_000,
    maxRetries: 0,
  });

  const errorSummary = zodErrors.errors
    .slice(0, 8)
    .map((e) => `  - Pfad: ${e.path.join(".")}, Fehler: ${e.message}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2500,
    system: `Du bist ein JSON-Reparatur-Agent. Deine einzige Aufgabe ist es, fehlerhaftes oder unvollständiges JSON zu reparieren.
Du antwortest AUSSCHLIESSLICH mit validem JSON-Objekt. Kein Markdown, keine Erklärungen, keine Codeblöcke.
Pflichtfelder im Output: recommendation (muss exakt einer dieser Werte sein: "Kaufen"|"Leicht kaufen"|"Halten"|"Leicht verkaufen"|"Verkaufen"), summary (nicht-leerer String), conviction (Zahl 1-10), bull_case (Array), bear_case (Array), growth_outlook (String).
Wenn growth_outlook fehlt oder nicht belastbar ist, setze exakt: "${DEFAULT_GROWTH_OUTLOOK}".
Falls claims vorhanden sind: confidence muss eine ganze Zahl von 1 bis 5 sein. Nie 0, nie Dezimalzahl, nie null; bei Unsicherheit 1 oder 2.`,
    messages: [
      {
        role: "user",
        content: `Repariere dieses fehlerhafte JSON:\n\n${opusRawText.slice(0, 3000)}\n\nZod-Validierungsfehler:\n${errorSummary}\n\nGib nur das reparierte JSON zurück, ohne Erklärungen oder Markdown.`,
      },
    ],
  });

  const text = response.content
    .filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === "text",
    )
    .map((b) => b.text)
    .join("");

  return parseAndExtractJSON(text);
}

// ─── Main orchestration pipeline ─────────────────────────────────────────────

export type SynthesisSource =
  | "opus"
  | "repaired"
  | "haiku_fallback"
  | "deterministic_fallback";

export async function validateAndRepairSynthesis<T>(
  opusRawText: string,
  schema: z.ZodSchema<T>,
  fallbackFn: () => Promise<T>,
  anthropicApiKey: string,
  onRepairAttempt?: () => void,
  onFallback?: () => void,
): Promise<{ result: T; source: SynthesisSource }> {
  // 1. Parse Opus response
  let parsed: unknown;
  try {
    parsed = parseAndExtractJSON(opusRawText);
  } catch {
    parsed = null;
  }

  // 2. Normalize recommendation (English → German values)
  if (parsed && typeof parsed === "object" && parsed !== null) {
    normalizeRecommendationInObject(parsed as Record<string, unknown>);
  }
  const normalizedParsed = normalizeSynthesisForSchema(parsed);
  logSynthesisNormalizationEvents(normalizedParsed.events);
  parsed = normalizedParsed.value;

  // 3. Validate
  const validation = validateSynthesisOutput(parsed, schema);
  if (validation.ok) {
    return { result: validation.data, source: "opus" };
  }

  // 4. Attempt repair
  onRepairAttempt?.();
  try {
    const repaired = await repairSynthesisOutput(
      opusRawText,
      validation.errors,
      anthropicApiKey,
    );
    // Normalize recommendation after repair
    if (repaired && typeof repaired === "object" && repaired !== null) {
      normalizeRecommendationInObject(repaired as Record<string, unknown>);
    }
    const normalizedRepaired = normalizeSynthesisForSchema(repaired);
    logSynthesisNormalizationEvents(normalizedRepaired.events);
    const repairedValidation = validateSynthesisOutput(normalizedRepaired.value, schema);
    if (repairedValidation.ok) {
      return { result: repairedValidation.data, source: "repaired" };
    }
  } catch {
    // Repair failed → continue to fallback
  }

  // 5. Haiku fallback
  onFallback?.();
  try {
    const haiku = await fallbackFn();
    const normalizedHaiku = normalizeSynthesisForSchema(haiku);
    logSynthesisNormalizationEvents(normalizedHaiku.events);
    const haikuValidation = validateSynthesisOutput(normalizedHaiku.value, schema);
    if (haikuValidation.ok) {
      return { result: haikuValidation.data, source: "haiku_fallback" };
    }
  } catch {
    // Haiku failed → deterministic fallback
  }

  // 6. Deterministic minimal fallback
  return {
    result: deterministicMinimalFallback() as unknown as T,
    source: "deterministic_fallback",
  };
}
