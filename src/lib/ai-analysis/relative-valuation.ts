/**
 * Relative Valuation Score (0–100, higher = more attractive valuation).
 * Compares PE, FCF yield, and analyst target against sector defaults.
 * Zero LLM calls.
 */

import type { AssetSnapshot } from "@/types/database";
import type { AnalystData } from "@/lib/finance-client";
import type { SectorTemplateKey } from "./valuation-model";
import { SECTOR_DCF_DEFAULTS } from "./dcf-pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValuationState = "very_expensive" | "expensive" | "fair" | "cheap" | "very_cheap";

export type RelativeValuationScore = {
  score: number;
  valuationState: ValuationState;
  metrics: {
    pe?: number;
    forwardPe?: number;
    evEbitda?: number;
    evFcf?: number;
    fcfYield?: number;
    peg?: number;
  };
  comparisons: {
    vsHistory?: string;
    vsSector?: string;
    vsPeers?: string;
    vsRates?: string;
  };
  limitations: string[];
};

export type RelativeValuationInput = {
  snapshot: AssetSnapshot;
  analystData: AnalystData | null;
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

function stateFromScore(score: number): ValuationState {
  if (score >= 80) return "very_cheap";
  if (score >= 60) return "cheap";
  if (score >= 40) return "fair";
  if (score >= 20) return "expensive";
  return "very_expensive";
}

// Derive a "fair PE" proxy from sector DCF defaults
function impliedFairPe(wacc: number, terminalGrowth: number, opMargin: number, reinvestment: number, taxRate: number): number {
  // Implied PE from simple Gordon Growth: P/E ≈ (1 - reinvestment) / (wacc - terminalGrowth)
  // Adjust for margin profile (higher margins → higher earnings quality)
  const fcfConversionRatio = 1 - reinvestment;
  const baseGordon = wacc > terminalGrowth ? fcfConversionRatio / (wacc - terminalGrowth) : 30;
  // Scale by margin quality: default is 1.0; high-margin sectors command premium
  const marginMultiplier = 1 + (opMargin - 0.15) * 2; // center at 15% opMargin
  return Math.max(8, Math.min(60, baseGordon * marginMultiplier));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function calculateRelativeValuation(input: RelativeValuationInput): RelativeValuationScore {
  const { snapshot, analystData, sectorTemplate } = input;
  const defaults = SECTOR_DCF_DEFAULTS[sectorTemplate] ?? SECTOR_DCF_DEFAULTS.general_quality_growth;
  const limitations: string[] = [];

  const fairPe = impliedFairPe(defaults.wacc, defaults.terminalGrowth, defaults.opMargin, defaults.reinvestment, defaults.taxRate);

  let totalScore = 0;
  let totalWeight = 0;

  const metrics: RelativeValuationScore["metrics"] = {};
  const comparisons: RelativeValuationScore["comparisons"] = {};

  // 1. PE ratio
  if (snapshot.pe_ratio != null) {
    metrics.pe = snapshot.pe_ratio;
    const peScore = snapshot.pe_ratio > 0
      ? scoreInverse(snapshot.pe_ratio, fairPe * 0.5, fairPe * 2.5)
      : 0;
    totalScore += peScore * 0.35;
    totalWeight += 0.35;
    comparisons.vsSector = `KGV ${snapshot.pe_ratio.toFixed(1)} vs. Sektor-Fair-KGV ~${fairPe.toFixed(0)} (Näherung aus DCF-Defaults)`;
  } else {
    limitations.push("KGV (P/E) nicht verfügbar.");
  }

  // 2. FCF yield
  if (snapshot.free_cashflow != null && snapshot.market_cap != null && snapshot.market_cap > 0) {
    const fcfYield = snapshot.free_cashflow / snapshot.market_cap;
    metrics.fcfYield = fcfYield;
    // Higher FCF yield = cheaper; 0-2% expensive, 4-8% attractive
    const yieldScore = fcfYield < 0 ? 5 : scoreLinear(fcfYield, 0, 0.10);
    totalScore += yieldScore * 0.35;
    totalWeight += 0.35;
    comparisons.vsRates = `FCF-Yield ${(fcfYield * 100).toFixed(1)}% — ${fcfYield > 0.04 ? "attraktiv" : fcfYield > 0.02 ? "moderat" : "niedrig"}`;
  } else {
    limitations.push("FCF-Yield mangels Cashflow- oder Marktkapitalisierungsdaten nicht berechenbar.");
  }

  // 3. Analyst upside as valuation signal
  if (snapshot.price != null && snapshot.price > 0 && analystData?.mean_target != null) {
    const upside = (analystData.mean_target - snapshot.price) / snapshot.price;
    const upsideScore = scoreLinear(upside, -0.15, 0.30);
    totalScore += upsideScore * 0.20;
    totalWeight += 0.20;
    comparisons.vsPeers = `Analysten-Kursziel $${analystData.mean_target.toFixed(2)} → ${upside >= 0 ? "+" : ""}${(upside * 100).toFixed(1)}% Upside`;
  } else {
    limitations.push("Analysten-Kursziel für relativen Vergleich nicht verfügbar.");
  }

  // 4. PEG approximation (if PE and growth available)
  if (snapshot.pe_ratio != null && snapshot.pe_ratio > 0 && snapshot.revenue_growth != null && snapshot.revenue_growth > 0.02) {
    const peg = snapshot.pe_ratio / (snapshot.revenue_growth * 100);
    metrics.peg = peg;
    // PEG < 1 = cheap, PEG 1-2 = fair, PEG > 2 = expensive
    const pegScore = scoreInverse(peg, 0.5, 3.0);
    totalScore += pegScore * 0.10;
    totalWeight += 0.10;
  } else {
    limitations.push("PEG-Näherung nicht berechenbar (kein positives KGV oder Wachstum).");
  }

  limitations.push("EV/EBITDA und EV/FCF mangels Nettoverschuldungsdaten nicht berechenbar.");
  limitations.push("Historische Multiples-Entwicklung nicht verfügbar; kein Vergleich mit eigener Geschichte möglich.");

  const score = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 50;
  const valuationState = stateFromScore(score);

  return {
    score,
    valuationState,
    metrics,
    comparisons,
    limitations,
  };
}
