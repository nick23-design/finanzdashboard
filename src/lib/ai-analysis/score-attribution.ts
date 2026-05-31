/**
 * Score Attribution — explains why the final rating is what it is despite the
 * sub-scores: which components pull it down, and whether the binding constraint
 * is valuation, timing, risk or data quality. Deterministic.
 */

import type { Rating } from "./final-rating";

export interface ScoreAttributionInput {
  fundamentalScore: number;
  technicalScore: number;
  riskScore: number;
  totalScore: number;
  rating: Rating;
  marginOfSafetyAdequate: boolean;
  upsideDownsidePercent: number | null;
  dataConfidence?: "low" | "medium" | "high";
}

export interface ScoreAttribution {
  positiveContributors: string[];
  negativeContributors: string[];
  bindingConstraint: string;
  explanation: string;
}

export function buildScoreAttribution(input: ScoreAttributionInput): ScoreAttribution {
  const positive: string[] = [];
  const negative: string[] = [];

  if (input.fundamentalScore >= 75) positive.push("starke Fundamentaldaten (Profitabilität, Cash-Generierung, Wachstum)");
  else if (input.fundamentalScore < 50) negative.push("schwache Fundamentaldaten");

  if (input.technicalScore >= 70) positive.push("konstruktives technisches Setup");
  else if (input.technicalScore < 45) negative.push("schwaches technisches Setup");
  else negative.push("technisches Setup nur neutral");

  if (input.riskScore >= 70) positive.push("solides Risikoprofil (Bilanz/Volatilität)");
  else if (input.riskScore < 50) negative.push("erhöhtes Risikoprofil (z.B. Verschuldung/Volatilität)");

  if (!input.marginOfSafetyAdequate) negative.push("begrenzte Margin of Safety bei aktueller Bewertung");
  if (typeof input.upsideDownsidePercent === "number" && input.upsideDownsidePercent < 0) {
    negative.push("Kurs notiert über dem aggregierten Fair Value");
  }
  if (input.dataConfidence === "low") negative.push("lückenhafte Datenbasis");

  // Determine the binding constraint (what most limits the rating).
  let bindingConstraint: string;
  if (!input.marginOfSafetyAdequate || (input.upsideDownsidePercent ?? 0) < 0) {
    bindingConstraint = "Bewertung (Margin of Safety)";
  } else if (input.riskScore <= input.technicalScore && input.riskScore < 60) {
    bindingConstraint = "Risiko";
  } else if (input.technicalScore < 50) {
    bindingConstraint = "Timing";
  } else if (input.dataConfidence === "low") {
    bindingConstraint = "Datenqualität";
  } else {
    bindingConstraint = "Bewertung";
  }

  const explanation =
    `Trotz Gesamt-Score ${input.totalScore}/100 (Fundamental ${input.fundamentalScore}, ` +
    `Technik ${input.technicalScore}, Risiko ${input.riskScore}) lautet das Rating „${input.rating}", ` +
    `weil der limitierende Faktor die ${bindingConstraint} ist` +
    (negative.length ? `: ${negative.slice(0, 2).join("; ")}.` : ".");

  return { positiveContributors: positive, negativeContributors: negative, bindingConstraint, explanation };
}
