/**
 * Risk Score (0–100, higher = riskier).
 * Valuation risk, balance sheet risk, business risk, cyclicality, data quality.
 * Zero LLM calls.
 */

import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";
import type { SectorTemplateKey } from "./valuation-model";
import { SECTOR_DCF_DEFAULTS } from "./dcf-pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "moderate" | "elevated" | "high" | "severe";

export type RiskScore = {
  score: number;
  level: RiskLevel;
  components: {
    valuationRisk: number;
    balanceSheetRisk: number;
    businessRisk: number;
    cyclicalityRisk: number;
    dataQualityRisk: number;
  };
  keyRisks: string[];
  mitigants: string[];
  limitations: string[];
};

export type RiskScoreInput = {
  snapshot: AssetSnapshot;
  edgarFacts: EdgarFacts | null;
  sectorTemplate: SectorTemplateKey;
  dataQuality?: { completeness_score?: number; missing_fields?: string[] } | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CYCLICALITY_BY_SECTOR: Partial<Record<SectorTemplateKey, number>> = {
  energy: 80,
  automotive: 75,
  cyclical_industrial: 70,
  semiconductor: 60,
  bank: 55,
  reit: 50,
  healthcare_pharma: 25,
  consumer_brand: 30,
  mega_cap_cloud_software: 30,
  saas: 25,
  payments_fintech: 35,
  marketplace_platform: 40,
  insurance: 45,
  speculative_growth: 50,
  general_quality_growth: 40,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreLinear(value: number, low: number, high: number): number {
  if (value <= low) return 0;
  if (value >= high) return 100;
  return ((value - low) / (high - low)) * 100;
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 80) return "severe";
  if (score >= 60) return "high";
  if (score >= 45) return "elevated";
  if (score >= 25) return "moderate";
  return "low";
}

function ttm(arr: { value: number }[]): number | null {
  if (arr.length < 4) return null;
  return arr.slice(0, 4).reduce((s, q) => s + q.value, 0);
}

// ─── Component scorers ────────────────────────────────────────────────────────

function scoreValuationRisk(pe: number | null, fcfYield: number | null, fairPeProxy: number): number {
  let total = 0;
  let weight = 0;

  if (pe !== null && pe > 0) {
    // Higher PE relative to fair PE = more valuation risk
    const risk = scoreLinear(pe, fairPeProxy, fairPeProxy * 3);
    total += risk * 0.6;
    weight += 0.6;
  } else if (pe !== null && pe <= 0) {
    total += 75 * 0.6; // negative/zero PE = elevated risk
    weight += 0.6;
  }

  if (fcfYield !== null) {
    // Low or negative FCF yield = overvaluation risk
    const risk = fcfYield < 0 ? 85 : scoreLinear(1 - fcfYield, 0.92, 1.0);
    total += risk * 0.4;
    weight += 0.4;
  }

  return weight > 0 ? total / weight : 50;
}

function scoreBalanceSheetRisk(debtToEquity: number | null): number {
  if (debtToEquity === null) return 45; // unknown = moderate elevated risk
  if (debtToEquity <= 0) return 5;
  if (debtToEquity < 0.5) return 15;
  if (debtToEquity < 1.5) return 30;
  if (debtToEquity < 3) return 55;
  return scoreLinear(debtToEquity, 3, 8);
}

function scoreBusinessRisk(
  fcf: number | null,
  ttmRevenue: number | null,
  ttmNetIncome: number | null,
  revenueGrowth: number | null,
): number {
  let total = 0;
  let weight = 0;

  if (fcf !== null) {
    const fcfRisk = fcf < 0 ? 75 : 25;
    total += fcfRisk * 0.4;
    weight += 0.4;
  }

  if (ttmNetIncome !== null) {
    const incomeRisk = ttmNetIncome < 0 ? 70 : 20;
    total += incomeRisk * 0.3;
    weight += 0.3;
  }

  if (revenueGrowth !== null) {
    const growthRisk = revenueGrowth < -0.10 ? 70 : revenueGrowth < 0 ? 50 : scoreLinear(1 - Math.min(revenueGrowth, 0.30), 0.7, 1.0) * 0.40;
    total += growthRisk * 0.3;
    weight += 0.3;
  }

  return weight > 0 ? total / weight : 50;
}

function scoreDataQualityRisk(
  dataQuality: { completeness_score?: number; missing_fields?: string[] } | null | undefined,
): number {
  if (!dataQuality) return 30; // unknown = some risk
  const completeness = dataQuality.completeness_score ?? 80;
  return scoreLinear(100 - completeness, 0, 60);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function calculateRiskScore(input: RiskScoreInput): RiskScore {
  const { snapshot, edgarFacts, sectorTemplate, dataQuality } = input;
  const defaults = SECTOR_DCF_DEFAULTS[sectorTemplate] ?? SECTOR_DCF_DEFAULTS.general_quality_growth;
  const limitations: string[] = [];

  const ttmRevenue = edgarFacts ? ttm(edgarFacts.revenue) : null;
  const ttmNetIncome = edgarFacts ? ttm(edgarFacts.net_income) : null;
  const fcfYield =
    snapshot.free_cashflow != null && snapshot.market_cap != null && snapshot.market_cap > 0
      ? snapshot.free_cashflow / snapshot.market_cap
      : null;

  const fairPe = defaults.opMargin > 0
    ? Math.max(8, Math.min(50, (1 - defaults.reinvestment) / Math.max(defaults.wacc - defaults.terminalGrowth, 0.01)))
    : 20;

  const valRisk = scoreValuationRisk(snapshot.pe_ratio ?? null, fcfYield, fairPe);
  const bsRisk = scoreBalanceSheetRisk(snapshot.debt_to_equity ?? null);
  const bizRisk = scoreBusinessRisk(snapshot.free_cashflow ?? null, ttmRevenue, ttmNetIncome, snapshot.revenue_growth ?? null);
  const cycRisk = CYCLICALITY_BY_SECTOR[sectorTemplate] ?? 40;
  const dqRisk = scoreDataQualityRisk(dataQuality);

  if (snapshot.debt_to_equity == null) limitations.push("D/E fehlt; Bilanzrisiko konservativ auf 45 gesetzt.");
  if (snapshot.pe_ratio == null && fcfYield === null) limitations.push("Weder KGV noch FCF-Yield verfügbar; Bewertungsrisiko eingeschränkt.");
  if (!edgarFacts) limitations.push("Keine EDGAR-Daten; Geschäftsrisiko eingeschränkt bewertet.");
  limitations.push("Geopolitische, regulatorische und Konzentrationsrisiken sind im Modell nicht erfasst.");

  const weights = { valuationRisk: 0.25, balanceSheetRisk: 0.25, businessRisk: 0.25, cyclicalityRisk: 0.15, dataQualityRisk: 0.10 };
  const score = Math.round(
    valRisk * weights.valuationRisk +
    bsRisk * weights.balanceSheetRisk +
    bizRisk * weights.businessRisk +
    cycRisk * weights.cyclicalityRisk +
    dqRisk * weights.dataQualityRisk,
  );

  const components = {
    valuationRisk: Math.round(valRisk),
    balanceSheetRisk: Math.round(bsRisk),
    businessRisk: Math.round(bizRisk),
    cyclicalityRisk: Math.round(cycRisk),
    dataQualityRisk: Math.round(dqRisk),
  };

  const keyRisks: string[] = [];
  const mitigants: string[] = [];

  if (valRisk > 60) keyRisks.push("Erhöhtes Bewertungsrisiko — Premium lässt wenig Fehlertoleranz.");
  if (bsRisk > 55) keyRisks.push(`Hohe Verschuldung (D/E ${snapshot.debt_to_equity?.toFixed(1) ?? "N/A"}) erhöht Refinanzierungsrisiko.`);
  if (bizRisk > 60) keyRisks.push("Negativer FCF oder Nettoverlust signalisiert operativen Stress.");
  if (cycRisk > 60) keyRisks.push("Stark zyklischer Sektor — konjunkturelle Abschwächung trifft überproportional.");
  if (dqRisk > 50) keyRisks.push("Datenlücken erhöhen Analyseunsicherheit.");

  if (valRisk < 30) mitigants.push("Attraktive Bewertung bietet Sicherheitsmarge.");
  if (bsRisk < 20) mitigants.push("Starke Bilanz reduziert Ausfall- und Liquiditätsrisiko.");
  if (snapshot.free_cashflow != null && snapshot.free_cashflow > 0) mitigants.push("Positiver FCF sichert operative Flexibilität.");

  return {
    score,
    level: levelFromScore(score),
    components,
    keyRisks,
    mitigants,
    limitations,
  };
}
