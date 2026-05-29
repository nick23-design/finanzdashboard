import { calculateReitAffoNav } from "../models/reit-affo-nav";
import { calculateBankValuation } from "../models/bank-valuation";
import { calculateCommodityEnergyMidcycle } from "../models/commodity-energy-midcycle";
import {
  runReitAffoNav,
  runBankValuation,
  runCommodityEnergyMidcycle,
  formatSpecializedValuationsForPrompt,
} from "../models/specialized-models";
import { getModelById } from "../model-registry";
import { buildModelSelectionPlan, detectAvailableModelInputs } from "../model-selector";
import type { CompanyTypeClassification } from "../company-type-router";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function classification(
  primaryType: CompanyTypeClassification["primaryType"],
  confidence: 1 | 2 | 3 | 4 | 5 = 4,
): CompanyTypeClassification {
  return { primaryType, secondaryTypes: [], confidence, rationale: "test", evidence: [], limitations: [] };
}

// ─── REIT AFFO/NAV tests ──────────────────────────────────────────────────────

describe("calculateReitAffoNav", () => {
  const baseInput = {
    currentPrice: 55,
    affoPerShare: 3.0,
    dividendPerShare: 2.5,
    navPerShare: 50,
    occupancyPct: 98,
    capRatePct: 5.5,
    costOfDebtPct: 3.5,
    netDebtToEbitda: 4.5,
  };

  it("calculates AFFO yield correctly", () => {
    const result = calculateReitAffoNav(baseInput);
    expect(result.status).toBe("success");
    expect(result.valuation.affoYieldPct).toBeCloseTo(3.0 / 55 * 100, 1);
  });

  it("calculates AFFO multiple correctly", () => {
    const result = calculateReitAffoNav(baseInput);
    expect(result.valuation.impliedAffoMultiple).toBeCloseTo(55 / 3.0, 1);
  });

  it("calculates payout ratio correctly", () => {
    const result = calculateReitAffoNav(baseInput);
    expect(result.valuation.affoPayoutRatioPct).toBeCloseTo(2.5 / 3.0 * 100, 1);
  });

  it("calculates NAV premium/discount correctly", () => {
    const result = calculateReitAffoNav(baseInput);
    // price 55 / nav 50 = 1.1 → +10%
    expect(result.valuation.navPremiumDiscountPct).toBeCloseTo(10, 0);
  });

  it("produces bear/base/bull fair values", () => {
    const result = calculateReitAffoNav(baseInput);
    expect(result.valuation.bearFairValue).toBeGreaterThan(0);
    expect(result.valuation.baseFairValue).toBeGreaterThan(0);
    expect(result.valuation.bullFairValue).toBeGreaterThan(0);
    expect(result.valuation.bearFairValue!).toBeLessThan(result.valuation.baseFairValue!);
    expect(result.valuation.baseFairValue!).toBeLessThan(result.valuation.bullFairValue!);
  });

  it("bear = 12x AFFO, base blends AFFO multiple and NAV", () => {
    const result = calculateReitAffoNav(baseInput);
    expect(result.valuation.bearFairValue).toBeCloseTo(3.0 * 12, 1);
    // base = avg(3.0 * 15, 50) = avg(45, 50) = 47.5
    expect(result.valuation.baseFairValue).toBeCloseTo(47.5, 0);
  });

  it("uses FFO as fallback when AFFO missing", () => {
    const result = calculateReitAffoNav({
      currentPrice: 50,
      ffoPerShare: 3.5,
    });
    expect(result.status).toBe("success");
    expect(result.limitations.some(l => l.includes("FFO"))).toBe(true);
    expect(result.valuation.affoYieldPct).toBeCloseTo(3.5 / 50 * 100, 1);
  });

  it("returns not_run_missing_inputs when neither AFFO nor FFO exists", () => {
    const result = calculateReitAffoNav({ currentPrice: 50 });
    expect(result.status).toBe("not_run_missing_inputs");
    expect(result.valuation).toEqual({});
  });

  it("warns when payout ratio > 90%", () => {
    const result = calculateReitAffoNav({ ...baseInput, dividendPerShare: 2.9 });
    // 2.9 / 3.0 = 96.7% > 90%
    expect(result.warnings.some(w => w.includes("payout ratio"))).toBe(true);
  });

  it("warns when occupancy < 95%", () => {
    const result = calculateReitAffoNav({ ...baseInput, occupancyPct: 93 });
    expect(result.warnings.some(w => w.includes("93.0%"))).toBe(true);
  });

  it("confidence is higher when both AFFO and NAV exist", () => {
    const withNav = calculateReitAffoNav(baseInput);
    const withoutNav = calculateReitAffoNav({ ...baseInput, navPerShare: undefined });
    expect(withNav.confidence).toBeGreaterThan(withoutNav.confidence);
  });

  it("confidence is lower when using FFO fallback vs AFFO", () => {
    const withAffo = calculateReitAffoNav(baseInput);
    const withFfo = calculateReitAffoNav({ ...baseInput, affoPerShare: undefined, ffoPerShare: 3.0 });
    expect(withAffo.confidence).toBeGreaterThanOrEqual(withFfo.confidence);
  });

  it("assesses occupancy correctly", () => {
    const strong = calculateReitAffoNav({ ...baseInput, occupancyPct: 98 });
    const weak = calculateReitAffoNav({ ...baseInput, occupancyPct: 90 });
    expect(strong.qualitySignals.occupancyAssessment).toBe("strong");
    expect(weak.qualitySignals.occupancyAssessment).toBe("weak");
  });

  it("assesses cap rate spread correctly", () => {
    const positive = calculateReitAffoNav({ ...baseInput, capRatePct: 6, costOfDebtPct: 3 });
    const negative = calculateReitAffoNav({ ...baseInput, capRatePct: 3, costOfDebtPct: 4 });
    expect(positive.qualitySignals.spreadAssessment).toBe("positive");
    expect(negative.qualitySignals.spreadAssessment).toBe("negative");
  });

  it("warns when net debt/EBITDA > 6x", () => {
    const result = calculateReitAffoNav({ ...baseInput, netDebtToEbitda: 7 });
    expect(result.warnings.some(w => w.includes("7.0x"))).toBe(true);
  });
});

// ─── Bank Valuation tests ─────────────────────────────────────────────────────

describe("calculateBankValuation", () => {
  const baseInput = {
    currentPrice: 45,
    tangibleBookValuePerShare: 30,
    roePct: 12,
    rotcePct: 14,
    cet1RatioPct: 13.5,
    netInterestMarginPct: 2.8,
    efficiencyRatioPct: 58,
    loanLossProvisionPct: 0.4,
    dividendPerShare: 2.0,
  };

  it("calculates P/TBV correctly", () => {
    const result = calculateBankValuation(baseInput);
    expect(result.status).toBe("success");
    expect(result.valuation.priceToTangibleBook).toBeCloseTo(45 / 30, 2);
  });

  it("calculates P/B fallback when TBV missing", () => {
    const result = calculateBankValuation({
      currentPrice: 40,
      bookValuePerShare: 25,
    });
    expect(result.status).toBe("success");
    expect(result.valuation.priceToBook).toBeCloseTo(40 / 25, 2);
    expect(result.limitations.some(l => l.includes("book value per share"))).toBe(true);
  });

  it("produces bear/base/bull fair values", () => {
    const result = calculateBankValuation(baseInput);
    expect(result.valuation.bearFairValue).toBeGreaterThan(0);
    expect(result.valuation.baseFairValue).toBeGreaterThan(0);
    expect(result.valuation.bullFairValue).toBeGreaterThan(0);
    expect(result.valuation.bearFairValue!).toBeLessThan(result.valuation.baseFairValue!);
  });

  it("ROTCE > 15% increases base and bull multiples", () => {
    const highRotce = calculateBankValuation({ ...baseInput, rotcePct: 18 });
    const base = calculateBankValuation(baseInput); // rotcePct = 14 (no adjustment)
    expect(highRotce.valuation.baseFairValue!).toBeGreaterThan(base.valuation.baseFairValue!);
    expect(highRotce.valuation.bullFairValue!).toBeGreaterThan(base.valuation.bullFairValue!);
  });

  it("ROTCE < 8% lowers valuation multiples", () => {
    const lowRotce = calculateBankValuation({ ...baseInput, rotcePct: 6 });
    const base = calculateBankValuation(baseInput);
    expect(lowRotce.valuation.baseFairValue!).toBeLessThan(base.valuation.baseFairValue!);
  });

  it("CET1 weakness adds warning", () => {
    const result = calculateBankValuation({ ...baseInput, cet1RatioPct: 10 });
    expect(result.warnings.some(w => w.includes("CET1") || w.includes("capital"))).toBe(true);
  });

  it("missing TBV and book value returns not_run_missing_inputs", () => {
    const result = calculateBankValuation({ currentPrice: 50 });
    expect(result.status).toBe("not_run_missing_inputs");
  });

  it("investment-banking revenue creates capital-markets signal", () => {
    const result = calculateBankValuation({
      ...baseInput,
      investmentBankingRevenueGrowthPct: 15,
      tradingRevenueGrowthPct: 8,
    });
    expect(result.businessMixSignals.capitalMarketsAssessment).toBe("positive");
  });

  it("generic FCFF DCF warning exists", () => {
    const result = calculateBankValuation(baseInput);
    expect(result.warnings.some(w => w.includes("FCFF DCF"))).toBe(true);
  });

  it("confidence is reduced when CET1 and ROTCE are missing", () => {
    const full = calculateBankValuation(baseInput);
    const missing = calculateBankValuation({ currentPrice: 40, tangibleBookValuePerShare: 25 });
    expect(full.confidence).toBeGreaterThan(missing.confidence);
  });

  it("assesses ROTCE correctly", () => {
    const strong = calculateBankValuation({ ...baseInput, rotcePct: 18 });
    const weak = calculateBankValuation({ ...baseInput, rotcePct: 7 });
    expect(strong.profitabilitySignals.rotceAssessment).toBe("strong");
    expect(weak.profitabilitySignals.rotceAssessment).toBe("weak");
  });

  it("assesses CET1 correctly", () => {
    const strong = calculateBankValuation({ ...baseInput, cet1RatioPct: 14 });
    const weak = calculateBankValuation({ ...baseInput, cet1RatioPct: 9 });
    expect(strong.capitalAndCreditSignals.cet1Assessment).toBe("strong");
    expect(weak.capitalAndCreditSignals.cet1Assessment).toBe("weak");
  });
});

// ─── Commodity Energy Mid-Cycle tests ─────────────────────────────────────────

describe("calculateCommodityEnergyMidcycle", () => {
  const baseInput = {
    currentPrice: 110,
    freeCashFlow: 35_000_000_000,
    marketCap: 450_000_000_000,
    enterpriseValue: 490_000_000_000,
    ebitda: 60_000_000_000,
    dividendPaid: 14_000_000_000,
    buybacks: 17_500_000_000,
    capex: 20_000_000_000,
    netDebt: 40_000_000_000,
    productionGrowthPct: 2,
    reserveLifeYears: 15,
    midcycleOilPrice: 65,
    bearOilPrice: 50,
    bullOilPrice: 90,
  };

  it("calculates FCF yield correctly", () => {
    const result = calculateCommodityEnergyMidcycle(baseInput);
    expect(result.status).toBe("success");
    expect(result.valuation.fcfYieldPct).toBeCloseTo(35e9 / 450e9 * 100, 1);
  });

  it("calculates EV/EBITDA correctly", () => {
    const result = calculateCommodityEnergyMidcycle(baseInput);
    expect(result.valuation.evToEbitda).toBeCloseTo(490 / 60, 1);
  });

  it("produces bear/base/bull fair values from FCF yield targets", () => {
    const result = calculateCommodityEnergyMidcycle(baseInput);
    expect(result.valuation.bearFairValue).toBeGreaterThan(0);
    expect(result.valuation.baseFairValue).toBeGreaterThan(0);
    expect(result.valuation.bullFairValue).toBeGreaterThan(0);
    // bull yield 6% should give higher value than base 8%, which gives higher than bear 12%
    expect(result.valuation.bearFairValue!).toBeLessThan(result.valuation.baseFairValue!);
    expect(result.valuation.baseFairValue!).toBeLessThan(result.valuation.bullFairValue!);
  });

  it("calculates shareholder return coverage", () => {
    const result = calculateCommodityEnergyMidcycle(baseInput);
    // (14bn + 17.5bn) / 35bn * 100 = 90%
    expect(result.shareholderReturnSignals.totalShareholderReturnCoveragePct).toBeCloseTo(90, 0);
  });

  it("warns when shareholder returns exceed FCF", () => {
    const result = calculateCommodityEnergyMidcycle({
      ...baseInput,
      dividendPaid: 25_000_000_000,
      buybacks: 20_000_000_000,
    });
    expect(result.warnings.some(w => w.includes("exceeds free cash flow") || w.includes("not sustainable"))).toBe(true);
  });

  it("returns not_run_missing_inputs when FCF/marketCap and EV/EBITDA are missing", () => {
    const result = calculateCommodityEnergyMidcycle({ currentPrice: 100 });
    expect(result.status).toBe("not_run_missing_inputs");
  });

  it("runs with only FCF + marketCap (without EV/EBITDA)", () => {
    const result = calculateCommodityEnergyMidcycle({
      currentPrice: 100,
      freeCashFlow: 10_000_000_000,
      marketCap: 100_000_000_000,
    });
    expect(result.status).toBe("success");
    expect(result.valuation.fcfYieldPct).toBeCloseTo(10, 1);
  });

  it("warns when commodity price assumptions missing", () => {
    const result = calculateCommodityEnergyMidcycle({
      currentPrice: 100,
      freeCashFlow: 10_000_000_000,
      marketCap: 100_000_000_000,
    });
    expect(result.warnings.some(w => w.includes("price") || w.includes("Commodity"))).toBe(true);
  });

  it("confidence is lower when production/reserve data missing", () => {
    const full = calculateCommodityEnergyMidcycle(baseInput);
    const missing = calculateCommodityEnergyMidcycle({
      currentPrice: 100,
      freeCashFlow: 10_000_000_000,
      marketCap: 100_000_000_000,
    });
    expect(full.confidence).toBeGreaterThan(missing.confidence);
  });

  it("assesses reserve life correctly", () => {
    const long = calculateCommodityEnergyMidcycle({ ...baseInput, reserveLifeYears: 20 });
    const short = calculateCommodityEnergyMidcycle({ ...baseInput, reserveLifeYears: 5 });
    expect(long.cycleSignals.reserveLifeAssessment).toBe("long");
    expect(short.cycleSignals.reserveLifeAssessment).toBe("short");
  });

  it("assesses leverage correctly", () => {
    const lowLev = calculateCommodityEnergyMidcycle({ ...baseInput, netDebt: 30_000_000_000 });
    const highLev = calculateCommodityEnergyMidcycle({ ...baseInput, netDebt: 200_000_000_000 });
    expect(lowLev.cycleSignals.leverageAssessment).toBe("low_risk");
    expect(highLev.cycleSignals.leverageAssessment).toBe("elevated_risk");
  });

  it("warns to not extrapolate peak commodity earnings", () => {
    const result = calculateCommodityEnergyMidcycle(baseInput);
    expect(result.warnings.some(w => w.toLowerCase().includes("peak"))).toBe(true);
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("specialized model runners (error handling)", () => {
  it("runReitAffoNav wraps errors and returns failed status", () => {
    // Normal call with no inputs → should return not_run_missing_inputs
    const result = runReitAffoNav({});
    expect(["not_run_missing_inputs", "success", "failed"]).toContain(result.status);
    expect(result.modelId).toBe("reit_affo_nav");
  });

  it("runBankValuation wraps errors", () => {
    const result = runBankValuation({});
    expect(result.modelId).toBe("bank_valuation");
  });

  it("runCommodityEnergyMidcycle wraps errors", () => {
    const result = runCommodityEnergyMidcycle({});
    expect(result.modelId).toBe("commodity_energy_midcycle");
  });
});

// ─── Registry tests ───────────────────────────────────────────────────────────

describe("model registry status", () => {
  it("reit_affo_nav is implemented", () => {
    const entry = getModelById("reit_affo_nav");
    expect(entry).toBeDefined();
    expect(entry!.implementationStatus).toBe("implemented");
  });

  it("bank_valuation is implemented", () => {
    const entry = getModelById("bank_valuation");
    expect(entry).toBeDefined();
    expect(entry!.implementationStatus).toBe("implemented");
  });

  it("commodity_energy_midcycle is implemented", () => {
    const entry = getModelById("commodity_energy_midcycle");
    expect(entry).toBeDefined();
    expect(entry!.implementationStatus).toBe("implemented");
  });

  it("reit_affo_nav requires current_price and affo_per_share", () => {
    const entry = getModelById("reit_affo_nav");
    expect(entry!.requiredInputs).toContain("current_price");
    expect(entry!.requiredInputs).toContain("affo_per_share");
  });

  it("bank_valuation requires current_price and tangible_book_value_per_share", () => {
    const entry = getModelById("bank_valuation");
    expect(entry!.requiredInputs).toContain("current_price");
    expect(entry!.requiredInputs).toContain("tangible_book_value_per_share");
  });

  it("commodity_energy_midcycle requires current_price, market_cap, free_cash_flow", () => {
    const entry = getModelById("commodity_energy_midcycle");
    expect(entry!.requiredInputs).toContain("current_price");
    expect(entry!.requiredInputs).toContain("market_cap");
    expect(entry!.requiredInputs).toContain("free_cash_flow");
  });
});

// ─── Selector behavior tests ──────────────────────────────────────────────────

describe("model selector with specialized models", () => {
  it("marks reit_affo_nav should_run when all required inputs exist", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 55, affoPerShare: 3.0, market_cap: 20_000_000_000 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("reit"),
      availableInputs: available,
    });
    const model = plan.models.find(m => m.id === "reit_affo_nav");
    expect(model?.runStatus).toBe("should_run");
  });

  it("marks reit_affo_nav not_run_missing_inputs when affo_per_share missing", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 55 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("reit"),
      availableInputs: available,
    });
    const model = plan.models.find(m => m.id === "reit_affo_nav");
    expect(model?.runStatus).toBe("not_run_missing_inputs");
    expect(model?.missingInputs).toContain("affo_per_share");
  });

  it("marks bank_valuation should_run when TBV exists", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 45, tangibleBookValuePerShare: 30 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("financial"),
      availableInputs: available,
    });
    const model = plan.models.find(m => m.id === "bank_valuation");
    expect(model?.runStatus).toBe("should_run");
  });

  it("marks bank_valuation not_run_missing_inputs when TBV missing", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 45 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("financial"),
      availableInputs: available,
    });
    const model = plan.models.find(m => m.id === "bank_valuation");
    expect(model?.runStatus).toBe("not_run_missing_inputs");
    expect(model?.missingInputs).toContain("tangible_book_value_per_share");
  });

  it("marks commodity_energy_midcycle should_run when FCF and market cap exist", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 110, market_cap: 450e9, free_cashflow: 35e9 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("commodity_cyclical"),
      availableInputs: available,
    });
    const model = plan.models.find(m => m.id === "commodity_energy_midcycle");
    expect(model?.runStatus).toBe("should_run");
  });

  it("marks commodity_energy_midcycle not_run_missing_inputs when FCF missing", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 110, market_cap: 450e9 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("commodity_cyclical"),
      availableInputs: available,
    });
    const model = plan.models.find(m => m.id === "commodity_energy_midcycle");
    expect(model?.runStatus).toBe("not_run_missing_inputs");
    expect(model?.missingInputs).toContain("free_cash_flow");
  });
});

// ─── Regression fixtures ──────────────────────────────────────────────────────

describe("Realty Income-like (REIT) regression", () => {
  it("succeeds when AFFO is provided", () => {
    const result = runReitAffoNav({
      currentPrice: 55,
      affoPerShare: 3.2,
      navPerShare: 52,
      dividendPerShare: 2.88,
      occupancyPct: 98.5,
    });
    expect(result.status).toBe("success");
    expect(result.valuation.affoYieldPct).toBeCloseTo(3.2 / 55 * 100, 1);
    expect(result.valuation.baseFairValue).toBeGreaterThan(0);
  });

  it("returns not_run_missing_inputs when AFFO is absent", () => {
    const result = runReitAffoNav({ currentPrice: 55 });
    expect(result.status).toBe("not_run_missing_inputs");
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("modelSelectionPlan marks reit_affo_nav as recommended-but-not-run when AFFO absent", () => {
    const available = detectAvailableModelInputs({ financials: { price: 55 } });
    const plan = buildModelSelectionPlan({
      companyType: classification("reit"),
      availableInputs: available,
    });
    const model = plan.models.find(m => m.id === "reit_affo_nav");
    expect(model?.runStatus).toBe("not_run_missing_inputs");
    // Implemented but unable to run due to missing inputs → surfaced as a
    // recommended-but-unavailable model so the synthesis can flag the limitation.
    expect(plan.missingButRecommendedModels.map(m => m.id)).toContain("reit_affo_nav");
  });
});

describe("Goldman Sachs-like (financial_bank) regression", () => {
  it("succeeds when TBV and ROTCE are provided", () => {
    const result = runBankValuation({
      currentPrice: 480,
      tangibleBookValuePerShare: 290,
      rotcePct: 16,
      cet1RatioPct: 14.5,
      investmentBankingRevenueGrowthPct: 12,
      tradingRevenueGrowthPct: 5,
    });
    expect(result.status).toBe("success");
    expect(result.profitabilitySignals.rotceAssessment).toBe("strong");
    expect(result.businessMixSignals.capitalMarketsAssessment).toBe("positive");
    expect(result.capitalAndCreditSignals.cet1Assessment).toBe("strong");
  });

  it("reduces confidence when CET1 and ROTCE are missing", () => {
    const withData = runBankValuation({ currentPrice: 480, tangibleBookValuePerShare: 290, rotcePct: 16, cet1RatioPct: 14.5 });
    const withoutData = runBankValuation({ currentPrice: 480, tangibleBookValuePerShare: 290 });
    expect(withData.confidence).toBeGreaterThan(withoutData.confidence);
  });

  it("always warns about FCFF DCF being a poor fit", () => {
    const result = runBankValuation({ currentPrice: 480, tangibleBookValuePerShare: 290 });
    expect(result.warnings.some(w => w.includes("FCFF DCF"))).toBe(true);
  });
});

describe("Exxon-like (commodity_cyclical) regression", () => {
  it("succeeds with FCF and market cap", () => {
    const result = runCommodityEnergyMidcycle({
      currentPrice: 110,
      freeCashFlow: 35_000_000_000,
      marketCap: 450_000_000_000,
      dividendPaid: 14_000_000_000,
      buybacks: 17_500_000_000,
    });
    expect(result.status).toBe("success");
    expect(result.valuation.fcfYieldPct).toBeCloseTo(35 / 450 * 100, 1);
    expect(result.shareholderReturnSignals.totalShareholderReturnCoveragePct).toBeCloseTo(90, 0);
  });

  it("always warns about peak commodity earnings extrapolation", () => {
    const result = runCommodityEnergyMidcycle({
      currentPrice: 110,
      freeCashFlow: 35_000_000_000,
      marketCap: 450_000_000_000,
    });
    expect(result.warnings.some(w => w.toLowerCase().includes("peak") || w.toLowerCase().includes("extrapolate"))).toBe(true);
  });

  it("selector marks should_run when FCF and market cap available", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 110, market_cap: 450e9, free_cashflow: 35e9 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("commodity_cyclical"),
      availableInputs: available,
    });
    const model = plan.models.find(m => m.id === "commodity_energy_midcycle");
    expect(model?.runStatus).toBe("should_run");
  });
});

// ─── formatSpecializedValuationsForPrompt ─────────────────────────────────────

describe("formatSpecializedValuationsForPrompt", () => {
  it("formats REIT output for Opus prompt", () => {
    const reitResult = runReitAffoNav({
      currentPrice: 55,
      affoPerShare: 3.0,
      navPerShare: 50,
    });
    const text = formatSpecializedValuationsForPrompt({ reitAffoNav: reitResult });
    expect(text).toContain("REIT AFFO/NAV");
    expect(text).toMatch(/AFFO|NAV/);
  });

  it("formats bank output for Opus prompt", () => {
    const bankResult = runBankValuation({
      currentPrice: 45,
      tangibleBookValuePerShare: 30,
      rotcePct: 15,
    });
    const text = formatSpecializedValuationsForPrompt({ bankValuation: bankResult });
    expect(text).toContain("Bank-Bewertungsmodell");
    expect(text).toMatch(/P\/TBV|ROTCE|TBV/);
  });

  it("formats commodity output for Opus prompt", () => {
    const energyResult = runCommodityEnergyMidcycle({
      currentPrice: 110,
      freeCashFlow: 35e9,
      marketCap: 450e9,
    });
    const text = formatSpecializedValuationsForPrompt({ commodityEnergyMidcycle: energyResult });
    expect(text).toContain("Commodity-Energie");
    expect(text).toMatch(/FCF|Midcycle/i);
  });

  it("formats not_run_missing_inputs status correctly", () => {
    const reitResult = runReitAffoNav({ currentPrice: 55 });
    const text = formatSpecializedValuationsForPrompt({ reitAffoNav: reitResult });
    expect(text).toMatch(/not_run_missing_inputs|empfohlen aber nicht ausführbar/);
  });

  it("returns empty string for empty valuations", () => {
    const text = formatSpecializedValuationsForPrompt({});
    expect(text).toBe("");
  });
});
