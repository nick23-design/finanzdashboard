/**
 * Final Rating — deterministic rating that is consistent with the aggregated
 * upside/downside and the required margin of safety. High business quality must
 * not auto-produce "Kaufen" when the margin of safety is thin, and a mild
 * overvaluation of a high-quality compounder lands on "Halten", not "Verkaufen".
 *
 * Also cross-checks against the LLM recommendation so Vera can flag a
 * contradiction (rating vs upside/downside).
 */

import type { PriceZones } from "./price-zones";

export type Rating = "Kaufen" | "Leicht kaufen" | "Halten" | "Leicht verkaufen" | "Verkaufen";

const RATING_ORDER: Rating[] = ["Verkaufen", "Leicht verkaufen", "Halten", "Leicht kaufen", "Kaufen"];

export interface FinalRatingInput {
  /** (aggregateFairValue − price) / price × 100, from the bridge. */
  upsideDownsidePercent: number | null;
  /** 0–100. */
  businessQualityScore?: number | null;
  zones: PriceZones;
  /** Opus' qualitative recommendation, for cross-check. */
  llmRecommendation?: string | null;
}

export interface FinalRatingResult {
  rating: Rating;
  rationale: string;
  marginOfSafetyAdequate: boolean;
  contradictsLlmRecommendation: boolean;
}

function ratingRank(label: string | null | undefined): number {
  if (!label) return -1;
  return RATING_ORDER.indexOf(label as Rating);
}

export function deriveFinalRating(input: FinalRatingInput): FinalRatingResult {
  const upside = input.upsideDownsidePercent;
  const requiredPct = input.zones.requiredMarginOfSafety * 100;
  const qualityHigh = typeof input.businessQualityScore === "number" && input.businessQualityScore >= 80;

  if (upside == null) {
    return {
      rating: "Halten",
      rationale: "Kein aggregierter Fair Value verfügbar — kein bewertungsbasiertes Rating möglich; Default Halten.",
      marginOfSafetyAdequate: false,
      contradictsLlmRecommendation: false,
    };
  }

  const marginOfSafetyAdequate = upside >= requiredPct;

  let rating: Rating;
  if (upside >= requiredPct) rating = "Kaufen";
  else if (upside >= 5) rating = "Leicht kaufen";
  else if (upside >= -8) rating = "Halten";
  else if (upside >= -20) rating = "Leicht verkaufen";
  else rating = "Verkaufen";

  const adjustments: string[] = [];

  // Quality guard: do not sell a high-quality compounder on a mild overvaluation.
  if (qualityHigh && rating === "Leicht verkaufen") {
    rating = "Halten";
    adjustments.push("hohe Business-Qualität dämpft das Verkaufssignal bei moderater Überbewertung");
  }
  // Quality guard: positive but thin upside → not an automatic buy.
  if (qualityHigh && rating === "Kaufen" && !marginOfSafetyAdequate) {
    rating = "Leicht kaufen";
    adjustments.push("Margin of Safety nicht ausreichend für ein volles Kaufsignal");
  }

  const dir =
    upside >= requiredPct ? `Upside ${upside.toFixed(1)}% ≥ geforderter MoS ${requiredPct.toFixed(0)}%`
    : upside >= 0 ? `begrenztes Upside ${upside.toFixed(1)}% (< geforderter MoS ${requiredPct.toFixed(0)}%)`
    : `Downside ${upside.toFixed(1)}% (Kurs über Fair Value)`;

  const rationale =
    `${rating}: ${dir}.` +
    (marginOfSafetyAdequate ? " Margin of Safety ausreichend." : " Margin of Safety nicht ausreichend.") +
    (adjustments.length ? ` ${adjustments.join("; ")}.` : "");

  // Cross-check vs LLM: contradiction if they sit ≥2 rating steps apart.
  const llmRank = ratingRank(input.llmRecommendation);
  const ownRank = ratingRank(rating);
  const contradictsLlmRecommendation = llmRank >= 0 && Math.abs(llmRank - ownRank) >= 2;

  return { rating, rationale, marginOfSafetyAdequate, contradictsLlmRecommendation };
}
