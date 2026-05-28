/**
 * Deterministic Capital Allocation Score (0–100).
 * Evaluates FCF generation, balance sheet management, and ROIC proxy.
 * Note: buyback/share-count history not available in current data model → flagged as limitation.
 * Zero LLM calls.
 */

import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";
import type { SectorTemplateKey } from "./valuation-model";
import { SECTOR_DCF_DEFAULTS } from "./dcf-pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CapAllocGrade = "poor" | "weak" | "average" | "good" | "excellent";

export type CapitalAllocationScore = {
  score: number;
  grade: CapAllocGrade;
  buybackAssessment?: string;
  dividendAssessment?: string;
  debtAssessment?: string;
  roicVsWaccSpread?: number;
  strengths: string[];
  weaknesses: string[];
  limitations: string[];
};

export type CapAllocationInput = {
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

function gradeFromScore(score: number): CapAllocGrade {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "average";
  if (score >= 20) return "weak";
  return "poor";
}

function ttm(arr: { value: number }[]): number | null {
  if (arr.length < 4) return null;
  return arr.slice(0, 4).reduce((s, q) => s + q.value, 0);
}

// ─── Component scorers ────────────────────────────────────────────────────────

function scoreFcfGeneration(
  fcf: number | null,
  ttmRevenue: number | null,
): { score: number; available: boolean } {
  if (fcf === null) return { score: 50, available: false };
  if (fcf < 0) return { score: 5, available: true };

  if (ttmRevenue !== null && ttmRevenue > 0) {
    const margin = fcf / ttmRevenue;
    return { score: scoreLinear(margin, 0, 0.25), available: true };
  }

  // No revenue: just check FCF is positive
  return { score: 60, available: true };
}

function scoreFcfYield(
  fcf: number | null,
  marketCap: number | null,
): { score: number; available: boolean } {
  if (fcf === null || marketCap === null || marketCap <= 0) return { score: 50, available: false };
  const yield_ = fcf / marketCap;
  if (yield_ < 0) return { score: 10, available: true };
  // 0-2% = low, 4-7% = good, >10% = very high (potentially distressed or deeply undervalued)
  return { score: scoreLinear(yield_, 0, 0.08), available: true };
}

function scoreDebtManagement(
  debtToEquity: number | null,
): { score: number; rating: string; available: boolean } {
  if (debtToEquity === null) return { score: 50, rating: "Nicht bewertet", available: false };
  if (debtToEquity <= 0) return { score: 95, rating: "Netto-Cash-Position", available: true };
  if (debtToEquity < 0.5) return { score: 85, rating: "Sehr geringe Verschuldung", available: true };
  if (debtToEquity < 1.5) return { score: 65, rating: "Moderate Verschuldung", available: true };
  if (debtToEquity < 3.0) return { score: 40, rating: "Erhöhte Verschuldung", available: true };
  return { score: scoreInverse(debtToEquity, 3.0, 8.0), rating: "Hohe Verschuldung", available: true };
}

function computeRoicProxy(
  fcf: number | null,
  marketCap: number | null,
  debtToEquity: number | null,
): number | null {
  if (fcf === null || marketCap === null || marketCap <= 0) return null;
  // Approximate invested capital = market cap * (1 + D/E)
  const de = debtToEquity ?? 0;
  const investedCapital = marketCap * (1 + Math.max(de, 0));
  return investedCapital > 0 ? fcf / investedCapital : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function calculateCapitalAllocationScore(input: CapAllocationInput): CapitalAllocationScore {
  const { snapshot, edgarFacts, sectorTemplate } = input;
  const defaults = SECTOR_DCF_DEFAULTS[sectorTemplate] ?? SECTOR_DCF_DEFAULTS.general_quality_growth;
  const limitations: string[] = [];

  const ttmRevenue = edgarFacts ? ttm(edgarFacts.revenue) : null;
  const fcf = snapshot.free_cashflow ?? null;
  const mktCap = snapshot.market_cap ?? null;
  const de = snapshot.debt_to_equity ?? null;

  const fcfGen = scoreFcfGeneration(fcf, ttmRevenue);
  const fcfYield = scoreFcfYield(fcf, mktCap);
  const debtMgmt = scoreDebtManagement(de);

  if (!fcfGen.available) limitations.push("FCF-Daten fehlen; Kapitaleffizienz kann nicht vollständig bewertet werden.");
  if (!fcfYield.available) limitations.push("FCF-Yield mangels Marktkapitalisierung oder FCF nicht berechenbar.");
  if (!debtMgmt.available) limitations.push("Debt/Equity fehlt; Schuldenmanagement nicht bewertet.");

  limitations.push("Aktienrückkauf-Geschichte (Share Count Trend) fehlt in aktuellen Daten; Buyback-Qualität kann nicht verifiziert werden.");
  limitations.push("Dividenden-Nachhaltigkeit und Ausschüttungsquote mangels Dividendendaten nicht bewertet.");

  const roicProxy = computeRoicProxy(fcf, mktCap, de);
  const roicVsWacc = roicProxy !== null ? roicProxy - defaults.wacc : undefined;

  let roicScore = 50;
  if (roicProxy !== null) {
    if (roicProxy > defaults.wacc) {
      roicScore = scoreLinear(roicProxy - defaults.wacc, 0, 0.15) * 1;
      roicScore = 60 + roicScore * 0.4;
    } else {
      roicScore = 20 + scoreLinear(roicProxy, -0.05, defaults.wacc) * 0.4;
    }
  }

  const weights = { fcfGeneration: 0.30, fcfYield: 0.20, debtManagement: 0.25, roic: 0.25 };
  const score = Math.round(
    fcfGen.score * weights.fcfGeneration +
    fcfYield.score * weights.fcfYield +
    debtMgmt.score * weights.debtManagement +
    roicScore * weights.roic,
  );

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (fcf !== null) {
    if (fcf > 0) {
      if (ttmRevenue && ttmRevenue > 0) {
        const fcfM = fcf / ttmRevenue;
        if (fcfM > 0.15) strengths.push(`Hoher FCF-Margin (${(fcfM * 100).toFixed(0)}%) signalisiert disziplinierte Kapitalsteuerung.`);
      }
    } else {
      weaknesses.push("Negativer Free Cashflow: Unternehmen konsumiert derzeit Kapital.");
    }
  }

  if (mktCap && fcf !== null && mktCap > 0) {
    const yield_ = fcf / mktCap;
    if (yield_ > 0.05) strengths.push(`Attraktiver FCF-Yield (${(yield_ * 100).toFixed(1)}%) für Investoren.`);
  }

  if (de !== null) {
    if (de <= 0.5) strengths.push("Starke Bilanz mit niedriger Verschuldung.");
    if (de > 3) weaknesses.push(`Hohe Verschuldung (D/E ${de.toFixed(1)}) erhöht Risiko bei Zinsanstieg oder Rezession.`);
  }

  if (roicProxy !== null && roicVsWacc !== undefined) {
    if (roicVsWacc > 0.05) strengths.push(`ROIC-Proxy (${(roicProxy * 100).toFixed(1)}%) deutlich über WACC — Wertschaffung für Aktionäre.`);
    else if (roicVsWacc < -0.02) weaknesses.push(`ROIC-Proxy unter WACC — Kapital wird möglicherweise vernichtet.`);
  }

  const debtAssessment = debtMgmt.available ? debtMgmt.rating : undefined;
  const buybackAssessment = "Aktienrückkauf-Geschichte nicht verfügbar. Historische Share Count Trend-Analyse fehlt.";

  return {
    score,
    grade: gradeFromScore(score),
    buybackAssessment,
    debtAssessment,
    roicVsWaccSpread: roicVsWacc,
    strengths,
    weaknesses,
    limitations,
  };
}
