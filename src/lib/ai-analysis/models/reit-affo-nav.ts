import type { ConfidenceScore } from "../company-type-router";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ReitAffoNavInput = {
  ticker?: string;
  currentPrice?: number;

  affoPerShare?: number;
  ffoPerShare?: number;
  dividendPerShare?: number;

  navPerShare?: number;

  occupancyPct?: number;
  sameStoreNoiGrowthPct?: number;
  rentSpreadPct?: number;

  capRatePct?: number;
  costOfDebtPct?: number;

  netDebtToEbitda?: number;
  debtMaturityYears?: number;
};

export type ReitAffoNavOutput = {
  modelId: "reit_affo_nav";
  status: "success" | "not_run_missing_inputs" | "failed";

  valuation: {
    affoYieldPct?: number;
    impliedAffoMultiple?: number;
    dividendYieldPct?: number;
    affoPayoutRatioPct?: number;
    navPremiumDiscountPct?: number;

    bearFairValue?: number;
    baseFairValue?: number;
    bullFairValue?: number;
  };

  qualitySignals: {
    occupancyAssessment?: "weak" | "average" | "strong";
    dividendCoverageAssessment?: "weak" | "adequate" | "strong";
    leverageAssessment?: "low_risk" | "moderate_risk" | "elevated_risk";
    spreadAssessment?: "negative" | "neutral" | "positive";
  };

  confidence: ConfidenceScore;
  warnings: string[];
  limitations: string[];
};

// ─── AFFO multiple defaults ────────────────────────────────────────────────────

const BEAR_AFFO_MULTIPLE = 12;
const BASE_AFFO_MULTIPLE = 15;
const BULL_AFFO_MULTIPLE = 18;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFinite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isPositive(v: unknown): v is number {
  return isFinite(v) && (v as number) > 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function clampConfidence(v: number): ConfidenceScore {
  if (v >= 5) return 5;
  if (v >= 4) return 4;
  if (v >= 3) return 3;
  if (v >= 2) return 2;
  return 1;
}

// ─── Quality signals ──────────────────────────────────────────────────────────

function assessOccupancy(pct: number | undefined): ReitAffoNavOutput["qualitySignals"]["occupancyAssessment"] {
  if (!isFinite(pct)) return undefined;
  if (pct >= 97) return "strong";
  if (pct >= 93) return "average";
  return "weak";
}

function assessDividendCoverage(
  dividendPerShare: number | undefined,
  affoPerShare: number | undefined,
): ReitAffoNavOutput["qualitySignals"]["dividendCoverageAssessment"] {
  if (!isPositive(affoPerShare) || !isFinite(dividendPerShare)) return undefined;
  const ratio = (dividendPerShare as number) / affoPerShare;
  if (ratio <= 0.75) return "strong";
  if (ratio <= 0.95) return "adequate";
  return "weak";
}

function assessLeverage(netDebtToEbitda: number | undefined): ReitAffoNavOutput["qualitySignals"]["leverageAssessment"] {
  if (!isFinite(netDebtToEbitda)) return undefined;
  if ((netDebtToEbitda as number) <= 4) return "low_risk";
  if ((netDebtToEbitda as number) <= 6) return "moderate_risk";
  return "elevated_risk";
}

function assessSpread(capRatePct: number | undefined, costOfDebtPct: number | undefined): ReitAffoNavOutput["qualitySignals"]["spreadAssessment"] {
  if (!isFinite(capRatePct) || !isFinite(costOfDebtPct)) return undefined;
  const spread = (capRatePct as number) - (costOfDebtPct as number);
  if (spread > 1.5) return "positive";
  if (spread >= 0) return "neutral";
  return "negative";
}

// ─── Main model ───────────────────────────────────────────────────────────────

export function calculateReitAffoNav(input: ReitAffoNavInput): ReitAffoNavOutput {
  const warnings: string[] = [];
  const limitations: string[] = [];

  const price = input.currentPrice;
  const affo = input.affoPerShare;
  const ffo = input.ffoPerShare;
  const nav = input.navPerShare;
  const dividend = input.dividendPerShare;

  // Determine which earnings proxy to use
  const usingFfo = !isPositive(affo) && isPositive(ffo);
  const earningsPerShare: number | undefined = isPositive(affo) ? affo : (isPositive(ffo) ? ffo : undefined);

  if (!isPositive(earningsPerShare)) {
    limitations.push("Neither AFFO nor FFO per share is available; model cannot run.");
    if (!isPositive(nav)) {
      return {
        modelId: "reit_affo_nav",
        status: "not_run_missing_inputs",
        valuation: {},
        qualitySignals: {},
        confidence: 1,
        warnings,
        limitations,
      };
    }
    // NAV-only path
    const valuation: ReitAffoNavOutput["valuation"] = {};
    if (isPositive(price) && isPositive(nav)) {
      valuation.navPremiumDiscountPct = round2(((price as number) / (nav as number) - 1) * 100);
      valuation.baseFairValue = round2(nav as number);
      valuation.bearFairValue = round2((nav as number) * 0.85);
      valuation.bullFairValue = round2((nav as number) * 1.1);
    }
    limitations.push("AFFO/FFO missing; valuation based on NAV only.");
    return {
      modelId: "reit_affo_nav",
      status: "success",
      valuation,
      qualitySignals: {
        occupancyAssessment: assessOccupancy(input.occupancyPct),
        dividendCoverageAssessment: assessDividendCoverage(dividend, undefined),
        leverageAssessment: assessLeverage(input.netDebtToEbitda),
        spreadAssessment: assessSpread(input.capRatePct, input.costOfDebtPct),
      },
      confidence: 2,
      warnings,
      limitations,
    };
  }

  if (usingFfo) {
    limitations.push("AFFO not available; FFO used as weaker proxy. AFFO would give more accurate picture.");
    warnings.push("FFO does not adjust for recurring capex — AFFO is a more conservative measure.");
  }

  if (!isPositive(nav)) {
    limitations.push("NAV per share not available; AFFO-multiple-only valuation.");
  }

  // ─── Core calculations ──────────────────────────────────────────────────────

  const valuation: ReitAffoNavOutput["valuation"] = {};

  if (isPositive(price)) {
    valuation.affoYieldPct = round2((earningsPerShare as number) / (price as number) * 100);
    valuation.impliedAffoMultiple = round2((price as number) / (earningsPerShare as number));
  }

  if (isFinite(dividend) && isPositive(price)) {
    valuation.dividendYieldPct = round2((dividend as number) / (price as number) * 100);
  }

  if (isFinite(dividend)) {
    valuation.affoPayoutRatioPct = round2((dividend as number) / (earningsPerShare as number) * 100);
  }

  if (isPositive(nav) && isPositive(price)) {
    valuation.navPremiumDiscountPct = round2(((price as number) / (nav as number) - 1) * 100);
  }

  // ─── Fair value scenarios ───────────────────────────────────────────────────

  const bearFromAffo = round2((earningsPerShare as number) * BEAR_AFFO_MULTIPLE);
  const baseFromAffo = round2((earningsPerShare as number) * BASE_AFFO_MULTIPLE);
  const bullFromAffo = round2((earningsPerShare as number) * BULL_AFFO_MULTIPLE);

  if (isPositive(nav)) {
    // Blend AFFO multiple with NAV for base
    valuation.bearFairValue = bearFromAffo;
    valuation.baseFairValue = round2((baseFromAffo + (nav as number)) / 2);
    valuation.bullFairValue = round2(Math.max(bullFromAffo, (nav as number) * 1.1));
  } else {
    valuation.bearFairValue = bearFromAffo;
    valuation.baseFairValue = baseFromAffo;
    valuation.bullFairValue = bullFromAffo;
  }

  // ─── Warnings ───────────────────────────────────────────────────────────────

  if (isFinite(dividend) && (dividend as number) / (earningsPerShare as number) > 0.9) {
    warnings.push("AFFO payout ratio exceeds 90%; dividend coverage is thin.");
  }

  if (isFinite(input.occupancyPct) && (input.occupancyPct as number) < 95) {
    warnings.push(`Occupancy at ${input.occupancyPct!.toFixed(1)}% is below the 95% comfort threshold.`);
  }

  if (isFinite(input.netDebtToEbitda) && (input.netDebtToEbitda as number) > 6) {
    warnings.push(`Net debt/EBITDA of ${input.netDebtToEbitda!.toFixed(1)}x is elevated for a REIT.`);
  }

  if (isFinite(input.capRatePct) && isFinite(input.costOfDebtPct)) {
    const spread = (input.capRatePct as number) - (input.costOfDebtPct as number);
    if (spread < 0) warnings.push("Cap rate is below cost of debt; acquisition spread is negative.");
  }

  if (!isPositive(nav)) warnings.push("NAV per share not provided; fair-value blend limited to AFFO multiples.");
  if (!isFinite(input.debtMaturityYears)) limitations.push("Debt maturity profile not available.");

  // ─── Confidence ─────────────────────────────────────────────────────────────

  let conf = 3;
  if (isPositive(affo) && isPositive(nav)) conf += 1;
  if (isFinite(input.occupancyPct)) conf += 0;
  if (usingFfo) conf -= 1;
  if (!isPositive(nav)) conf -= 1;
  if (warnings.length >= 3) conf -= 1;

  return {
    modelId: "reit_affo_nav",
    status: "success",
    valuation,
    qualitySignals: {
      occupancyAssessment: assessOccupancy(input.occupancyPct),
      dividendCoverageAssessment: assessDividendCoverage(dividend, earningsPerShare),
      leverageAssessment: assessLeverage(input.netDebtToEbitda),
      spreadAssessment: assessSpread(input.capRatePct, input.costOfDebtPct),
    },
    confidence: clampConfidence(conf),
    warnings,
    limitations,
  };
}
