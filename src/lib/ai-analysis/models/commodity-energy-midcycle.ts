import type { ConfidenceScore } from "../company-type-router";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CommodityEnergyMidcycleInput = {
  ticker?: string;
  currentPrice?: number;

  freeCashFlow?: number;
  marketCap?: number;
  enterpriseValue?: number;
  ebitda?: number;

  dividendPaid?: number;
  buybacks?: number;
  capex?: number;

  netDebt?: number;

  productionGrowthPct?: number;
  reserveLifeYears?: number;

  oilPriceAssumption?: number;
  gasPriceAssumption?: number;

  midcycleOilPrice?: number;
  bearOilPrice?: number;
  bullOilPrice?: number;
};

export type CommodityEnergyMidcycleOutput = {
  modelId: "commodity_energy_midcycle";
  status: "success" | "not_run_missing_inputs" | "failed";

  valuation: {
    fcfYieldPct?: number;
    evToEbitda?: number;

    bearFairValue?: number;
    baseFairValue?: number;
    bullFairValue?: number;
  };

  shareholderReturnSignals: {
    dividendCoverageAssessment?: "weak" | "adequate" | "strong";
    buybackCoverageAssessment?: "weak" | "adequate" | "strong";
    totalShareholderReturnCoveragePct?: number;
  };

  cycleSignals: {
    commodityPriceSensitivity?: "low" | "moderate" | "high";
    reserveLifeAssessment?: "short" | "adequate" | "long";
    leverageAssessment?: "low_risk" | "moderate_risk" | "elevated_risk";
  };

  confidence: ConfidenceScore;
  warnings: string[];
  limitations: string[];
};

// ─── FCF yield targets ────────────────────────────────────────────────────────

const BULL_TARGET_FCF_YIELD = 0.06;
const BASE_TARGET_FCF_YIELD = 0.08;
const BEAR_TARGET_FCF_YIELD = 0.12;

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

function assessDividendCoverage(
  dividendPaid: number | undefined,
  fcf: number | undefined,
): CommodityEnergyMidcycleOutput["shareholderReturnSignals"]["dividendCoverageAssessment"] {
  if (!isPositive(fcf) || !isFinite(dividendPaid) || (dividendPaid as number) <= 0) return undefined;
  const ratio = (dividendPaid as number) / (fcf as number);
  if (ratio <= 0.4) return "strong";
  if (ratio <= 0.7) return "adequate";
  return "weak";
}

function assessBuybackCoverage(
  buybacks: number | undefined,
  fcf: number | undefined,
): CommodityEnergyMidcycleOutput["shareholderReturnSignals"]["buybackCoverageAssessment"] {
  if (!isPositive(fcf) || !isFinite(buybacks) || (buybacks as number) <= 0) return undefined;
  const ratio = (buybacks as number) / (fcf as number);
  if (ratio <= 0.3) return "strong";
  if (ratio <= 0.6) return "adequate";
  return "weak";
}

function assessReserveLife(
  years: number | undefined,
): CommodityEnergyMidcycleOutput["cycleSignals"]["reserveLifeAssessment"] {
  if (!isPositive(years)) return undefined;
  if ((years as number) > 12) return "long";
  if ((years as number) >= 8) return "adequate";
  return "short";
}

function assessLeverage(
  netDebt: number | undefined,
  ebitda: number | undefined,
): CommodityEnergyMidcycleOutput["cycleSignals"]["leverageAssessment"] {
  if (!isPositive(ebitda) || !isFinite(netDebt)) return undefined;
  const ratio = (netDebt as number) / (ebitda as number);
  if (ratio <= 1.5) return "low_risk";
  if (ratio <= 2.5) return "moderate_risk";
  return "elevated_risk";
}

function assessCommodityPriceSensitivity(input: CommodityEnergyMidcycleInput): CommodityEnergyMidcycleOutput["cycleSignals"]["commodityPriceSensitivity"] {
  const hasBearBull = isPositive(input.bearOilPrice) && isPositive(input.bullOilPrice);
  if (!hasBearBull) return "high"; // unknown → assume high sensitivity
  const spread = ((input.bullOilPrice as number) - (input.bearOilPrice as number)) / ((input.bearOilPrice as number) || 1);
  if (spread > 0.6) return "high";
  if (spread > 0.3) return "moderate";
  return "low";
}

// ─── Main model ───────────────────────────────────────────────────────────────

export function calculateCommodityEnergyMidcycle(input: CommodityEnergyMidcycleInput): CommodityEnergyMidcycleOutput {
  const warnings: string[] = [];
  const limitations: string[] = [];

  const fcf = input.freeCashFlow;
  const marketCap = input.marketCap;
  const ev = input.enterpriseValue;
  const ebitda = input.ebitda;

  const hasFcfPath = isPositive(fcf) && isPositive(marketCap);
  const hasEvEbitdaPath = isPositive(ev) && isPositive(ebitda);

  if (!hasFcfPath && !hasEvEbitdaPath) {
    limitations.push("Neither FCF+marketCap nor EV+EBITDA inputs are available; model cannot run.");
    return {
      modelId: "commodity_energy_midcycle",
      status: "not_run_missing_inputs",
      valuation: {},
      shareholderReturnSignals: {},
      cycleSignals: {},
      confidence: 1,
      warnings,
      limitations,
    };
  }

  // ─── Core calculations ──────────────────────────────────────────────────────

  const valuation: CommodityEnergyMidcycleOutput["valuation"] = {};

  if (hasFcfPath) {
    valuation.fcfYieldPct = round2((fcf as number) / (marketCap as number) * 100);

    // FCF yield approach: fair market cap = FCF / target_yield
    const bullFairMarketCap = (fcf as number) / BULL_TARGET_FCF_YIELD;
    const baseFairMarketCap = (fcf as number) / BASE_TARGET_FCF_YIELD;
    const bearFairMarketCap = (fcf as number) / BEAR_TARGET_FCF_YIELD;

    if (isPositive(input.currentPrice)) {
      const scale = (input.currentPrice as number) / (marketCap as number);
      valuation.bullFairValue = round2(bullFairMarketCap * scale);
      valuation.baseFairValue = round2(baseFairMarketCap * scale);
      valuation.bearFairValue = round2(bearFairMarketCap * scale);
    }
  }

  if (hasEvEbitdaPath) {
    valuation.evToEbitda = round2((ev as number) / (ebitda as number));
  }

  // ─── Shareholder return coverage ────────────────────────────────────────────

  const returnSignals: CommodityEnergyMidcycleOutput["shareholderReturnSignals"] = {};

  returnSignals.dividendCoverageAssessment = assessDividendCoverage(input.dividendPaid, fcf);
  returnSignals.buybackCoverageAssessment = assessBuybackCoverage(input.buybacks, fcf);

  if (
    isPositive(fcf) &&
    isFinite(input.dividendPaid) &&
    isFinite(input.buybacks)
  ) {
    const totalReturn = (input.dividendPaid as number) + (input.buybacks as number);
    if (totalReturn > 0) {
      returnSignals.totalShareholderReturnCoveragePct = round2(totalReturn / (fcf as number) * 100);
      if (totalReturn > (fcf as number)) {
        warnings.push(`Total shareholder return (dividends + buybacks) exceeds free cash flow — ${returnSignals.totalShareholderReturnCoveragePct.toFixed(0)}% coverage ratio is not sustainable.`);
      }
    }
  }

  // ─── Warnings ───────────────────────────────────────────────────────────────

  if (!isPositive(fcf)) limitations.push("Free cash flow not available; FCF-yield valuation not possible.");
  if (!isPositive(marketCap)) limitations.push("Market cap not available; FCF yield and per-share fair value not possible.");
  if (!isFinite(input.oilPriceAssumption) && !isFinite(input.midcycleOilPrice)) {
    warnings.push("Commodity price assumptions (mid-cycle oil/gas price) not provided — valuation uses FCF at current prices, which may reflect peak-cycle earnings.");
  }
  if (!isPositive(input.capex)) limitations.push("Capex not available; sustaining vs growth capex split unknown.");
  if (!isPositive(input.reserveLifeYears)) limitations.push("Reserve life not available; reserve depletion risk unknown.");

  warnings.push("Do not extrapolate peak commodity earnings linearly — mid-cycle price normalization is required for reliable valuation.");

  // ─── Confidence ─────────────────────────────────────────────────────────────

  let conf = 3;
  if (hasFcfPath) conf += 0; // baseline
  if (hasEvEbitdaPath) conf += 1; // cross-check available
  if (!isFinite(input.oilPriceAssumption) && !isFinite(input.midcycleOilPrice)) conf -= 1;
  if (!isPositive(input.reserveLifeYears)) conf -= 1;
  if (warnings.filter(w => !w.includes("extrapolate")).length >= 2) conf -= 1;

  return {
    modelId: "commodity_energy_midcycle",
    status: "success",
    valuation,
    shareholderReturnSignals: returnSignals,
    cycleSignals: {
      commodityPriceSensitivity: assessCommodityPriceSensitivity(input),
      reserveLifeAssessment: assessReserveLife(input.reserveLifeYears),
      leverageAssessment: assessLeverage(input.netDebt, ebitda),
    },
    confidence: clampConfidence(conf),
    warnings,
    limitations,
  };
}
