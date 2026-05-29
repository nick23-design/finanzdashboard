import {
  detectAvailableModelInputs,
  buildModelSelectionPlan,
  summarizeModelSelectionForSynthesis,
  type ModelInputAvailabilityContext,
} from "../model-selector";
import type { CompanyTypeClassification } from "../company-type-router";
import type { AnalysisModelId } from "../model-registry";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function classification(
  primaryType: CompanyTypeClassification["primaryType"],
  confidence: 1 | 2 | 3 | 4 | 5 = 4,
): CompanyTypeClassification {
  return {
    primaryType,
    secondaryTypes: [],
    confidence,
    rationale: `Test fixture for ${primaryType}`,
    evidence: ["test evidence"],
    limitations: [],
  };
}

function baseFinancials() {
  return {
    price: 150,
    market_cap: 2_000_000_000_000,
    free_cashflow: 90_000_000_000,
    revenue_growth: 0.08,
  };
}

function analystDataWithConsensus() {
  return { consensus: "Buy", targetPrice: 200 };
}

function planFor(
  primaryType: CompanyTypeClassification["primaryType"],
  overrideContext: Partial<ModelInputAvailabilityContext> = {},
  confidence: 1 | 2 | 3 | 4 | 5 = 4,
) {
  const availableInputs = detectAvailableModelInputs({
    financials: baseFinancials(),
    marketData: { price: 150, market_cap: 2_000_000_000_000 },
    analystData: analystDataWithConsensus(),
    ...overrideContext,
  });
  return buildModelSelectionPlan({
    companyType: classification(primaryType, confidence),
    availableInputs,
  });
}

function findModel(plan: ReturnType<typeof planFor>, id: AnalysisModelId) {
  return plan.models.find(m => m.id === id);
}

// ─── Input Detection Tests ────────────────────────────────────────────────────

describe("detectAvailableModelInputs", () => {
  it("detects common financial inputs from snapshot-like object", () => {
    const available = detectAvailableModelInputs({
      financials: {
        price: 100,
        market_cap: 500_000_000_000,
        free_cashflow: 10_000_000_000,
        revenue_growth: 0.12,
      },
    });
    expect(available.has("current_price")).toBe(true);
    expect(available.has("market_cap")).toBe(true);
    expect(available.has("free_cash_flow")).toBe(true);
    expect(available.has("revenue_growth")).toBe(true);
  });

  it("detects market data inputs", () => {
    const available = detectAvailableModelInputs({
      marketData: { price: 200, market_cap: 1_000_000_000_000 },
    });
    expect(available.has("current_price")).toBe(true);
    expect(available.has("market_cap")).toBe(true);
  });

  it("detects analyst consensus inputs", () => {
    const available = detectAvailableModelInputs({
      analystData: { consensus: "Buy", targetPrice: 250 },
    });
    expect(available.has("analyst_consensus")).toBe(true);
  });

  it("detects analyst estimate inputs", () => {
    const available = detectAvailableModelInputs({
      analystData: { estimates: [{ year: 2025, eps: 10 }] },
    });
    expect(available.has("analyst_estimates")).toBe(true);
  });

  it("detects technical indicators", () => {
    const available = detectAvailableModelInputs({
      technicals: { rsi: 55 },
    });
    expect(available.has("technical_indicators")).toBe(true);
  });

  it("detects price history from market data", () => {
    const available = detectAvailableModelInputs({
      marketData: { price_history: [100, 110, 120] },
    });
    expect(available.has("price_history")).toBe(true);
  });

  it("detects bank-specific inputs", () => {
    const available = detectAvailableModelInputs({
      financials: { cet1: 0.13, nim: 0.03, rotce: 0.15, ptbv: 1.8, loanLosses: 500_000_000 },
    });
    expect(available.has("cet1")).toBe(true);
    expect(available.has("nim")).toBe(true);
    expect(available.has("rotce")).toBe(true);
    expect(available.has("ptbv")).toBe(true);
    expect(available.has("loan_losses")).toBe(true);
  });

  it("detects REIT-specific inputs", () => {
    const available = detectAvailableModelInputs({
      financials: { affo: 3_000_000_000, nav: 50_000_000_000, occupancy: 0.96, cap_rates: 0.05 },
    });
    expect(available.has("affo")).toBe(true);
    expect(available.has("nav")).toBe(true);
    expect(available.has("occupancy")).toBe(true);
    expect(available.has("cap_rates")).toBe(true);
  });

  it("detects commodity-specific inputs", () => {
    const available = detectAvailableModelInputs({
      financials: { oil_price: 75, gas_price: 3.5, productionVolume: 4_000_000 },
    });
    expect(available.has("oil_price")).toBe(true);
    expect(available.has("gas_price")).toBe(true);
    expect(available.has("production_volume")).toBe(true);
  });

  it("does not add missing fields", () => {
    const available = detectAvailableModelInputs({
      financials: { revenue_growth: 0.1 },
    });
    expect(available.has("current_price")).toBe(false);
    expect(available.has("market_cap")).toBe(false);
    expect(available.has("affo")).toBe(false);
    expect(available.has("cet1")).toBe(false);
  });

  it("marks existing model outputs via existingOutputs", () => {
    const available = detectAvailableModelInputs({
      existingOutputs: { quality_score: { score: 80 } },
    });
    expect(available.has("output:quality_score")).toBe(true);
    expect(available.has("output:bank_valuation")).toBe(false);
  });

  it("detects segment data from array", () => {
    const available = detectAvailableModelInputs({
      segments: [
        { name: "Cloud", revenuePct: 0.3, operatingMargin: 0.35 },
        { name: "Retail", revenuePct: 0.5, operatingMargin: 0.02 },
      ],
    });
    expect(available.has("segments")).toBe(true);
    expect(available.has("segment_revenue")).toBe(true);
    expect(available.has("segment_operating_income")).toBe(true);
  });

  it("does not detect segments from array with fewer than 2 items", () => {
    const available = detectAvailableModelInputs({
      segments: [{ name: "SingleSegment", revenuePct: 1 }],
    });
    expect(available.has("segments")).toBe(false);
  });
});

// ─── Model Selector Tests ─────────────────────────────────────────────────────

describe("buildModelSelectionPlan – quality_compounder", () => {
  it("selects DCF as primary", () => {
    const plan = planFor("quality_compounder");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(dcf?.role).toBe("primary");
    expect(dcf?.fit).toBe("primary");
  });

  it("selects Reverse DCF as primary", () => {
    const plan = planFor("quality_compounder");
    const rdcf = findModel(plan, "reverse_dcf");
    expect(rdcf?.role).toBe("primary");
  });

  it("selects Relative Valuation as primary/good", () => {
    const plan = planFor("quality_compounder");
    const rv = findModel(plan, "relative_valuation");
    expect(rv?.role).toBe("primary");
    expect(["primary", "good"]).toContain(rv?.fit);
  });

  it("selects Quality Score as primary", () => {
    const plan = planFor("quality_compounder");
    const qs = findModel(plan, "quality_score");
    expect(qs?.role).toBe("primary");
    expect(qs?.fit).toBe("primary");
  });

  it("selects Moat Score as primary", () => {
    const plan = planFor("quality_compounder");
    const moat = findModel(plan, "moat_score");
    expect(moat?.role).toBe("primary");
    expect(moat?.fit).toBe("primary");
  });

  it("selects Capital Allocation Score as primary", () => {
    const plan = planFor("quality_compounder");
    const capAlloc = findModel(plan, "capital_allocation_score");
    expect(capAlloc?.role).toBe("primary");
    expect(capAlloc?.fit).toBe("primary");
  });

  it("warns that expensive valuation alone should not trigger Sell", () => {
    const plan = planFor("quality_compounder");
    expect(plan.warnings.join(" ")).toContain("Sell");
  });
});

describe("buildModelSelectionPlan – platform_conglomerate", () => {
  it("recommends platform_sotp as primary", () => {
    const plan = planFor("platform_conglomerate");
    const sotp = findModel(plan, "platform_sotp");
    expect(sotp?.role).toBe("primary");
    expect(sotp?.fit).toBe("primary");
  });

  it("marks platform_sotp as not_run_missing_inputs when segment data is unavailable", () => {
    const plan = planFor("platform_conglomerate");
    const sotp = findModel(plan, "platform_sotp");
    expect(sotp?.runStatus).toBe("not_run_missing_inputs");
  });

  it("marks platform_sotp as should_run when segment data exists", () => {
    const plan = planFor("platform_conglomerate", {
      segments: [
        { name: "Cloud", revenue: 100, operatingIncome: 30 },
        { name: "Retail", revenue: 300, operatingIncome: 8 },
      ],
    });
    const sotp = findModel(plan, "platform_sotp");
    expect(sotp?.runStatus).toBe("should_run");
  });

  it("puts platform_sotp in missingButRecommendedModels", () => {
    const plan = planFor("platform_conglomerate");
    expect(plan.missingButRecommendedModels.map(m => m.id)).toContain("platform_sotp");
  });

  it("marks generic DCF as partial fit secondary", () => {
    const plan = planFor("platform_conglomerate");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(dcf?.fit).toBe("partial");
    expect(dcf?.role).toBe("secondary");
  });

  it("warns about segment economics when segment data is missing", () => {
    const plan = planFor("platform_conglomerate");
    const sotp = findModel(plan, "platform_sotp");
    expect(sotp?.missingInputs).toContain("segments");
  });

  it("includes segment warning in plan warnings", () => {
    const plan = planFor("platform_conglomerate");
    expect(plan.warnings.some(w => w.includes("segment"))).toBe(true);
  });
});

describe("buildModelSelectionPlan – cyclical_hardware", () => {
  it("recommends cyclical_hardware_normalized as primary", () => {
    const plan = planFor("cyclical_hardware");
    const hwNorm = findModel(plan, "cyclical_hardware_normalized");
    expect(hwNorm?.role).toBe("primary");
    expect(hwNorm?.fit).toBe("primary");
  });

  it("puts cyclical_hardware_normalized in missingButRecommendedModels", () => {
    const plan = planFor("cyclical_hardware");
    expect(plan.missingButRecommendedModels.map(m => m.id)).toContain("cyclical_hardware_normalized");
  });

  it("marks DCF as partial fit", () => {
    const plan = planFor("cyclical_hardware");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(dcf?.fit).toBe("partial");
  });

  it("warns about working capital and terminal value stress", () => {
    const plan = planFor("cyclical_hardware");
    const allText = [...plan.warnings, ...plan.models.flatMap(m => m.warnings)].join(" ");
    expect(allText.toLowerCase()).toContain("terminal value");
  });

  it("selects semiconductor_cycle as runnable when revenue growth is available", () => {
    const plan = planFor("cyclical_hardware");
    const semi = findModel(plan, "semiconductor_cycle");
    expect(semi?.role).toBe("primary");
    expect(semi?.runStatus).toBe("should_run");
  });
});

describe("buildModelSelectionPlan – financial", () => {
  it("recommends bank_valuation as primary", () => {
    const plan = planFor("financial");
    const bank = findModel(plan, "bank_valuation");
    expect(bank?.role).toBe("primary");
    expect(bank?.fit).toBe("primary");
  });

  it("bank_valuation is not_run_missing_inputs when tangible_book_value missing", () => {
    const plan = planFor("financial");
    const bank = findModel(plan, "bank_valuation");
    expect(bank?.runStatus).toBe("not_run_missing_inputs");
    expect(bank?.missingInputs).toContain("tangible_book_value_per_share");
  });

  it("disables generic FCFF DCF for financial", () => {
    const plan = planFor("financial");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(["disabled", "disabled_by_company_type"]).toContain(dcf?.role === "disabled" ? "disabled" : dcf?.runStatus);
  });

  it("marks generic DCF as poor fit for financial", () => {
    const plan = planFor("financial");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(dcf?.fit).toBe("poor");
  });

  it("warns about bank-specific metrics", () => {
    const plan = planFor("financial");
    const allText = plan.warnings.join(" ");
    expect(allText).toContain("ROTCE");
  });

  it("bank_valuation reports missing tangible_book_value_per_share when not provided", () => {
    const plan = planFor("financial");
    const bank = findModel(plan, "bank_valuation");
    expect(bank?.missingInputs.length).toBeGreaterThan(0);
    expect(bank?.missingInputs).toContain("tangible_book_value_per_share");
  });
});

describe("buildModelSelectionPlan – reit", () => {
  it("recommends reit_affo_nav as primary", () => {
    const plan = planFor("reit");
    const reitModel = findModel(plan, "reit_affo_nav");
    expect(reitModel?.role).toBe("primary");
    expect(reitModel?.fit).toBe("primary");
  });

  it("reit_affo_nav is not_run_missing_inputs when affo_per_share missing", () => {
    const plan = planFor("reit");
    const reitModel = findModel(plan, "reit_affo_nav");
    expect(reitModel?.runStatus).toBe("not_run_missing_inputs");
    expect(reitModel?.missingInputs).toContain("affo_per_share");
  });

  it("marks generic FCFF DCF as poor/disabled for REITs", () => {
    const plan = planFor("reit");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(dcf?.fit).toBe("poor");
  });

  it("warns about AFFO and NAV for REITs", () => {
    const plan = planFor("reit");
    const allText = plan.warnings.join(" ");
    expect(allText).toContain("AFFO");
  });

  it("reit_affo_nav reports missing affo_per_share input", () => {
    const plan = planFor("reit");
    const reitModel = findModel(plan, "reit_affo_nav");
    expect(reitModel?.missingInputs).toContain("affo_per_share");
  });
});

describe("buildModelSelectionPlan – commodity_cyclical", () => {
  it("recommends commodity_energy_midcycle as primary", () => {
    const plan = planFor("commodity_cyclical");
    const energyModel = findModel(plan, "commodity_energy_midcycle");
    expect(energyModel?.role).toBe("primary");
    expect(energyModel?.fit).toBe("primary");
  });

  it("commodity_energy_midcycle is should_run when FCF and market cap available", () => {
    const plan = planFor("commodity_cyclical");
    const energyModel = findModel(plan, "commodity_energy_midcycle");
    // Base financials provide price, market_cap, free_cashflow → should_run
    expect(energyModel?.runStatus).toBe("should_run");
  });

  it("marks DCF as secondary with partial fit", () => {
    const plan = planFor("commodity_cyclical");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(dcf?.role).toBe("secondary");
    expect(dcf?.fit).toBe("partial");
  });

  it("warns about peak commodity earnings extrapolation", () => {
    const plan = planFor("commodity_cyclical");
    const allText = plan.warnings.join(" ");
    expect(allText.toLowerCase()).toContain("peak");
  });

  it("commodity_energy_midcycle notes optional oil/production inputs not provided", () => {
    const plan = planFor("commodity_cyclical");
    const energyModel = findModel(plan, "commodity_energy_midcycle");
    // Required inputs (price, market_cap, free_cash_flow) are available → should_run
    expect(energyModel?.runStatus).toBe("should_run");
    // Optional oil/production inputs not in base financials but that's fine
    expect(energyModel?.availableInputs).toContain("free_cash_flow");
  });
});

describe("buildModelSelectionPlan – hypergrowth_software", () => {
  it("recommends software_rule_of_40 as primary", () => {
    const plan = planFor("hypergrowth_software");
    const r40 = findModel(plan, "software_rule_of_40");
    expect(r40?.role).toBe("primary");
    expect(r40?.fit).toBe("primary");
  });

  it("puts software_rule_of_40 in missingButRecommendedModels", () => {
    const plan = planFor("hypergrowth_software");
    expect(plan.missingButRecommendedModels.map(m => m.id)).toContain("software_rule_of_40");
  });

  it("marks software_rule_of_40 should_run when growth and FCF margin exist", () => {
    const plan = planFor("hypergrowth_software", {
      financials: { ...baseFinancials(), fcfMargin: 12, evToSales: 9 },
    });
    const model = findModel(plan, "software_rule_of_40");
    expect(model?.runStatus).toBe("should_run");
  });

  it("warns about SBC and ARR/NRR", () => {
    const plan = planFor("hypergrowth_software");
    const allText = plan.warnings.join(" ");
    expect(allText).toContain("SBC");
  });
});

describe("AI exposure overlay selection", () => {
  it("keeps ai_exposure_narrative_score diagnostic, never primary valuation", () => {
    const plan = planFor("quality_compounder", {
      companyProfile: { sector: "Technology", industry: "Cloud platform AI" },
    });
    const overlay = findModel(plan, "ai_exposure_narrative_score");
    expect(overlay?.role).toBe("diagnostic");
    expect(overlay?.runStatus).toBe("should_run");
    expect(plan.primaryModels.map(m => m.id)).not.toContain("ai_exposure_narrative_score");
  });
});

describe("buildModelSelectionPlan – unknown", () => {
  it("does not place any model in the primary role", () => {
    const plan = planFor("unknown");
    const runningPrimary = plan.primaryModels.filter(
      m => m.runStatus === "should_run" || m.runStatus === "already_available",
    );
    expect(runningPrimary.length).toBe(0);
  });

  it("warns about low confidence", () => {
    const plan = planFor("unknown");
    const allText = plan.warnings.join(" ");
    expect(allText.toLowerCase()).toContain("unknown");
  });

  it("includes a low-confidence classification warning when confidence = 1", () => {
    const plan = planFor("unknown", {}, 1);
    expect(plan.warnings.join(" ")).toContain("confidence");
  });
});

// ─── Missing Input Scenarios ──────────────────────────────────────────────────

describe("missing input scenarios", () => {
  it("platform_sotp has missing segment inputs and is not_run_missing_inputs", () => {
    const plan = planFor("platform_conglomerate");
    const sotp = findModel(plan, "platform_sotp");
    expect(sotp?.runStatus).toBe("not_run_missing_inputs");
    expect(sotp?.missingInputs).toContain("segments");
  });

  it("reit_affo_nav is not_run_missing_inputs and reports affo_per_share as missing", () => {
    const plan = planFor("reit");
    const reitModel = findModel(plan, "reit_affo_nav");
    expect(reitModel?.missingInputs).toContain("affo_per_share");
    expect(reitModel?.runStatus).toBe("not_run_missing_inputs");
  });

  it("bank_valuation reports tangible_book_value_per_share as missing", () => {
    const plan = planFor("financial");
    const bank = findModel(plan, "bank_valuation");
    expect(bank?.missingInputs).toContain("tangible_book_value_per_share");
    expect(bank?.runStatus).toBe("not_run_missing_inputs");
  });

  it("commodity_energy_midcycle is should_run with base financials (FCF + market cap)", () => {
    const plan = planFor("commodity_cyclical");
    const energy = findModel(plan, "commodity_energy_midcycle");
    expect(energy?.runStatus).toBe("should_run");
  });

  it("implemented models with available inputs are marked should_run", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 150, market_cap: 2_000_000_000_000, free_cashflow: 90_000_000_000, revenue_growth: 0.08 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("quality_compounder"),
      availableInputs: available,
    });
    const risk = findModel(plan, "risk_score");
    expect(risk?.runStatus).toBe("should_run");
  });

  it("implemented models with missing required inputs are marked not_run_missing_inputs", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 150 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("quality_compounder"),
      availableInputs: available,
    });
    const dcf = findModel(plan, "dcf_scenarios");
    expect(dcf?.runStatus).toBe("not_run_missing_inputs");
    expect(dcf?.missingInputs.length).toBeGreaterThan(0);
  });

  it("marks existing outputs as already_available", () => {
    const available = detectAvailableModelInputs({
      financials: { price: 150, market_cap: 1_000_000_000_000 },
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("quality_compounder"),
      availableInputs: available,
      existingOutputs: { quality_score: { score: 85, strengths: [] } },
    });
    const qs = findModel(plan, "quality_score");
    expect(qs?.runStatus).toBe("already_available");
  });
});

// ─── Synthesis Summary ────────────────────────────────────────────────────────

describe("summarizeModelSelectionForSynthesis", () => {
  it("lists primary models that can run", () => {
    const available = detectAvailableModelInputs({
      financials: baseFinancials(),
      marketData: { price: 150, market_cap: 2_000_000_000_000 },
      existingOutputs: undefined,
    });
    const plan = buildModelSelectionPlan({
      companyType: classification("quality_compounder"),
      availableInputs: available,
      existingOutputs: {
        quality_score: { score: 85 },
        moat_score: { score: 75 },
        capital_allocation_score: { score: 70 },
      },
    });
    const summary = summarizeModelSelectionForSynthesis(plan);
    expect(summary.primaryModels).toContain("quality_score");
    expect(summary.primaryModels).toContain("moat_score");
    expect(summary.primaryModels).toContain("capital_allocation_score");
  });

  it("lists missing but recommended models", () => {
    const plan = planFor("platform_conglomerate");
    const summary = summarizeModelSelectionForSynthesis(plan);
    expect(summary.missingButRecommendedModels).toContain("platform_sotp");
  });

  it("lists weak or disabled models", () => {
    const plan = planFor("financial");
    const summary = summarizeModelSelectionForSynthesis(plan);
    expect(summary.weakOrDisabledModels.length).toBeGreaterThan(0);
  });

  it("includes warnings in the summary", () => {
    const plan = planFor("quality_compounder");
    const summary = summarizeModelSelectionForSynthesis(plan);
    expect(summary.warnings.length).toBeGreaterThan(0);
  });

  it("includes limitations in the summary", () => {
    const plan = planFor("financial");
    const summary = summarizeModelSelectionForSynthesis(plan);
    expect(summary.limitations.length).toBeGreaterThan(0);
  });

  it("missing but recommended models appear as strings (model IDs)", () => {
    const plan = planFor("platform_conglomerate");
    const summary = summarizeModelSelectionForSynthesis(plan);
    expect(summary.missingButRecommendedModels).toContain("platform_sotp");
    for (const id of summary.missingButRecommendedModels) {
      expect(typeof id).toBe("string");
    }
  });
});

// ─── Regression Fixtures ──────────────────────────────────────────────────────

describe("regression fixtures", () => {
  it("Apple-like: quality_compounder selects DCF, ReverseDCF, RelVal, Quality, Moat, CapAlloc as primary", () => {
    const plan = planFor("quality_compounder");
    const expectedPrimary: AnalysisModelId[] = [
      "dcf_scenarios", "reverse_dcf", "relative_valuation",
      "quality_score", "moat_score", "capital_allocation_score",
    ];
    for (const id of expectedPrimary) {
      const model = findModel(plan, id);
      expect(model?.role).toBe("primary");
    }
  });

  it("Amazon-like: platform_conglomerate recommends SOTP and marks DCF partial", () => {
    const plan = planFor("platform_conglomerate");
    const sotp = findModel(plan, "platform_sotp");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(sotp?.role).toBe("primary");
    expect(sotp?.runStatus).toBe("not_run_missing_inputs");
    expect(plan.missingButRecommendedModels.map(m => m.id)).toContain("platform_sotp");
    expect(dcf?.fit).toBe("partial");
  });

  it("Amazon-like: warns about segment economics when segment data is missing", () => {
    const plan = planFor("platform_conglomerate");
    expect(plan.warnings.join(" ")).toContain("segment");
  });

  it("SMCI-like: cyclical_hardware recommends normalized model and marks DCF partial", () => {
    const plan = planFor("cyclical_hardware");
    const hwNorm = findModel(plan, "cyclical_hardware_normalized");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(plan.missingButRecommendedModels.map(m => m.id)).toContain("cyclical_hardware_normalized");
    expect(dcf?.fit).toBe("partial");
    expect(hwNorm?.role).toBe("primary");
  });

  it("SMCI-like: warns about inventory, working capital, terminal value", () => {
    const plan = planFor("cyclical_hardware");
    const allText = [...plan.warnings, ...plan.models.flatMap(m => m.warnings)].join(" ");
    expect(allText.toLowerCase()).toMatch(/terminal value|working capital/);
  });

  it("JPM-like: financial selects bank_valuation as primary and disables generic DCF", () => {
    const plan = planFor("financial");
    const bank = findModel(plan, "bank_valuation");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(bank?.role).toBe("primary");
    expect(bank?.runStatus).toBe("not_run_missing_inputs"); // implemented but needs TBV
    expect(dcf?.fit).toBe("poor");
    expect(dcf?.role).toBe("disabled");
  });

  it("JPM-like: bank_valuation lists tangible_book_value_per_share as missing", () => {
    const plan = planFor("financial");
    const bank = findModel(plan, "bank_valuation");
    expect(bank?.missingInputs).toContain("tangible_book_value_per_share");
  });

  it("PLD-like: reit selects reit_affo_nav as primary and disables generic DCF", () => {
    const plan = planFor("reit");
    const reitModel = findModel(plan, "reit_affo_nav");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(reitModel?.role).toBe("primary");
    expect(reitModel?.runStatus).toBe("not_run_missing_inputs"); // implemented but needs affo_per_share
    expect(dcf?.fit).toBe("poor");
  });

  it("PLD-like: reit_affo_nav lists affo_per_share as missing input", () => {
    const plan = planFor("reit");
    const reitModel = findModel(plan, "reit_affo_nav");
    expect(reitModel?.missingInputs).toContain("affo_per_share");
  });

  it("XOM-like: commodity_cyclical selects energy midcycle (should_run) and uses DCF only as secondary/partial", () => {
    const plan = planFor("commodity_cyclical");
    const energy = findModel(plan, "commodity_energy_midcycle");
    const dcf = findModel(plan, "dcf_scenarios");
    expect(energy?.role).toBe("primary");
    expect(energy?.runStatus).toBe("should_run"); // implemented and FCF+marketCap available
    expect(dcf?.role).toBe("secondary");
    expect(dcf?.fit).toBe("partial");
  });

  it("XOM-like: warns against extrapolating peak commodity earnings", () => {
    const plan = planFor("commodity_cyclical");
    expect(plan.warnings.join(" ").toLowerCase()).toContain("peak");
  });
});
