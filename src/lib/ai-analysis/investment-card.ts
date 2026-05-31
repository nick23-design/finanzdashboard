/**
 * Investment Card — the decision-first summary shown at the top of the analysis.
 * Pure assembly of the deterministic layers (bridge, zones, confidence, rating)
 * plus optional LLM narrative (key debate, bull/bear thesis, reassess triggers).
 */

import type { Currency, ValuationBridge } from "./valuation-bridge";
import type { PriceZones } from "./price-zones";
import type { ConfidenceBreakdown } from "./confidence-breakdown";
import type { Rating } from "./final-rating";

export type QualLabel = "niedrig" | "mittel bis niedrig" | "mittel" | "hoch" | "sehr hoch";

export interface InvestmentCardNarrative {
  keyDebate?: string | null;
  bullThesis?: string | null;
  bearThesis?: string | null;
  reassessTriggers?: string[] | null;
}

export interface InvestmentCardInput {
  rating: Rating;
  ratingWarning: boolean;
  marginOfSafetyAdequate: boolean;
  bridge: ValuationBridge;
  zones: PriceZones;
  confidence: ConfidenceBreakdown;
  businessQualityScore?: number | null;
  narrative?: InvestmentCardNarrative;
  /** Fallbacks if the LLM did not supply narrative fields. */
  fallback?: { bullCase?: string[]; bearCase?: string[]; redFlags?: string[] };
}

export interface InvestmentCard {
  rating: Rating;
  ratingWarning: boolean;
  currentPrice: number | null;
  aggregateFairValue: number | null;
  upsideDownsidePercent: number | null;
  fairValueRange: { bear: number | null; base: number | null; bull: number | null };
  primaryCurrency: Currency;
  businessQuality: QualLabel;
  valuationAttractiveness: QualLabel;
  timing: "niedrig" | "mittel" | "hoch";
  marginOfSafety: { value: number | null; adequate: boolean; label: string };
  keyDebate: string | null;
  bullThesis: string | null;
  bearThesis: string | null;
  buyZone: number | null;
  holdZone: { low: number | null; high: number | null };
  avoidZone: number | null;
  reassessTriggers: string[];
}

function qualityLabel(score: number | null | undefined): QualLabel {
  if (typeof score !== "number") return "mittel";
  if (score >= 85) return "sehr hoch";
  if (score >= 70) return "hoch";
  if (score >= 50) return "mittel";
  return "niedrig";
}

function valuationAttractiveness(upside: number | null, requiredMosPct: number): QualLabel {
  if (upside == null) return "mittel";
  if (upside >= requiredMosPct) return "hoch";
  if (upside >= 5) return "mittel";
  if (upside >= -18) return "mittel bis niedrig";
  return "niedrig";
}

const TIMING_LABEL = { low: "niedrig", medium: "mittel", high: "hoch" } as const;

export function buildInvestmentCard(input: InvestmentCardInput): InvestmentCard {
  const { bridge, zones, confidence } = input;
  const requiredMosPct = zones.requiredMarginOfSafety * 100;

  const reassessTriggers =
    input.narrative?.reassessTriggers && input.narrative.reassessTriggers.length
      ? input.narrative.reassessTriggers
      : (input.fallback?.redFlags ?? []).slice(0, 4);

  return {
    rating: input.rating,
    ratingWarning: input.ratingWarning,
    currentPrice: bridge.currentPrice,
    aggregateFairValue: bridge.aggregateFairValue,
    upsideDownsidePercent: bridge.upsideDownsidePercent,
    fairValueRange: bridge.fairValueRange,
    primaryCurrency: bridge.primaryCurrency,
    businessQuality: qualityLabel(input.businessQualityScore),
    valuationAttractiveness: valuationAttractiveness(bridge.upsideDownsidePercent, requiredMosPct),
    timing: TIMING_LABEL[confidence.timingConfidence],
    marginOfSafety: {
      value: bridge.marginOfSafety,
      adequate: input.marginOfSafetyAdequate,
      label: input.marginOfSafetyAdequate ? "ausreichend" : "nicht ausreichend",
    },
    keyDebate: input.narrative?.keyDebate ?? null,
    bullThesis: input.narrative?.bullThesis ?? input.fallback?.bullCase?.[0] ?? null,
    bearThesis: input.narrative?.bearThesis ?? input.fallback?.bearCase?.[0] ?? null,
    buyZone: zones.buyBelow,
    holdZone: zones.holdRange,
    avoidZone: zones.avoidAbove,
    reassessTriggers,
  };
}
