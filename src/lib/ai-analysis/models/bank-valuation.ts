import type { ConfidenceScore } from "../company-type-router";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type BankValuationInput = {
  ticker?: string;
  currentPrice?: number;

  tangibleBookValuePerShare?: number;
  bookValuePerShare?: number;

  roePct?: number;
  rotcePct?: number;

  cet1RatioPct?: number;
  netInterestMarginPct?: number;
  efficiencyRatioPct?: number;
  loanLossProvisionPct?: number;

  dividendPerShare?: number;
  eps?: number;

  feeRevenueGrowthPct?: number;
  investmentBankingRevenueGrowthPct?: number;
  tradingRevenueGrowthPct?: number;
  wealthManagementRevenueGrowthPct?: number;
};

export type BankValuationOutput = {
  modelId: "bank_valuation";
  status: "success" | "not_run_missing_inputs" | "failed";

  valuation: {
    priceToTangibleBook?: number;
    priceToBook?: number;
    dividendYieldPct?: number;

    bearFairValue?: number;
    baseFairValue?: number;
    bullFairValue?: number;
  };

  profitabilitySignals: {
    roeAssessment?: "weak" | "average" | "strong";
    rotceAssessment?: "weak" | "average" | "strong";
    efficiencyAssessment?: "weak" | "average" | "strong";
    nimAssessment?: "weak" | "average" | "strong";
  };

  capitalAndCreditSignals: {
    cet1Assessment?: "weak" | "adequate" | "strong";
    creditRiskAssessment?: "low" | "moderate" | "elevated";
  };

  businessMixSignals: {
    feeCycleAssessment?: "negative" | "neutral" | "positive";
    capitalMarketsAssessment?: "negative" | "neutral" | "positive";
  };

  confidence: ConfidenceScore;
  warnings: string[];
  limitations: string[];
};

// ─── Default P/TBV multiples ──────────────────────────────────────────────────

const DEFAULT_BEAR_PTBV = 1.0;
const DEFAULT_BASE_PTBV = 1.5;
const DEFAULT_BULL_PTBV = 2.0;

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

function assessRoe(pct: number | undefined): BankValuationOutput["profitabilitySignals"]["roeAssessment"] {
  if (!isFinite(pct)) return undefined;
  if ((pct as number) >= 12) return "strong";
  if ((pct as number) >= 8) return "average";
  return "weak";
}

function assessRotce(pct: number | undefined): BankValuationOutput["profitabilitySignals"]["rotceAssessment"] {
  if (!isFinite(pct)) return undefined;
  if ((pct as number) >= 15) return "strong";
  if ((pct as number) >= 10) return "average";
  return "weak";
}

function assessEfficiency(pct: number | undefined): BankValuationOutput["profitabilitySignals"]["efficiencyAssessment"] {
  if (!isFinite(pct)) return undefined;
  if ((pct as number) <= 55) return "strong";
  if ((pct as number) <= 65) return "average";
  return "weak";
}

function assessNim(pct: number | undefined): BankValuationOutput["profitabilitySignals"]["nimAssessment"] {
  if (!isFinite(pct)) return undefined;
  if ((pct as number) >= 3.0) return "strong";
  if ((pct as number) >= 2.0) return "average";
  return "weak";
}

function assessCet1(pct: number | undefined): BankValuationOutput["capitalAndCreditSignals"]["cet1Assessment"] {
  if (!isFinite(pct)) return undefined;
  if ((pct as number) >= 13) return "strong";
  if ((pct as number) >= 11) return "adequate";
  return "weak";
}

function assessCreditRisk(loanLossPct: number | undefined): BankValuationOutput["capitalAndCreditSignals"]["creditRiskAssessment"] {
  if (!isFinite(loanLossPct)) return undefined;
  if ((loanLossPct as number) <= 0.3) return "low";
  if ((loanLossPct as number) <= 0.7) return "moderate";
  return "elevated";
}

function assessCapitalMarkets(input: BankValuationInput): BankValuationOutput["businessMixSignals"]["capitalMarketsAssessment"] {
  const ibGrowth = input.investmentBankingRevenueGrowthPct;
  const tradingGrowth = input.tradingRevenueGrowthPct;
  if (!isFinite(ibGrowth) && !isFinite(tradingGrowth)) return undefined;
  const signals = [ibGrowth, tradingGrowth].filter(isFinite) as number[];
  const avg = signals.reduce((a, b) => a + b, 0) / signals.length;
  if (avg > 5) return "positive";
  if (avg > -5) return "neutral";
  return "negative";
}

function assessFeeRevenue(input: BankValuationInput): BankValuationOutput["businessMixSignals"]["feeCycleAssessment"] {
  const feeGrowth = input.feeRevenueGrowthPct ?? input.wealthManagementRevenueGrowthPct;
  if (!isFinite(feeGrowth)) return undefined;
  if ((feeGrowth as number) > 5) return "positive";
  if ((feeGrowth as number) > -5) return "neutral";
  return "negative";
}

// ─── Multiple adjustments ─────────────────────────────────────────────────────

function computePtbvMultiples(input: BankValuationInput): {
  bear: number;
  base: number;
  bull: number;
} {
  let bear = DEFAULT_BEAR_PTBV;
  let base = DEFAULT_BASE_PTBV;
  let bull = DEFAULT_BULL_PTBV;

  // ROTCE adjustments
  if (isFinite(input.rotcePct)) {
    const rotce = input.rotcePct as number;
    if (rotce > 15) {
      base += 0.2;
      bull += 0.2;
    } else if (rotce < 8) {
      base -= 0.3;
      bull -= 0.3;
      bear -= 0.1;
    }
  } else if (isFinite(input.roePct)) {
    const roe = input.roePct as number;
    if (roe > 12) {
      base += 0.1;
    } else if (roe < 8) {
      base -= 0.2;
      bull -= 0.2;
    }
  }

  // CET1 adjustment
  if (isFinite(input.cet1RatioPct)) {
    const cet1 = input.cet1RatioPct as number;
    if (cet1 < 11) {
      base -= 0.2;
      bull -= 0.2;
    } else if (cet1 >= 13) {
      bear += 0.05;
    }
  }

  // Efficiency ratio adjustment
  if (isFinite(input.efficiencyRatioPct)) {
    const er = input.efficiencyRatioPct as number;
    if (er < 55) {
      base += 0.1;
      bull += 0.1;
    } else if (er > 70) {
      base -= 0.1;
      bull -= 0.1;
    }
  }

  // Credit risk adjustment
  if (isFinite(input.loanLossProvisionPct)) {
    const llp = input.loanLossProvisionPct as number;
    if (llp > 0.7) {
      base -= 0.2;
      bear -= 0.1;
    }
  }

  return {
    bear: round2(Math.max(0.5, bear)),
    base: round2(Math.max(0.7, base)),
    bull: round2(Math.max(1.0, bull)),
  };
}

// ─── Main model ───────────────────────────────────────────────────────────────

export function calculateBankValuation(input: BankValuationInput): BankValuationOutput {
  const warnings: string[] = [];
  const limitations: string[] = [];

  const price = input.currentPrice;
  const tbv = input.tangibleBookValuePerShare;
  const bv = input.bookValuePerShare;

  // Determine book value proxy
  const usingBookValue = !isPositive(tbv) && isPositive(bv);
  const bookValue: number | undefined = isPositive(tbv) ? tbv : (isPositive(bv) ? bv : undefined);

  if (!isPositive(bookValue)) {
    limitations.push("Neither tangible book value per share nor book value per share is available; model cannot run.");
    return {
      modelId: "bank_valuation",
      status: "not_run_missing_inputs",
      valuation: {},
      profitabilitySignals: {},
      capitalAndCreditSignals: {},
      businessMixSignals: {},
      confidence: 1,
      warnings,
      limitations,
    };
  }

  if (usingBookValue) {
    limitations.push("Tangible book value not available; book value per share used as weaker proxy. TBV is more conservative for banks.");
  }

  // ─── Core valuations ────────────────────────────────────────────────────────

  const valuation: BankValuationOutput["valuation"] = {};

  if (isPositive(price)) {
    if (isPositive(tbv)) {
      valuation.priceToTangibleBook = round2((price as number) / (tbv as number));
    }
    if (isPositive(bv)) {
      valuation.priceToBook = round2((price as number) / (bv as number));
    }
    if (isFinite(input.dividendPerShare)) {
      valuation.dividendYieldPct = round2((input.dividendPerShare as number) / (price as number) * 100);
    }
  }

  // ─── Fair value scenarios ───────────────────────────────────────────────────

  const multiples = computePtbvMultiples(input);
  valuation.bearFairValue = round2((bookValue as number) * multiples.bear);
  valuation.baseFairValue = round2((bookValue as number) * multiples.base);
  valuation.bullFairValue = round2((bookValue as number) * multiples.bull);

  // ─── Warnings ───────────────────────────────────────────────────────────────

  if (!isFinite(input.cet1RatioPct)) {
    warnings.push("CET1 capital ratio not available — capital strength cannot be assessed.");
  } else if ((input.cet1RatioPct as number) < 11) {
    warnings.push(`CET1 ratio of ${(input.cet1RatioPct as number).toFixed(1)}% is below 11% — capital buffer is weak and reduces valuation multiples.`);
  }
  if (!isFinite(input.rotcePct) && !isFinite(input.roePct)) warnings.push("ROTCE/ROE not available — profitability-adjusted multiples not applied.");
  if (!isPositive(tbv)) warnings.push("P/TBV unavailable; book value used. TBV would give a more conservative valuation anchor.");
  if (!isFinite(input.efficiencyRatioPct)) limitations.push("Efficiency ratio not available.");
  if (!isFinite(input.loanLossProvisionPct)) limitations.push("Loan loss provision rate not available.");
  if (!isFinite(input.netInterestMarginPct)) limitations.push("NIM not available.");

  warnings.push("Generic FCFF DCF should not dominate bank valuation; use P/TBV, ROTCE, and credit metrics.");

  // Capital-markets-heavy bank handling
  const hasCapitalMarketsData = isFinite(input.investmentBankingRevenueGrowthPct) || isFinite(input.tradingRevenueGrowthPct);
  if (hasCapitalMarketsData) {
    warnings.push("Capital markets revenue is cyclical — IB/trading upside may not be sustained.");
  }

  // ─── Confidence ─────────────────────────────────────────────────────────────

  let conf = 3;
  if (isPositive(tbv)) conf += 0; // TBV is the baseline
  if (isFinite(input.rotcePct)) conf += 1;
  if (isFinite(input.cet1RatioPct)) conf += 1;
  if (usingBookValue) conf -= 1;
  if (!isFinite(input.rotcePct) && !isFinite(input.roePct)) conf -= 1;
  if (warnings.filter(w => !w.includes("FCFF")).length >= 3) conf -= 1;

  return {
    modelId: "bank_valuation",
    status: "success",
    valuation,
    profitabilitySignals: {
      roeAssessment: assessRoe(input.roePct),
      rotceAssessment: assessRotce(input.rotcePct),
      efficiencyAssessment: assessEfficiency(input.efficiencyRatioPct),
      nimAssessment: assessNim(input.netInterestMarginPct),
    },
    capitalAndCreditSignals: {
      cet1Assessment: assessCet1(input.cet1RatioPct),
      creditRiskAssessment: assessCreditRisk(input.loanLossProvisionPct),
    },
    businessMixSignals: {
      feeCycleAssessment: assessFeeRevenue(input),
      capitalMarketsAssessment: assessCapitalMarkets(input),
    },
    confidence: clampConfidence(conf),
    warnings,
    limitations,
  };
}
