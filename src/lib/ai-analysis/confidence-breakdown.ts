/**
 * Confidence Breakdown — splits the old monolithic "Konfidenz hoch" into the
 * dimensions that actually drive trust in a recommendation.
 *
 * Hard rule (#3): high *data* quality must never lift *valuation* confidence.
 * A model that hinges on capex / margins / AI monetisation / terminal multiple
 * is capped at "mittel". Overall confidence is bound by its weakest pillar —
 * it can never exceed data or valuation confidence.
 *
 * Deterministic, zero LLM calls.
 */

export type ConfidenceLevel = "low" | "medium" | "high";

export interface ConfidenceBreakdownInput {
  /** Data completeness 0–100 (from data_quality.completeness_score). */
  dataCompletenessScore: number | null;
  /** Business quality 0–100 (quality/moat score). */
  businessQualityScore?: number | null;
  /** Confidence of the own valuation model. */
  valuationModelConfidence?: ConfidenceLevel;
  /** Spread of method fair values relative to the aggregate, in percent. */
  bridgeDispersionPct?: number | null;
  /** Technical score 0–100 (timing). */
  technicalScore?: number | null;
  /**
   * True when the valuation hinges heavily on capex / margins / AI monetisation
   * / terminal multiple. Caps valuation confidence at "medium".
   */
  valuationAssumptionHeavy?: boolean;
}

export interface ConfidenceBreakdown {
  dataConfidence: ConfidenceLevel;
  businessQualityConfidence: ConfidenceLevel;
  valuationConfidence: ConfidenceLevel;
  timingConfidence: ConfidenceLevel;
  overallConfidence: ConfidenceLevel;
  confidenceExplanation: string;
}

const RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };
const LEVELS: ConfidenceLevel[] = ["low", "medium", "high"];

function minLevel(...levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b), "high");
}

function downgrade(level: ConfidenceLevel, steps = 1): ConfidenceLevel {
  return LEVELS[Math.max(0, RANK[level] - steps)];
}

function cap(level: ConfidenceLevel, ceiling: ConfidenceLevel): ConfidenceLevel {
  return RANK[level] <= RANK[ceiling] ? level : ceiling;
}

function fromScore(score: number | null | undefined, high: number, medium: number): ConfidenceLevel {
  if (typeof score !== "number" || !Number.isFinite(score)) return "medium";
  if (score >= high) return "high";
  if (score >= medium) return "medium";
  return "low";
}

const LABEL: Record<ConfidenceLevel, string> = { low: "niedrig", medium: "mittel", high: "hoch" };

export function buildConfidenceBreakdown(input: ConfidenceBreakdownInput): ConfidenceBreakdown {
  const dataConfidence = fromScore(input.dataCompletenessScore, 85, 65);
  const businessQualityConfidence = fromScore(input.businessQualityScore, 75, 55);

  // Valuation confidence: start from the model, then apply honesty caps.
  let valuationConfidence: ConfidenceLevel = input.valuationModelConfidence ?? "medium";
  if (input.valuationAssumptionHeavy) {
    valuationConfidence = cap(valuationConfidence, "medium");
  }
  if (typeof input.bridgeDispersionPct === "number" && input.bridgeDispersionPct > 30) {
    // Methods disagree strongly → less trustworthy aggregate.
    valuationConfidence = downgrade(valuationConfidence);
  }
  // Data quality can drag valuation confidence DOWN, but never lift it up.
  valuationConfidence = minLevel(valuationConfidence, dataConfidence);

  // Timing is inherently uncertain — capped at "medium".
  const timingConfidence = cap(fromScore(input.technicalScore, 80, 50), "medium");

  // Overall is bound by its weakest decision-relevant pillar (data + valuation).
  const overallConfidence = minLevel(dataConfidence, valuationConfidence);

  const reasons: string[] = [];
  if (input.valuationAssumptionHeavy) {
    reasons.push("die Bewertung stark von Annahmen (Capex, Margen, KI-Monetarisierung, Terminal-Multiple) abhängt");
  }
  if (typeof input.bridgeDispersionPct === "number" && input.bridgeDispersionPct > 30) {
    reasons.push("die Bewertungsmethoden deutlich auseinanderlaufen");
  }
  if (dataConfidence !== "high") {
    reasons.push("die Datenbasis nicht vollständig ist");
  }

  const confidenceExplanation =
    `Gesamt-Konfidenz ${LABEL[overallConfidence]}: begrenzt durch Daten (${LABEL[dataConfidence]}) ` +
    `und Bewertung (${LABEL[valuationConfidence]}). Business-Qualität ${LABEL[businessQualityConfidence]}, ` +
    `Timing ${LABEL[timingConfidence]}.` +
    (reasons.length ? ` Eine hohe Datenqualität allein hebt die Bewertungs-Konfidenz nicht, weil ${reasons.join(" und ")}.` : "");

  return {
    dataConfidence,
    businessQualityConfidence,
    valuationConfidence,
    timingConfidence,
    overallConfidence,
    confidenceExplanation,
  };
}

export const CONFIDENCE_LABEL = LABEL;
