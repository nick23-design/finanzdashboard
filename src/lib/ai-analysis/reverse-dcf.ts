/**
 * Reverse DCF — implied growth rate analysis.
 * Answers: what revenue growth must this company achieve to justify its current price?
 * Zero LLM calls. Uses existing calculateDcfSafe mechanics via binary search.
 */

import { calculateDcfSafe, type DcfInput } from "./dcf";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReverseDcfOutput = {
  impliedGrowthRate: number | null;
  impliedTerminalGrowthRate?: number | null;
  impliedFcfCagr?: number | null;
  currentPrice: number;
  marketCap?: number;
  requiredFairValuePerShare: number;
  plausibility: "low" | "medium" | "high" | "very_high";
  interpretation: string;
  limitations: string[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SEARCH_MIN = -0.20;
const SEARCH_MAX = 0.80;
const SEARCH_TOLERANCE = 0.005; // 0.5% of target price
const SEARCH_MAX_ITER = 60;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFlatGrowthInput(base: DcfInput, growthRate: number): DcfInput {
  return {
    ...base,
    revenueGrowthRates: Array<number>(base.revenueGrowthRates.length).fill(growthRate),
  };
}

function evalFairValue(base: DcfInput, growthRate: number): number | null {
  const { output } = calculateDcfSafe(makeFlatGrowthInput(base, growthRate));
  return output ? output.fairValuePerShare : null;
}

function assessPlausibility(
  impliedGrowthRate: number,
  terminalGrowthRate: number,
): "low" | "medium" | "high" | "very_high" {
  if (impliedGrowthRate <= terminalGrowthRate) return "very_high";
  if (impliedGrowthRate <= 0.10) return "high";
  if (impliedGrowthRate <= 0.25) return "medium";
  return "low";
}

function buildInterpretation(
  impliedGrowthRate: number | null,
  terminalGrowthRate: number,
  plausibility: "low" | "medium" | "high" | "very_high",
): string {
  if (impliedGrowthRate === null) {
    return "Implizite Wachstumsrate konnte nicht bestimmt werden.";
  }

  const pct = (impliedGrowthRate * 100).toFixed(1);

  switch (plausibility) {
    case "very_high":
      return `Der Markt preist eine Wachstumsrate von ~${pct}% ein — unter der langfristigen Annahme von ${(terminalGrowthRate * 100).toFixed(1)}%. Das deutet auf günstige Erwartungen hin; der Kurs erscheint konservativ bewertet.`;
    case "high":
      return `Der Markt preist ~${pct}% Wachstum ein. Das liegt in einem realistischen Bereich und lässt Spielraum für Überraschungen nach oben.`;
    case "medium":
      return `Der Markt erwartet ~${pct}% Wachstum. Das ist anspruchsvoll, aber bei starker Ausführung erreichbar. Die Bewertung lässt wenig Fehlertoleranz.`;
    case "low":
      return `Der Markt preist ~${pct}% Wachstum ein. Das sind sehr hohe Erwartungen, die über Jahre gehalten werden müssen. Geringe Fehlertoleranz; Enttäuschungen werden wahrscheinlich bestraft.`;
  }
}

// ─── Core function ────────────────────────────────────────────────────────────

export function calculateReverseDcf(
  baseInput: DcfInput,
  currentPrice: number,
): ReverseDcfOutput {
  const limitations: string[] = [];
  const requiredFairValuePerShare = currentPrice;
  const terminalGrowthRate = baseInput.terminalGrowthRate;

  if (currentPrice <= 0) {
    limitations.push("Aktueller Kurs muss positiv sein.");
    return {
      impliedGrowthRate: null,
      currentPrice,
      requiredFairValuePerShare,
      plausibility: "medium",
      interpretation: "Reverse DCF nicht möglich: kein gültiger Kurs.",
      limitations,
    };
  }

  if (baseInput.sharesOutstanding <= 0 || baseInput.revenue <= 0) {
    limitations.push("Unvollständige Eingabedaten (Aktienanzahl oder Umsatz fehlen).");
    return {
      impliedGrowthRate: null,
      currentPrice,
      requiredFairValuePerShare,
      plausibility: "medium",
      interpretation: "Reverse DCF nicht möglich: Eingabedaten fehlen.",
      limitations,
    };
  }

  const loFv = evalFairValue(baseInput, SEARCH_MIN);
  const hiFv = evalFairValue(baseInput, SEARCH_MAX);

  if (loFv === null || hiFv === null) {
    limitations.push("DCF-Berechnung mit Suchgrenzen fehlgeschlagen.");
    return {
      impliedGrowthRate: null,
      currentPrice,
      requiredFairValuePerShare,
      plausibility: "medium",
      interpretation: "Reverse DCF konnte nicht berechnet werden.",
      limitations,
    };
  }

  // Handle cases where target is outside the search range
  if (currentPrice < loFv) {
    limitations.push(`Kurs ${currentPrice.toFixed(2)} liegt unter dem DCF-Wert bei minimaler Wachstumsrate (${loFv.toFixed(2)}). Implizite Wachstumsrate liegt unterhalb der Untergrenze.`);
    const plausibility = assessPlausibility(SEARCH_MIN, terminalGrowthRate);
    return {
      impliedGrowthRate: SEARCH_MIN,
      impliedTerminalGrowthRate: terminalGrowthRate,
      currentPrice,
      requiredFairValuePerShare,
      plausibility: "very_high",
      interpretation: buildInterpretation(SEARCH_MIN, terminalGrowthRate, "very_high"),
      limitations,
    };
  }

  if (currentPrice > hiFv) {
    limitations.push(`Kurs ${currentPrice.toFixed(2)} liegt über dem DCF-Wert bei maximaler Wachstumsrate (${hiFv.toFixed(2)}). Implizite Wachstumsrate liegt oberhalb der Obergrenze.`);
    return {
      impliedGrowthRate: SEARCH_MAX,
      impliedTerminalGrowthRate: terminalGrowthRate,
      currentPrice,
      requiredFairValuePerShare,
      plausibility: "low",
      interpretation: buildInterpretation(SEARCH_MAX, terminalGrowthRate, "low"),
      limitations,
    };
  }

  // Binary search
  let lo = SEARCH_MIN;
  let hi = SEARCH_MAX;

  for (let i = 0; i < SEARCH_MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    const fv = evalFairValue(baseInput, mid);
    if (fv === null) break;

    if (Math.abs(fv - currentPrice) / currentPrice < SEARCH_TOLERANCE) {
      lo = mid;
      hi = mid;
      break;
    }

    // Fair value increases monotonically with growth rate
    if (fv < currentPrice) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const impliedGrowthRate = (lo + hi) / 2;

  // FCF CAGR approximation
  const impliedFcfCagr =
    impliedGrowthRate * (1 - (baseInput.reinvestmentRate ?? 0));

  const plausibility = assessPlausibility(impliedGrowthRate, terminalGrowthRate);
  const interpretation = buildInterpretation(impliedGrowthRate, terminalGrowthRate, plausibility);

  if (baseInput.netDebt === 0) {
    limitations.push("Netto-Verschuldung mit 0 angenähert; kann implizite Wachstumsrate verzerren.");
  }

  return {
    impliedGrowthRate,
    impliedTerminalGrowthRate: terminalGrowthRate,
    impliedFcfCagr: isFinite(impliedFcfCagr) ? impliedFcfCagr : null,
    currentPrice,
    requiredFairValuePerShare,
    plausibility,
    interpretation,
    limitations,
  };
}
