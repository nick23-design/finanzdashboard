/**
 * Deterministic Quality Score (0–100).
 * Profitability, margin quality, cash conversion, balance sheet, stability.
 * Zero LLM calls.
 */

import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";
import type { SectorTemplateKey } from "./valuation-model";
import { SECTOR_DCF_DEFAULTS } from "./dcf-pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

export type QualityGrade = "poor" | "weak" | "average" | "good" | "excellent";

export type QualityScore = {
  score: number;
  grade: QualityGrade;
  components: {
    profitability: number;
    marginQuality: number;
    cashConversion: number;
    balanceSheet: number;
    stability: number;
  };
  strengths: string[];
  weaknesses: string[];
  limitations: string[];
};

export type QualityScoreInput = {
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

function scoreInverse(value: number, low: number, high: number): number {
  return 100 - scoreLinear(value, low, high);
}

function ttm(arr: { value: number }[]): number | null {
  if (arr.length < 4) return null;
  const total = arr.slice(0, 4).reduce((s, q) => s + q.value, 0);
  return total;
}

function gradeFromScore(score: number): QualityGrade {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "average";
  if (score >= 20) return "weak";
  return "poor";
}

// ─── Component scorers ────────────────────────────────────────────────────────

function scoreProfitability(
  grossMargin: number | null,
  netMargin: number | null,
  sectorOpMargin: number,
): { score: number; available: boolean } {
  if (grossMargin === null && netMargin === null) return { score: 50, available: false };

  let total = 0;
  let weight = 0;

  if (grossMargin !== null) {
    // Score gross margin relative to sector expected operating margin (gross > op is expected)
    const sectorGrossProxy = sectorOpMargin + 0.20; // rough proxy
    total += scoreLinear(grossMargin, 0, Math.max(sectorGrossProxy * 2.5, 0.80)) * 0.6;
    weight += 0.6;
  }

  if (netMargin !== null) {
    total += scoreLinear(netMargin, -0.05, 0.30) * 0.4;
    weight += 0.4;
  }

  return { score: weight > 0 ? total / weight : 50, available: true };
}

function scoreMarginQuality(
  grossMargin: number | null,
  fcfMargin: number | null,
  sectorOpMargin: number,
): { score: number; available: boolean } {
  if (grossMargin === null && fcfMargin === null) return { score: 50, available: false };

  let total = 0;
  let weight = 0;

  if (grossMargin !== null) {
    total += scoreLinear(grossMargin, 0.10, 0.85) * 0.5;
    weight += 0.5;
  }

  if (fcfMargin !== null) {
    total += scoreLinear(fcfMargin, 0, Math.max(sectorOpMargin * 0.9, 0.20)) * 0.5;
    weight += 0.5;
  }

  return { score: weight > 0 ? total / weight : 50, available: true };
}

function scoreCashConversion(
  fcf: number | null,
  ttmNetIncome: number | null,
  ttmRevenue: number | null,
): { score: number; available: boolean } {
  if (fcf === null) return { score: 50, available: false };

  if (ttmNetIncome !== null && ttmNetIncome > 0) {
    const fcfConversion = fcf / ttmNetIncome;
    return {
      score: scoreLinear(fcfConversion, 0, 1.5),
      available: true,
    };
  }

  if (ttmRevenue !== null && ttmRevenue > 0) {
    const fcfMargin = fcf / ttmRevenue;
    return {
      score: scoreLinear(fcfMargin, 0, 0.20),
      available: true,
    };
  }

  return { score: fcf > 0 ? 55 : 25, available: true };
}

function scoreBalanceSheet(debtToEquity: number | null): { score: number; available: boolean } {
  if (debtToEquity === null) return { score: 50, available: false };
  // 0 or negative D/E = excellent; high D/E = poor
  if (debtToEquity <= 0) return { score: 95, available: true };
  return { score: scoreInverse(debtToEquity, 0, 4), available: true };
}

function scoreStability(
  revenueGrowth: number | null,
  quarterlyRevenues: number[],
): { score: number; available: boolean } {
  let total = 0;
  let weight = 0;

  if (revenueGrowth !== null) {
    const growthScore = scoreLinear(revenueGrowth, -0.10, 0.30);
    total += growthScore * 0.5;
    weight += 0.5;
  }

  if (quarterlyRevenues.length >= 4) {
    const sorted = [...quarterlyRevenues].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    const avg = quarterlyRevenues.reduce((s, v) => s + v, 0) / quarterlyRevenues.length;
    const relativeVariability = avg > 0 ? range / avg : 1;
    const stabilityScore = scoreInverse(relativeVariability, 0, 1.0);
    total += stabilityScore * 0.5;
    weight += 0.5;
  }

  if (weight === 0) return { score: 50, available: false };
  return { score: total / weight, available: true };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function calculateQualityScore(input: QualityScoreInput): QualityScore {
  const { snapshot, edgarFacts, sectorTemplate } = input;
  const defaults = SECTOR_DCF_DEFAULTS[sectorTemplate] ?? SECTOR_DCF_DEFAULTS.general_quality_growth;
  const limitations: string[] = [];

  const ttmRevenue = edgarFacts ? ttm(edgarFacts.revenue) : null;
  const ttmNetIncome = edgarFacts ? ttm(edgarFacts.net_income) : null;
  const ttmGrossProfit = edgarFacts ? ttm(edgarFacts.gross_profit) : null;

  const grossMargin =
    ttmGrossProfit != null && ttmRevenue != null && ttmRevenue > 0
      ? ttmGrossProfit / ttmRevenue
      : null;
  const netMargin =
    ttmNetIncome != null && ttmRevenue != null && ttmRevenue > 0
      ? ttmNetIncome / ttmRevenue
      : null;
  const fcfMargin =
    snapshot.free_cashflow != null && ttmRevenue != null && ttmRevenue > 0
      ? snapshot.free_cashflow / ttmRevenue
      : null;

  const quarterlyRevenues = edgarFacts?.revenue.slice(0, 8).map(q => q.value) ?? [];

  const prof = scoreProfitability(grossMargin, netMargin, defaults.opMargin);
  const mq = scoreMarginQuality(grossMargin, fcfMargin, defaults.opMargin);
  const cc = scoreCashConversion(snapshot.free_cashflow ?? null, ttmNetIncome, ttmRevenue);
  const bs = scoreBalanceSheet(snapshot.debt_to_equity ?? null);
  const stab = scoreStability(snapshot.revenue_growth ?? null, quarterlyRevenues);

  if (!prof.available) limitations.push("Bruttomarge und Nettomarge nicht aus EDGAR berechenbar.");
  if (!mq.available) limitations.push("Margenqualität mangels EDGAR-Daten eingeschränkt bewertet.");
  if (!cc.available) limitations.push("Cash-Conversion mangels FCF-Daten eingeschränkt bewertet.");
  if (!bs.available) limitations.push("Debt/Equity fehlt; Bilanzqualität nicht bewertet.");
  if (!stab.available) limitations.push("Umsatzstabilität mangels EDGAR-Quartalsdaten eingeschränkt bewertet.");

  const weights = { profitability: 0.30, marginQuality: 0.20, cashConversion: 0.20, balanceSheet: 0.15, stability: 0.15 };
  const components = {
    profitability: Math.round(prof.score),
    marginQuality: Math.round(mq.score),
    cashConversion: Math.round(cc.score),
    balanceSheet: Math.round(bs.score),
    stability: Math.round(stab.score),
  };

  const totalScore = Math.round(
    prof.score * weights.profitability +
    mq.score * weights.marginQuality +
    cc.score * weights.cashConversion +
    bs.score * weights.balanceSheet +
    stab.score * weights.stability,
  );

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (grossMargin !== null) {
    if (grossMargin > 0.60) strengths.push(`Sehr hohe Bruttomarge (${(grossMargin * 100).toFixed(0)}%) deutet auf starke Preissetzungsmacht hin.`);
    else if (grossMargin < 0.20) weaknesses.push(`Niedrige Bruttomarge (${(grossMargin * 100).toFixed(0)}%) begrenzt Gewinnpuffer.`);
  }
  if (fcfMargin !== null) {
    if (fcfMargin > 0.15) strengths.push(`Starker Free-Cashflow-Margin (${(fcfMargin * 100).toFixed(0)}%) zeigt hohe Kapitaleffizienz.`);
    else if (fcfMargin < 0) weaknesses.push(`Negativer FCF-Margin: Unternehmen konsumiert derzeit Kapital.`);
  }
  if (snapshot.debt_to_equity !== null) {
    if (snapshot.debt_to_equity < 0.5) strengths.push(`Solide Bilanz (D/E ${snapshot.debt_to_equity.toFixed(2)}) bietet Flexibilität.`);
    else if (snapshot.debt_to_equity > 3) weaknesses.push(`Hohe Verschuldung (D/E ${snapshot.debt_to_equity.toFixed(2)}) erhöht Zinsrisiko.`);
  }
  if (snapshot.revenue_growth !== null) {
    if (snapshot.revenue_growth > 0.20) strengths.push(`Starkes Umsatzwachstum (${(snapshot.revenue_growth * 100).toFixed(0)}% YoY).`);
    else if (snapshot.revenue_growth < 0) weaknesses.push(`Umsatzrückgang (${(snapshot.revenue_growth * 100).toFixed(0)}% YoY).`);
  }

  return {
    score: totalScore,
    grade: gradeFromScore(totalScore),
    components,
    strengths,
    weaknesses,
    limitations,
  };
}
