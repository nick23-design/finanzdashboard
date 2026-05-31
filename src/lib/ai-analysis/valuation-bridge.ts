/**
 * Valuation Bridge — deterministic aggregation of all valuation methods into a
 * single fair value, currency-normalised, with transparent weighting.
 *
 * Replaces the old "several fair values side by side" UI. Zero LLM calls:
 * Opus receives the bridge and EXPLAINS it; it does not recalculate.
 *
 * A method without reliable data is never silently blended in — it is marked
 * `included: false`, `weight: 0`, with an `exclusionReason`.
 */

import { convertUsdEur } from "@/lib/fx";
import type { RawValuationRange, ValuationConfidence } from "./valuation-model";

export type Currency = "USD" | "EUR";

export type BridgeMethodName =
  | "own_model"
  | "dcf"
  | "analyst_consensus"
  | "relative_multiple";

export interface BridgeMethodInput {
  name: BridgeMethodName;
  /** German display label. */
  label: string;
  /** Bear/base/bull range in its own currency, or null when unavailable. */
  range: RawValuationRange | null;
  /** Base weight before confidence adjustment (relative, will be normalised). */
  baseWeight: number;
  /**
   * Structured-data flag. Only relevant for analyst_consensus: a news-derived
   * or unstructured consensus must never feed the aggregate (#9).
   */
  structured?: boolean;
  keyAssumptions?: string[];
}

export interface BridgeMethod {
  name: BridgeMethodName;
  label: string;
  /** Base fair value converted to the primary currency (null if excluded). */
  fairValue: number | null;
  currency: Currency;
  originalCurrency: string;
  /** Normalised weight across *included* methods (0 when excluded). */
  weight: number;
  /** fairValue × weight, in the primary currency (null if excluded). */
  weightedContribution: number | null;
  confidence: ValuationConfidence;
  included: boolean;
  exclusionReason: string | null;
  keyAssumptions: string[];
}

export interface ValuationBridge {
  methods: BridgeMethod[];
  /** Weighted fair value across included methods, in primary currency. */
  aggregateFairValue: number | null;
  fairValueRange: { bear: number | null; base: number | null; bull: number | null };
  currentPrice: number | null;
  /** (aggregate − price) / price × 100. Positive → upside. */
  upsideDownsidePercent: number | null;
  /** (aggregate − price) / aggregate × 100. Positive → price below fair value. */
  marginOfSafety: number | null;
  primaryCurrency: Currency;
  /** Pre-converted aggregate for the global currency toggle. */
  fxConvertedValues: {
    eurUsd: number;
    aggregateUsd: number | null;
    aggregateEur: number | null;
  };
  notes: string[];
}

export interface ValuationBridgeInput {
  methods: BridgeMethodInput[];
  currentPrice: number | null;
  /** Currency the current price (and therefore the bridge) is expressed in. */
  primaryCurrency: Currency;
  /** 1 EUR = eurUsd USD (from getEurUsd()). */
  eurUsd: number;
}

// Confidence → multiplicative weight factor. Low-confidence methods contribute
// less; this keeps a shaky DCF from dominating a solid own model.
const CONFIDENCE_FACTOR: Record<ValuationConfidence, number> = {
  high: 1,
  medium: 0.65,
  low: 0.35,
};

function normalizeCurrency(raw: string | null | undefined): Currency {
  return (raw ?? "USD").toUpperCase() === "EUR" ? "EUR" : "USD";
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function round2(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
}

function round1(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

function convert(value: number, from: Currency, to: Currency, eurUsd: number): number {
  return convertUsdEur(value, from, to, eurUsd);
}

/**
 * Build the valuation bridge from the deterministic method ranges.
 * Pure function — same inputs always yield the same bridge.
 */
export function buildValuationBridge(input: ValuationBridgeInput): ValuationBridge {
  const { primaryCurrency, eurUsd } = input;
  const notes: string[] = [];

  // ── 1. Evaluate every method: convert, decide inclusion ──────────────────
  const evaluated = input.methods.map((m): BridgeMethod => {
    const originalCurrency = normalizeCurrency(m.range?.currency);
    const confidence: ValuationConfidence = m.range?.confidence ?? "low";
    const keyAssumptions = m.keyAssumptions ?? m.range?.methods ?? [];

    // Exclusion reasons (never silently blend a method without data).
    let exclusionReason: string | null = null;
    if (!m.range || !isPositive(m.range.base)) {
      exclusionReason = "Keine belastbaren Daten für diese Methode.";
    } else if (m.name === "analyst_consensus" && m.structured !== true) {
      exclusionReason = "Kein strukturierter Analystenkonsens — fließt nicht in die Bewertung ein.";
    }

    const included = exclusionReason === null;
    const fairValue = included
      ? round2(convert(m.range!.base as number, originalCurrency, primaryCurrency, eurUsd))
      : null;

    return {
      name: m.name,
      label: m.label,
      fairValue,
      currency: primaryCurrency,
      originalCurrency,
      weight: included ? m.baseWeight * CONFIDENCE_FACTOR[confidence] : 0,
      weightedContribution: null, // filled after normalisation
      confidence,
      included,
      exclusionReason,
      keyAssumptions,
    };
  });

  // ── 2. Normalise weights across included methods ─────────────────────────
  const weightSum = evaluated.reduce((acc, m) => acc + (m.included ? m.weight : 0), 0);
  const methods = evaluated.map((m) => {
    if (!m.included || weightSum <= 0) {
      return { ...m, weight: m.included ? m.weight : 0, weightedContribution: null };
    }
    const weight = m.weight / weightSum;
    return {
      ...m,
      weight: Math.round(weight * 1000) / 1000,
      weightedContribution: round2((m.fairValue as number) * weight),
    };
  });

  // ── 3. Aggregate fair value (weighted mean of included base values) ──────
  const includedMethods = methods.filter((m) => m.included && m.fairValue != null);
  let aggregateFairValue: number | null = null;
  if (includedMethods.length > 0 && weightSum > 0) {
    const agg = includedMethods.reduce(
      (acc, m) => acc + (m.fairValue as number) * (m.weight as number),
      0,
    );
    aggregateFairValue = round2(agg);
  }

  if (includedMethods.length === 0) {
    notes.push("Keine Bewertungsmethode mit belastbaren Daten verfügbar.");
  } else if (includedMethods.length === 1) {
    notes.push(`Aggregat beruht nur auf einer Methode (${includedMethods[0].label}).`);
  }

  // ── 4. Conservative fair-value range: min bear / max bull of included ────
  const bears = includedMethods
    .map((m) => input.methods.find((x) => x.name === m.name)?.range)
    .filter((r): r is RawValuationRange => !!r && isPositive(r.bear))
    .map((r) => convert(r.bear as number, normalizeCurrency(r.currency), primaryCurrency, eurUsd));
  const bulls = includedMethods
    .map((m) => input.methods.find((x) => x.name === m.name)?.range)
    .filter((r): r is RawValuationRange => !!r && isPositive(r.bull))
    .map((r) => convert(r.bull as number, normalizeCurrency(r.currency), primaryCurrency, eurUsd));

  const fairValueRange = {
    bear: bears.length ? round2(Math.min(...bears)) : null,
    base: aggregateFairValue,
    bull: bulls.length ? round2(Math.max(...bulls)) : null,
  };

  // ── 5. Upside / downside and margin of safety vs current price ───────────
  const price = isPositive(input.currentPrice) ? input.currentPrice : null;
  let upsideDownsidePercent: number | null = null;
  let marginOfSafety: number | null = null;
  if (price != null && aggregateFairValue != null) {
    upsideDownsidePercent = round1(((aggregateFairValue - price) / price) * 100);
    marginOfSafety = round1(((aggregateFairValue - price) / aggregateFairValue) * 100);
  }

  return {
    methods,
    aggregateFairValue,
    fairValueRange,
    currentPrice: price,
    upsideDownsidePercent,
    marginOfSafety,
    primaryCurrency,
    fxConvertedValues: {
      eurUsd,
      aggregateUsd:
        aggregateFairValue == null
          ? null
          : round2(convert(aggregateFairValue, primaryCurrency, "USD", eurUsd)),
      aggregateEur:
        aggregateFairValue == null
          ? null
          : round2(convert(aggregateFairValue, primaryCurrency, "EUR", eurUsd)),
    },
    notes,
  };
}

/** Default base weights per method. Analyst consensus is market opinion → lower. */
export const DEFAULT_BRIDGE_WEIGHTS: Record<BridgeMethodName, number> = {
  own_model: 0.35,
  dcf: 0.3,
  analyst_consensus: 0.2,
  relative_multiple: 0.15,
};
