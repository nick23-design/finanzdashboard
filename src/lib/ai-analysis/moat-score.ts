/**
 * Deterministic Moat / Durability Score (0–100).
 * Infers competitive advantage from financial stability signals.
 * Zero LLM calls.
 */

import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";
import type { SectorTemplateKey } from "./valuation-model";
import { SECTOR_DCF_DEFAULTS } from "./dcf-pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MoatGrade = "none" | "narrow" | "moderate" | "wide" | "exceptional";

export type MoatScore = {
  score: number;
  grade: MoatGrade;
  drivers: string[];
  risks: string[];
  evidence: string[];
  limitations: string[];
};

export type MoatScoreInput = {
  snapshot: AssetSnapshot;
  edgarFacts: EdgarFacts | null;
  sectorTemplate: SectorTemplateKey;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreLinear(value: number, low: number, high: number): number {
  if (value <= low) return 0;
  if (value >= high) return 100;
  return ((value - low) / (high - low)) * 100;
}

function gradeFromScore(score: number): MoatGrade {
  if (score >= 80) return "exceptional";
  if (score >= 60) return "wide";
  if (score >= 40) return "moderate";
  if (score >= 20) return "narrow";
  return "none";
}

function ttm(arr: { value: number }[]): number | null {
  if (arr.length < 4) return null;
  return arr.slice(0, 4).reduce((s, q) => s + q.value, 0);
}

// ─── Component scorers ────────────────────────────────────────────────────────

function scorePricingPower(grossMargin: number | null, sectorExpectedGrossMargin: number): { score: number; available: boolean } {
  if (grossMargin === null) return { score: 50, available: false };
  // Score relative to sector expectation + absolute threshold
  const absoluteScore = scoreLinear(grossMargin, 0.10, 0.85);
  const relativeScore = scoreLinear(grossMargin / Math.max(sectorExpectedGrossMargin, 0.10), 0.5, 2.0);
  return { score: (absoluteScore + relativeScore) / 2, available: true };
}

function scoreMarginStability(quarterlyGrossProfit: number[], quarterlyRevenue: number[]): { score: number; available: boolean } {
  if (quarterlyGrossProfit.length < 4 || quarterlyRevenue.length < 4) return { score: 50, available: false };

  const margins = quarterlyGrossProfit.slice(0, 4).map((gp, i) => {
    const rev = quarterlyRevenue[i];
    return rev > 0 ? gp / rev : null;
  }).filter((m): m is number => m !== null);

  if (margins.length < 3) return { score: 50, available: false };

  const avg = margins.reduce((s, m) => s + m, 0) / margins.length;
  const maxDev = Math.max(...margins.map(m => Math.abs(m - avg)));
  const relativeVariability = avg > 0 ? maxDev / avg : 1;

  // Low variability (< 5%) = wide moat; high variability (>30%) = no moat
  return { score: scoreLinear(1 - relativeVariability, 0.7, 1.0) * 100 / 100, available: true };
}

function scoreFcfDurability(
  fcf: number | null,
  ttmRevenue: number | null,
): { score: number; available: boolean } {
  if (fcf === null || ttmRevenue === null || ttmRevenue <= 0) return { score: 50, available: false };

  const fcfMargin = fcf / ttmRevenue;
  if (fcfMargin < 0) return { score: 10, available: true };
  return { score: scoreLinear(fcfMargin, 0, 0.25), available: true };
}

function scoreRevenueResilience(
  revenueGrowth: number | null,
  quarterlyRevenues: number[],
): { score: number; available: boolean } {
  if (revenueGrowth === null && quarterlyRevenues.length < 4) return { score: 50, available: false };

  let total = 0;
  let weight = 0;

  if (revenueGrowth !== null) {
    // Positive growth = resilient business
    const growthScore = scoreLinear(revenueGrowth, -0.05, 0.25);
    total += growthScore * 0.5;
    weight += 0.5;
  }

  if (quarterlyRevenues.length >= 4) {
    // Look for consistent revenue (not declining quarters)
    const positiveQtrs = quarterlyRevenues.slice(0, 4).filter((_, i, arr) => i === 0 || arr[i] >= arr[i - 1]).length;
    const consistencyScore = (positiveQtrs / 4) * 100;
    total += consistencyScore * 0.5;
    weight += 0.5;
  }

  if (weight === 0) return { score: 50, available: false };
  return { score: total / weight, available: true };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function calculateMoatScore(input: MoatScoreInput): MoatScore {
  const { snapshot, edgarFacts, sectorTemplate } = input;
  const defaults = SECTOR_DCF_DEFAULTS[sectorTemplate] ?? SECTOR_DCF_DEFAULTS.general_quality_growth;
  const limitations: string[] = [];

  const ttmRevenue = edgarFacts ? ttm(edgarFacts.revenue) : null;
  const ttmGrossProfit = edgarFacts ? ttm(edgarFacts.gross_profit) : null;

  const grossMargin =
    ttmGrossProfit != null && ttmRevenue != null && ttmRevenue > 0
      ? ttmGrossProfit / ttmRevenue
      : null;

  const sectorExpectedGrossMargin = defaults.opMargin + 0.20;
  const quarterlyRevenues = edgarFacts?.revenue.slice(0, 8).map(q => q.value) ?? [];
  const quarterlyGrossProfit = edgarFacts?.gross_profit.slice(0, 8).map(q => q.value) ?? [];
  const quarterlyRevenueForMargin = edgarFacts?.revenue.slice(0, 8).map(q => q.value) ?? [];

  const pricingPower = scorePricingPower(grossMargin, sectorExpectedGrossMargin);
  const marginStab = scoreMarginStability(quarterlyGrossProfit, quarterlyRevenueForMargin);
  const fcfDurability = scoreFcfDurability(snapshot.free_cashflow ?? null, ttmRevenue);
  const revenueResilience = scoreRevenueResilience(snapshot.revenue_growth ?? null, quarterlyRevenues);

  if (!pricingPower.available) limitations.push("Bruttomarge nicht verfügbar; Preissetzungsmacht nicht bewertet.");
  if (!marginStab.available) limitations.push("Margen-Stabilität mangels EDGAR-Quartalsdaten eingeschränkt.");
  if (!fcfDurability.available) limitations.push("FCF-Durabilität mangels Cashflow-Daten eingeschränkt.");
  limitations.push("Qualitative Moat-Signale (Netzwerkeffekte, Switching Costs, Markenprämie) sind nicht modelliert und können die Bewertung verschieben.");

  const components = {
    pricingPower: pricingPower.score,
    marginStability: marginStab.score,
    fcfDurability: fcfDurability.score,
    revenueResilience: revenueResilience.score,
  };

  const score = Math.round(
    components.pricingPower * 0.30 +
    components.marginStability * 0.30 +
    components.fcfDurability * 0.25 +
    components.revenueResilience * 0.15,
  );

  const grade = gradeFromScore(score);

  const drivers: string[] = [];
  const risks: string[] = [];
  const evidence: string[] = [];

  if (grossMargin !== null) {
    if (grossMargin > 0.60) {
      drivers.push("Hohe Bruttomarge deutet auf starke Preissetzungsmacht oder Kostenvorteile hin.");
      evidence.push(`Bruttomarge: ${(grossMargin * 100).toFixed(1)}%`);
    } else if (grossMargin < 0.25) {
      risks.push(`Niedrige Bruttomarge (${(grossMargin * 100).toFixed(1)}%) lässt wenig Spielraum für Wettbewerbsdruck.`);
    }
  }
  if (snapshot.free_cashflow != null && ttmRevenue != null && ttmRevenue > 0) {
    const fcfM = snapshot.free_cashflow / ttmRevenue;
    if (fcfM > 0.15) {
      drivers.push("Hohe FCF-Conversion deutet auf nachhaltige Ertragskraft hin.");
      evidence.push(`FCF-Margin: ${(fcfM * 100).toFixed(1)}%`);
    }
  }
  if (snapshot.revenue_growth != null && snapshot.revenue_growth > 0.10) {
    drivers.push("Konsistentes Umsatzwachstum stärkt die Nachfrageresilienzen.");
  }
  if (marginStab.available && marginStab.score > 70) {
    drivers.push("Stabile Quartalsmarginen deuten auf strukturelle Wettbewerbsvorteile hin.");
  } else if (marginStab.available && marginStab.score < 30) {
    risks.push("Volatile Marginen können auf zyklische Exponierung oder Preisdruck hinweisen.");
  }

  return { score, grade, drivers, risks, evidence, limitations };
}
