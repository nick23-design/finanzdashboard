/**
 * Alpha Framework Aggregator.
 * Combines all factor scores into a single structured output with dynamic weights.
 * Zero LLM calls. Feed output into Opus synthesis prompt.
 */

import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts, AnalystData } from "@/lib/finance-client";
import type { SectorTemplateKey } from "./valuation-model";

import { calculateQualityScore, type QualityScore } from "./quality-score";
import { calculateMoatScore, type MoatScore } from "./moat-score";
import { calculateCapitalAllocationScore, type CapitalAllocationScore } from "./capital-allocation";
import { calculateRevisionMomentum, type RevisionMomentumScore } from "./revision-momentum";
import { calculateMomentumScore, type MomentumScore } from "./price-momentum";
import { calculateRelativeValuation, type RelativeValuationScore } from "./relative-valuation";
import { calculateRiskScore, type RiskScore } from "./risk-score";
import { classifyStock, type StockClassification, type StockType } from "./stock-classification";
import { calculateReverseDcf, type ReverseDcfOutput } from "./reverse-dcf";
import { buildDcfInputFromSnapshot } from "./dcf-pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlphaGrade = "very_unattractive" | "unattractive" | "neutral" | "attractive" | "very_attractive";

export type AlphaFrameworkOutput = {
  alphaScore: number;
  alphaGrade: AlphaGrade;
  classification: StockClassification;
  quality: QualityScore;
  moat: MoatScore;
  capitalAllocation: CapitalAllocationScore;
  revisionMomentum: RevisionMomentumScore;
  momentum: MomentumScore;
  relativeValuation: RelativeValuationScore;
  risk: RiskScore;
  reverseDcf: ReverseDcfOutput;
  factorWeights: Record<string, number>;
  keyPositiveDrivers: string[];
  keyNegativeDrivers: string[];
  uncertaintyFlags: string[];
};

export type AlphaFrameworkInput = {
  snapshot: AssetSnapshot;
  edgarFacts: EdgarFacts | null;
  analystData: AnalystData | null;
  sectorTemplate: SectorTemplateKey;
  dataQuality?: { completeness_score?: number; missing_fields?: string[] } | null;
};

// ─── Weight profiles by stock type ───────────────────────────────────────────

type FactorWeights = {
  quality: number;
  moat: number;
  valuation: number;
  revisions: number;
  momentum: number;
  capitalAllocation: number;
  risk: number;
};

const BASE_WEIGHTS: FactorWeights = {
  quality: 0.20,
  moat: 0.15,
  valuation: 0.20,
  revisions: 0.15,
  momentum: 0.10,
  capitalAllocation: 0.10,
  risk: 0.10,
};

const WEIGHT_OVERRIDES: Partial<Record<StockType, Partial<FactorWeights>>> = {
  quality_compounder: { quality: 0.25, moat: 0.20, capitalAllocation: 0.15, valuation: 0.15, revisions: 0.10, momentum: 0.10, risk: 0.05 },
  growth:             { quality: 0.15, moat: 0.10, valuation: 0.20, revisions: 0.25, momentum: 0.15, capitalAllocation: 0.08, risk: 0.07 },
  value:              { quality: 0.15, moat: 0.10, valuation: 0.30, revisions: 0.15, momentum: 0.10, capitalAllocation: 0.10, risk: 0.10 },
  deep_value:         { quality: 0.10, moat: 0.05, valuation: 0.35, revisions: 0.20, momentum: 0.10, capitalAllocation: 0.05, risk: 0.15 },
  cyclical:           { quality: 0.10, moat: 0.05, valuation: 0.25, revisions: 0.20, momentum: 0.20, capitalAllocation: 0.05, risk: 0.15 },
  turnaround:         { quality: 0.10, moat: 0.05, valuation: 0.20, revisions: 0.30, momentum: 0.20, capitalAllocation: 0.05, risk: 0.10 },
  speculative:        { quality: 0.15, moat: 0.05, valuation: 0.15, revisions: 0.20, momentum: 0.15, capitalAllocation: 0.05, risk: 0.25 },
  income:             { quality: 0.15, moat: 0.15, valuation: 0.20, revisions: 0.10, momentum: 0.05, capitalAllocation: 0.25, risk: 0.10 },
  distressed:         { quality: 0.05, moat: 0.05, valuation: 0.20, revisions: 0.20, momentum: 0.10, capitalAllocation: 0.05, risk: 0.35 },
};

function resolveWeights(stockType: StockType): FactorWeights {
  const override = WEIGHT_OVERRIDES[stockType];
  if (!override) return BASE_WEIGHTS;
  const w = { ...BASE_WEIGHTS, ...override };
  // Normalize to sum = 1
  const sum = Object.values(w).reduce((s, v) => s + v, 0);
  const factor = 1 / sum;
  return {
    quality: w.quality * factor,
    moat: w.moat * factor,
    valuation: w.valuation * factor,
    revisions: w.revisions * factor,
    momentum: w.momentum * factor,
    capitalAllocation: w.capitalAllocation * factor,
    risk: w.risk * factor,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gradeFromScore(score: number): AlphaGrade {
  if (score >= 75) return "very_attractive";
  if (score >= 60) return "attractive";
  if (score >= 40) return "neutral";
  if (score >= 25) return "unattractive";
  return "very_unattractive";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function calculateAlphaFramework(input: AlphaFrameworkInput): AlphaFrameworkOutput {
  const { snapshot, edgarFacts, analystData, sectorTemplate, dataQuality } = input;

  const quality = calculateQualityScore({ snapshot, edgarFacts, sectorTemplate });
  const moat = calculateMoatScore({ snapshot, edgarFacts, sectorTemplate });
  const capitalAllocation = calculateCapitalAllocationScore({ snapshot, edgarFacts, sectorTemplate });
  const revisionMomentum = calculateRevisionMomentum({ snapshot, analystData });
  const momentum = calculateMomentumScore({ snapshot });
  const relativeValuation = calculateRelativeValuation({ snapshot, analystData, sectorTemplate });
  const risk = calculateRiskScore({ snapshot, edgarFacts, sectorTemplate, dataQuality });

  const classification = classifyStock({
    snapshot,
    sectorTemplate,
    quality,
    moat,
    relativeValuation,
    risk,
    revision: revisionMomentum,
  });

  const weights = resolveWeights(classification.primaryType);

  // Risk score is inverted for aggregation (high risk = low score contribution)
  const riskContribution = 100 - risk.score;
  const alphaScore = Math.round(
    quality.score * weights.quality +
    moat.score * weights.moat +
    relativeValuation.score * weights.valuation +
    revisionMomentum.score * weights.revisions +
    momentum.score * weights.momentum +
    capitalAllocation.score * weights.capitalAllocation +
    riskContribution * weights.risk,
  );

  // Reverse DCF
  const dcfInput = buildDcfInputFromSnapshot(snapshot, edgarFacts, sectorTemplate);
  let reverseDcf: ReverseDcfOutput;
  if (dcfInput && snapshot.price != null && snapshot.price > 0) {
    reverseDcf = calculateReverseDcf(dcfInput, snapshot.price);
  } else {
    reverseDcf = {
      impliedGrowthRate: null,
      currentPrice: snapshot.price ?? 0,
      requiredFairValuePerShare: snapshot.price ?? 0,
      plausibility: "medium",
      interpretation: "Reverse DCF nicht möglich: unvollständige Daten.",
      limitations: ["Kurs oder Umsatz fehlen für Reverse-DCF-Analyse."],
    };
  }

  const keyPositiveDrivers: string[] = [
    ...quality.strengths.slice(0, 2),
    ...moat.drivers.slice(0, 1),
    ...capitalAllocation.strengths.slice(0, 1),
  ].filter(Boolean);

  const keyNegativeDrivers: string[] = [
    ...quality.weaknesses.slice(0, 2),
    ...moat.risks.slice(0, 1),
    ...risk.keyRisks.slice(0, 2),
  ].filter(Boolean);

  const uncertaintyFlags: string[] = [
    ...(quality.limitations.length > 2 ? ["Qualitäts-Score mangels vollständiger Fundamentaldaten eingeschränkt."] : []),
    ...(reverseDcf.limitations.filter(l => !l.includes("Netto-Verschuldung")).slice(0, 1)),
    ...(risk.components.dataQualityRisk > 40 ? ["Datenlücken erhöhen Analyseunsicherheit."] : []),
  ];

  return {
    alphaScore,
    alphaGrade: gradeFromScore(alphaScore),
    classification,
    quality,
    moat,
    capitalAllocation,
    revisionMomentum,
    momentum,
    relativeValuation,
    risk,
    reverseDcf,
    factorWeights: {
      quality: Math.round(weights.quality * 100),
      moat: Math.round(weights.moat * 100),
      valuation: Math.round(weights.valuation * 100),
      revisions: Math.round(weights.revisions * 100),
      momentum: Math.round(weights.momentum * 100),
      capitalAllocation: Math.round(weights.capitalAllocation * 100),
      risk: Math.round(weights.risk * 100),
    },
    keyPositiveDrivers,
    keyNegativeDrivers,
    uncertaintyFlags,
  };
}
