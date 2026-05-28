/**
 * Price Momentum / Technical Trend Score (0–100).
 * Uses RSI, MA50, MA200 from the asset snapshot.
 * Note: 3/6/12-month historical returns not available in current data model.
 * Zero LLM calls.
 */

import type { AssetSnapshot } from "@/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MomentumTrend = "bearish" | "neutral" | "bullish";

export type MomentumScore = {
  score: number;
  trend: MomentumTrend;
  priceVs50dPct?: number;
  priceVs200dPct?: number;
  return3mPct?: number;
  return6mPct?: number;
  return12mPct?: number;
  relativeStrengthPct?: number;
  interpretation: string;
  limitations: string[];
};

export type MomentumInput = {
  snapshot: AssetSnapshot;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreLinear(value: number, low: number, high: number): number {
  if (value <= low) return 0;
  if (value >= high) return 100;
  return ((value - low) / (high - low)) * 100;
}

function trendFromScore(score: number): MomentumTrend {
  if (score >= 60) return "bullish";
  if (score >= 40) return "neutral";
  return "bearish";
}

function scoreRsi(rsi: number): number {
  // RSI 30-50: neutral-weak, 50-70: neutral-strong, >70: overbought (risk), <30: oversold (opportunity)
  if (rsi < 20) return 25; // extreme oversold — potential but high risk
  if (rsi < 30) return 40; // oversold — mild opportunity
  if (rsi < 45) return 45; // slightly weak
  if (rsi <= 55) return 55; // neutral zone
  if (rsi <= 65) return 65; // moderately bullish
  if (rsi <= 70) return 70; // bullish
  if (rsi <= 80) return 55; // overbought — momentum present but risk of reversal
  return 35; // extreme overbought
}

function scorePriceVsMa(pricePct: number, range: number): number {
  // pricePct = (price - ma) / ma
  // Negative = below MA (bearish), positive = above MA (bullish)
  // range: 50dMA uses ±20%, 200dMA uses ±30%
  return scoreLinear(pricePct, -range, range);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function calculateMomentumScore(input: MomentumInput): MomentumScore {
  const { snapshot } = input;
  const limitations: string[] = [];

  limitations.push("3-, 6- und 12-Monats-Renditen sind im aktuellen Datenmodell nicht verfügbar.");
  limitations.push("Relative Stärke vs. Sektor/Index nicht modelliert.");

  const { price, rsi, moving_average_50: ma50, moving_average_200: ma200 } = snapshot;

  if (!price || price <= 0) {
    limitations.push("Kein gültiger Kurs vorhanden; Momentum kann nicht bewertet werden.");
    return {
      score: 50,
      trend: "neutral",
      interpretation: "Kein gültiger Kurs — Momentum nicht berechenbar.",
      limitations,
    };
  }

  let totalScore = 0;
  let totalWeight = 0;
  const parts: string[] = [];

  let priceVs50dPct: number | undefined;
  let priceVs200dPct: number | undefined;

  if (rsi != null) {
    const rsiScore = scoreRsi(rsi);
    totalScore += rsiScore * 0.30;
    totalWeight += 0.30;
    parts.push(`RSI ${rsi.toFixed(0)}`);
  } else {
    limitations.push("RSI nicht verfügbar.");
  }

  if (ma50 != null && ma50 > 0) {
    priceVs50dPct = (price - ma50) / ma50;
    const ma50Score = scorePriceVsMa(priceVs50dPct, 0.20);
    totalScore += ma50Score * 0.35;
    totalWeight += 0.35;
    parts.push(`Kurs ${priceVs50dPct >= 0 ? "+" : ""}${(priceVs50dPct * 100).toFixed(1)}% ggü. 50-T-MA`);
  } else {
    limitations.push("50-Tage-Durchschnitt nicht verfügbar.");
  }

  if (ma200 != null && ma200 > 0) {
    priceVs200dPct = (price - ma200) / ma200;
    const ma200Score = scorePriceVsMa(priceVs200dPct, 0.30);
    totalScore += ma200Score * 0.35;
    totalWeight += 0.35;
    parts.push(`Kurs ${priceVs200dPct >= 0 ? "+" : ""}${(priceVs200dPct * 100).toFixed(1)}% ggü. 200-T-MA`);
  } else {
    limitations.push("200-Tage-Durchschnitt nicht verfügbar.");
  }

  const score = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 50;
  const trend = trendFromScore(score);

  let interpretation: string;
  if (parts.length === 0) {
    interpretation = "Keine technischen Indikatoren verfügbar.";
  } else {
    const trendLabel = trend === "bullish" ? "Aufwärtstrend" : trend === "bearish" ? "Abwärtstrend" : "neutral";
    interpretation = `Technischer Trend: ${trendLabel}. ${parts.join(", ")}.`;
    if (rsi != null && rsi > 70) {
      interpretation += " RSI deutet auf möglicherweise überkaufte Situation hin.";
    } else if (rsi != null && rsi < 30) {
      interpretation += " RSI deutet auf überverkaufte Situation hin — potenzielle Erholungschance.";
    }
  }

  return {
    score,
    trend,
    priceVs50dPct,
    priceVs200dPct,
    interpretation,
    limitations,
  };
}
