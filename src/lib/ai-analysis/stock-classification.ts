/**
 * Stock Type Classifier.
 * Derives primary and secondary stock types from factor scores + snapshot data.
 * Zero LLM calls.
 */

import type { AssetSnapshot } from "@/types/database";
import type { QualityScore } from "./quality-score";
import type { MoatScore } from "./moat-score";
import type { RelativeValuationScore } from "./relative-valuation";
import type { RiskScore } from "./risk-score";
import type { RevisionMomentumScore } from "./revision-momentum";
import type { SectorTemplateKey } from "./valuation-model";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StockType =
  | "quality_compounder"
  | "growth"
  | "value"
  | "deep_value"
  | "cyclical"
  | "turnaround"
  | "speculative"
  | "income"
  | "momentum"
  | "distressed";

export type StockClassification = {
  primaryType: StockType;
  secondaryTypes: StockType[];
  rationale: string;
  confidence: 1 | 2 | 3 | 4 | 5;
};

export type ClassificationInput = {
  snapshot: AssetSnapshot;
  sectorTemplate: SectorTemplateKey;
  quality: QualityScore;
  moat: MoatScore;
  relativeValuation: RelativeValuationScore;
  risk: RiskScore;
  revision: RevisionMomentumScore;
};

// ─── Sector cyclicality map ───────────────────────────────────────────────────

const CYCLICAL_SECTORS: SectorTemplateKey[] = ["energy", "automotive", "cyclical_industrial"];
const INCOME_SECTORS: SectorTemplateKey[] = ["reit", "insurance", "consumer_brand"];
const SPEC_SECTORS: SectorTemplateKey[] = ["speculative_growth"];

// ─── Classifier ──────────────────────────────────────────────────────────────

export function classifyStock(input: ClassificationInput): StockClassification {
  const { snapshot, sectorTemplate, quality, moat, relativeValuation, risk, revision } = input;

  const q = quality.score;
  const m = moat.score;
  const rv = relativeValuation.score;
  const r = risk.score;
  const fcfPositive = snapshot.free_cashflow != null && snapshot.free_cashflow > 0;
  const revenueGrowth = snapshot.revenue_growth ?? 0;
  const pe = snapshot.pe_ratio;
  const revDir = revision.direction;

  // Track candidate types with weights
  const candidates: { type: StockType; weight: number }[] = [];

  // Quality Compounder: high quality, strong moat, business not distressed, stable
  if (q >= 65 && m >= 55 && fcfPositive && risk.components.businessRisk < 40) {
    candidates.push({ type: "quality_compounder", weight: q * 0.4 + m * 0.4 + (100 - r) * 0.2 });
  }

  // Growth: high revenue growth, moderate-to-good quality, not yet quality compounder
  if (revenueGrowth > 0.15 && q >= 40) {
    candidates.push({ type: "growth", weight: revenueGrowth * 200 + q * 0.3 });
  }

  // Speculative: weak quality/FCF, high uncertainty, or spec sector
  if (q < 40 || !fcfPositive || SPEC_SECTORS.includes(sectorTemplate)) {
    const specScore = (100 - q) * 0.4 + r * 0.4 + (!fcfPositive ? 20 : 0);
    candidates.push({ type: "speculative", weight: specScore });
  }

  // Cyclical: cyclical sector or high cyclicality risk
  if (CYCLICAL_SECTORS.includes(sectorTemplate) || risk.components.cyclicalityRisk > 65) {
    candidates.push({ type: "cyclical", weight: risk.components.cyclicalityRisk * 0.7 + 30 });
  }

  // Turnaround: negative/weak growth but improving revision momentum, or recovering FCF
  if (revenueGrowth < 0.05 && revDir === "positive" && risk.components.businessRisk < 70) {
    candidates.push({ type: "turnaround", weight: 60 + revision.score * 0.3 });
  }

  // Distressed: very weak quality, high risk, negative FCF
  if (q < 25 && r > 65 && !fcfPositive) {
    candidates.push({ type: "distressed", weight: r * 0.5 + (100 - q) * 0.3 });
  }

  // Value: cheap valuation, at least moderate quality, not distressed
  if (rv >= 60 && q >= 35 && r < 70) {
    candidates.push({ type: "value", weight: rv * 0.5 + q * 0.3 + (100 - r) * 0.2 });
  }

  // Deep value: very cheap valuation, lower quality, potential value trap signal
  if (rv >= 75 && q < 50) {
    candidates.push({ type: "deep_value", weight: rv * 0.6 + (100 - q) * 0.2 });
  }

  // Income: income-oriented sectors, positive FCF yield, low growth
  if (INCOME_SECTORS.includes(sectorTemplate) && fcfPositive && revenueGrowth < 0.10) {
    const fcfYield = snapshot.free_cashflow != null && snapshot.market_cap != null && snapshot.market_cap > 0
      ? snapshot.free_cashflow / snapshot.market_cap
      : 0;
    if (fcfYield > 0.03) {
      candidates.push({ type: "income", weight: fcfYield * 500 + 40 });
    }
  }

  // Momentum: strong technical trend, not overriding fundamental thesis
  // (Added as secondary type only — never primary unless nothing else qualifies)

  if (candidates.length === 0) {
    candidates.push({ type: "growth", weight: 50 });
  }

  // Sort by weight descending
  candidates.sort((a, b) => b.weight - a.weight);

  const primaryType = candidates[0].type;
  const secondaryTypes = candidates
    .slice(1, 4)
    .filter(c => c.weight > candidates[0].weight * 0.5)
    .map(c => c.type);

  // Confidence based on how dominant the primary type is
  const primaryWeight = candidates[0].weight;
  const secondWeight = candidates[1]?.weight ?? 0;
  const dominance = secondWeight > 0 ? primaryWeight / secondWeight : 3;

  const confidence: 1 | 2 | 3 | 4 | 5 =
    dominance > 2.5 ? 5 :
    dominance > 1.8 ? 4 :
    dominance > 1.3 ? 3 :
    dominance > 1.1 ? 2 : 1;

  const rationale = buildRationale(primaryType, input);

  return { primaryType, secondaryTypes, rationale, confidence };
}

function buildRationale(type: StockType, input: ClassificationInput): string {
  const { quality, moat, relativeValuation, risk, snapshot } = input;
  const growth = snapshot.revenue_growth;

  switch (type) {
    case "quality_compounder":
      return `Qualitäts-Compounder: hohe Qualität (${quality.score}/100), starker Moat (${moat.score}/100), positiver FCF, kontrolliertes Risiko (${risk.score}/100).`;
    case "growth":
      return `Wachstumsaktie: ${growth != null ? (growth * 100).toFixed(0) + "% " : ""}Umsatzwachstum, Qualität ${quality.score}/100. Bewertungs-Upside abhängig von Wachstumskontinuität.`;
    case "value":
      return `Value-Aktie: attraktive Bewertung (${relativeValuation.valuationState}), Qualität ${quality.score}/100. Sicherheitsmarge vorhanden.`;
    case "deep_value":
      return `Deep-Value: sehr günstige Bewertung, aber schwächere Qualität (${quality.score}/100) — Value-Trap-Risiko prüfen.`;
    case "cyclical":
      return `Zyklisches Unternehmen: Sektor mit hoher Konjunkturabhängigkeit. Timing und Zyklusphase entscheidend.`;
    case "turnaround":
      return `Turnaround-Kandidat: schwaches Wachstum, aber positive Revisions-Dynamik. Hohe Ausführungsrisiken.`;
    case "speculative":
      return `Spekulative Aktie: schwache Fundamentaldaten oder negativer FCF. Nur für risikoaffine Anleger geeignet.`;
    case "income":
      return `Einkommens-Aktie: stabiler FCF-Yield, einkommensstabiler Sektor, geringes Wachstum.`;
    case "momentum":
      return `Momentum-Aktie: technische Stärke treibt aktuell die Bewertung.`;
    case "distressed":
      return `Distressed: sehr schwache Qualität (${quality.score}/100), hohes Risiko (${risk.score}/100), negativer FCF. Erhebliche Kapitalverlustgefahr.`;
  }
}
