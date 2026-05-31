/**
 * Price Zones — derives Buy / Hold / Avoid price bands from the aggregate fair
 * value and a *dynamic* required margin of safety.
 *
 * Higher business quality + low balance-sheet risk → smaller MoS required.
 * Cyclical / highly levered → larger MoS required. Deterministic.
 */

export type BalanceSheetRisk = "low" | "medium" | "high";

export interface PriceZonesInput {
  aggregateFairValue: number | null;
  fairValueRange: { bear: number | null; base: number | null; bull: number | null };
  /** 0–100. */
  businessQualityScore?: number | null;
  balanceSheetRisk?: BalanceSheetRisk;
  cyclical?: boolean;
}

export interface PriceZones {
  /** Required margin of safety as a fraction (e.g. 0.2 = 20%). */
  requiredMarginOfSafety: number;
  /** Buy at or below this price. */
  buyBelow: number | null;
  holdRange: { low: number | null; high: number | null };
  /** Avoid / reduce at or above this price. */
  avoidAbove: number | null;
  explanation: string;
}

const BASE_MOS = 0.25;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round2(v: number | null): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
}

export function computeRequiredMarginOfSafety(input: PriceZonesInput): number {
  let mos = BASE_MOS;
  const q = input.businessQualityScore;
  if (typeof q === "number") {
    if (q >= 85) mos -= 0.08;
    else if (q >= 70) mos -= 0.04;
    else if (q < 50) mos += 0.05;
  }
  if (input.balanceSheetRisk === "low") mos -= 0.03;
  else if (input.balanceSheetRisk === "high") mos += 0.07;
  if (input.cyclical) mos += 0.05;
  return clamp(Math.round(mos * 100) / 100, 0.1, 0.45);
}

export function buildPriceZones(input: PriceZonesInput): PriceZones {
  const requiredMarginOfSafety = computeRequiredMarginOfSafety(input);
  const fv = input.aggregateFairValue;

  if (fv == null || fv <= 0) {
    return {
      requiredMarginOfSafety,
      buyBelow: null,
      holdRange: { low: null, high: null },
      avoidAbove: null,
      explanation: "Keine Preiszonen berechenbar — kein aggregierter Fair Value verfügbar.",
    };
  }

  const buyBelow = round2(fv * (1 - requiredMarginOfSafety));
  // Avoid above the optimistic scenario (bull) or, if missing, a premium over FV.
  const avoidAbove = round2(Math.max(input.fairValueRange.bull ?? fv * 1.15, fv * 1.05));
  const holdRange = { low: buyBelow, high: avoidAbove };

  const explanation =
    `Geforderte Margin of Safety: ${(requiredMarginOfSafety * 100).toFixed(0)}% ` +
    `(dynamisch nach Qualität & Bilanzrisiko). Kaufzone ≤ ${buyBelow}, ` +
    `Halten ${buyBelow}–${avoidAbove}, Meiden/Reduzieren > ${avoidAbove}.`;

  return { requiredMarginOfSafety, buyBelow, holdRange, avoidAbove, explanation };
}
