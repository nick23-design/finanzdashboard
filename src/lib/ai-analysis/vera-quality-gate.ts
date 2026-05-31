/**
 * Vera Quality Gate — turns the Vera fact-check (plus deterministic checks)
 * into a real gate. On a high-severity contradiction the analysis is marked
 * "review_required", overall confidence is reduced, and the final rating is
 * shown with a warning until the user applies Vera's corrections.
 */

import type { VeraFactCheckResult } from "@/types/vera";

export type GateStatus = "ok" | "review_required";
export type Severity = "none" | "low" | "medium" | "high";

export interface VeraQualityIssue {
  type: string;
  message: string;
  severity: "low" | "medium" | "high";
  affectedSection?: string;
  suggestedFix?: string;
}

export interface VeraQualityGate {
  status: GateStatus;
  severity: Severity;
  issues: VeraQualityIssue[];
  blocksFinalRating: boolean;
  reduceConfidence: boolean;
  suggestedFixes: string[];
  appliedFixes: string[];
  explanation: string;
}

export interface VeraQualityGateInput {
  vera: VeraFactCheckResult | null;
  /** Final rating contradicts the LLM recommendation / upside-downside. */
  ratingContradiction?: boolean;
  /** Valuation values mix currencies without conversion. */
  currencyMixed?: boolean;
  /** Overall confidence is "high" although valuation assumptions are shaky. */
  confidenceTooHigh?: boolean;
}

const SEV_RANK: Record<Severity, number> = { none: 0, low: 1, medium: 2, high: 3 };

function maxSeverity(issues: VeraQualityIssue[]): Severity {
  let max: Severity = "none";
  for (const i of issues) {
    if (SEV_RANK[i.severity] > SEV_RANK[max]) max = i.severity;
  }
  return max;
}

export function buildVeraQualityGate(input: VeraQualityGateInput): VeraQualityGate {
  const issues: VeraQualityIssue[] = [];

  // 1. Carry over the LLM fact-check issues.
  for (const i of input.vera?.issues ?? []) {
    issues.push({
      type: i.type,
      message: i.message,
      severity: (i as { severity?: "low" | "medium" | "high" }).severity ?? "low",
      affectedSection: i.affectedSection,
      suggestedFix: i.suggestedFix,
    });
  }

  // 2. Deterministic gate checks (independent of the LLM).
  if (input.ratingContradiction) {
    issues.push({
      type: "rating_upside_mismatch",
      message: "Das finale Rating widerspricht dem aggregierten Upside/Downside.",
      severity: "high",
      affectedSection: "Investment Card / Rating",
      suggestedFix: "Rating an die aggregierte Bewertung (Upside/Downside, Margin of Safety) angleichen.",
    });
  }
  if (input.currencyMixed) {
    issues.push({
      type: "valuation_mixing",
      message: "Bewertungswerte vermischen Währungen ohne einheitliche Umrechnung.",
      severity: "high",
      affectedSection: "Valuation Bridge",
      suggestedFix: "Alle Werte in eine Primärwährung umrechnen (globaler EUR/USD-Umschalter).",
    });
  }
  if (input.confidenceTooHigh) {
    issues.push({
      type: "overconfident_recommendation",
      message: "Konfidenz wirkt zu hoch trotz lückenhafter Bewertungsannahmen.",
      severity: "medium",
      affectedSection: "Konfidenz",
      suggestedFix: "Bewertungs- und Gesamt-Konfidenz reduzieren.",
    });
  }

  const severity = maxSeverity(issues);
  const hasHigh = severity === "high";
  const status: GateStatus = hasHigh ? "review_required" : "ok";
  const suggestedFixes = issues.map((i) => i.suggestedFix).filter((f): f is string => !!f);

  const explanation =
    status === "review_required"
      ? "Review erforderlich: Vera hat einen schwerwiegenden Widerspruch gefunden. Rating mit Warnhinweis, Gesamt-Konfidenz reduziert. Bitte Vera-Korrekturen prüfen und übernehmen."
      : issues.length
        ? "Analyse mit Hinweisen verifiziert — keine blockierenden Widersprüche."
        : "Analyse fakten-geprüft, keine Beanstandungen.";

  return {
    status,
    severity,
    issues,
    blocksFinalRating: hasHigh,
    reduceConfidence: status === "review_required",
    suggestedFixes,
    appliedFixes: [],
    explanation,
  };
}
