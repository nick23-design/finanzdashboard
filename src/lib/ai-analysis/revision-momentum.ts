/**
 * Earnings Revision Momentum Score (0–100).
 * Uses analyst consensus snapshot (buy/hold/sell distribution + price targets).
 * Note: Historical revision data (EPS estimate changes over 30/90/180 days) is NOT
 * available in the current data model — scored with heavy limitations.
 * Zero LLM calls.
 */

import type { AssetSnapshot } from "@/types/database";
import type { AnalystData } from "@/lib/finance-client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RevisionDirection = "negative" | "neutral" | "positive";

export type RevisionMomentumScore = {
  score: number;
  direction: RevisionDirection;
  epsRevisionPct?: number;
  revenueRevisionPct?: number;
  upwardRevisions?: number;
  downwardRevisions?: number;
  recentSurpriseTrend?: "negative" | "mixed" | "positive";
  interpretation: string;
  limitations: string[];
};

export type RevisionInput = {
  snapshot: AssetSnapshot;
  analystData: AnalystData | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreLinear(value: number, low: number, high: number): number {
  if (value <= low) return 0;
  if (value >= high) return 100;
  return ((value - low) / (high - low)) * 100;
}

function directionFromScore(score: number): RevisionDirection {
  if (score >= 60) return "positive";
  if (score >= 40) return "neutral";
  return "negative";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function calculateRevisionMomentum(input: RevisionInput): RevisionMomentumScore {
  const { snapshot, analystData } = input;
  const limitations: string[] = [];

  limitations.push("EPS-Revisionen über 30/90/180 Tage (Zeitreihe) sind im aktuellen Datenmodell nicht verfügbar.");
  limitations.push("Earnings Surprise-Historie (Beat/Miss-Trend) ist nicht modelliert.");
  limitations.push("Management Guidance Direction ist nicht strukturiert erfasst.");

  if (!analystData) {
    limitations.push("Keine Analystendaten verfügbar; neutrale Bewertung (50).");
    return {
      score: 50,
      direction: "neutral",
      interpretation: "Keine Analystendaten vorhanden. Revisions-Momentum kann nicht bewertet werden.",
      limitations,
    };
  }

  const total =
    (analystData.strong_buy ?? 0) +
    (analystData.buy ?? 0) +
    (analystData.hold ?? 0) +
    (analystData.sell ?? 0) +
    (analystData.strong_sell ?? 0);

  if (total === 0 && analystData.mean_target == null) {
    limitations.push("Analysten-Verteilung und Kursziel fehlen.");
    return {
      score: 50,
      direction: "neutral",
      interpretation: "Keine verwertbaren Analystendaten. Revisions-Momentum neutral gesetzt.",
      limitations,
    };
  }

  let consensusScore = 50;
  let upwardRevisions: number | undefined;
  let downwardRevisions: number | undefined;

  if (total > 0) {
    const bullish = (analystData.strong_buy ?? 0) + (analystData.buy ?? 0);
    const bearish = (analystData.sell ?? 0) + (analystData.strong_sell ?? 0);
    upwardRevisions = bullish;
    downwardRevisions = bearish;

    const bullRatio = bullish / total;
    const bearRatio = bearish / total;
    const netSentiment = bullRatio - bearRatio; // -1 to +1

    consensusScore = scoreLinear(netSentiment, -0.50, 0.80);
  }

  let upsideScore = 50;
  if (snapshot.price != null && snapshot.price > 0 && analystData.mean_target != null) {
    const upside = (analystData.mean_target - snapshot.price) / snapshot.price;
    upsideScore = scoreLinear(upside, -0.10, 0.30);
  }

  // Target spread as uncertainty penalty
  let uncertaintyPenalty = 0;
  if (
    analystData.mean_target != null &&
    analystData.high_target != null &&
    analystData.low_target != null &&
    analystData.mean_target > 0
  ) {
    const spread = (analystData.high_target - analystData.low_target) / analystData.mean_target;
    uncertaintyPenalty = scoreLinear(spread, 0, 0.80) * 0.15;
  }

  const rawScore = consensusScore * 0.55 + upsideScore * 0.45;
  const score = Math.round(Math.max(0, Math.min(100, rawScore - uncertaintyPenalty)));
  const direction = directionFromScore(score);

  let interpretation: string;
  if (total > 0) {
    const bullish = (analystData.strong_buy ?? 0) + (analystData.buy ?? 0);
    const bullPct = ((bullish / total) * 100).toFixed(0);
    const upsidePct = snapshot.price && analystData.mean_target
      ? (((analystData.mean_target - snapshot.price) / snapshot.price) * 100).toFixed(1)
      : null;
    interpretation = `${total} Analysten: ${bullPct}% bullisch${upsidePct ? `, Kursziel-Upside ${upsidePct}%` : ""}. Historische Revisionen nicht verfügbar.`;
  } else {
    interpretation = `Mittleres Kursziel ${analystData.mean_target?.toFixed(2) ?? "N/A"}. Historische Revisionen nicht verfügbar.`;
  }

  return {
    score,
    direction,
    upwardRevisions,
    downwardRevisions,
    interpretation,
    limitations,
  };
}
