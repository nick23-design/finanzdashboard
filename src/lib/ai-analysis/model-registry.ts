import type { CompanyType } from "./company-type-router";

// ─── Model ID ─────────────────────────────────────────────────────────────────

export type AnalysisModelId =
  // Core cross-type models
  | "relative_valuation"
  | "dcf_scenarios"
  | "reverse_dcf"
  | "quality_score"
  | "moat_score"
  | "capital_allocation_score"
  | "balance_sheet_score"
  | "momentum_score"
  | "revision_momentum"
  | "risk_score"
  | "valuation_divergence"
  | "dcf_plausibility"
  | "reverse_dcf_plausibility"
  // Sector-specific / specialized models
  | "bank_valuation"
  | "insurance_underwriting"
  | "reit_affo_nav"
  | "commodity_energy_midcycle"
  | "commodity_mining_midcycle"
  | "software_rule_of_40"
  | "semiconductor_cycle"
  | "cyclical_hardware_normalized"
  | "platform_sotp"
  | "ai_exposure_narrative_score"
  | "healthcare_pharma_pipeline"
  | "healthcare_medtech_procedure_volume"
  | "utilities_regulated_asset_base"
  | "telecom_fcf_leverage"
  | "industrial_normalized_earnings"
  | "consumer_staples_defensive"
  | "consumer_discretionary_cycle"
  | "transportation_logistics_cycle";

// ─── Status / Role / Fit / RunStatus ──────────────────────────────────────────

export type AnalysisModelImplementationStatus =
  | "implemented"
  | "partially_implemented"
  | "planned"
  | "not_applicable";

export type AnalysisModelRole =
  | "primary"
  | "secondary"
  | "context"
  | "diagnostic"
  | "disabled";

export type AnalysisModelFit =
  | "poor"
  | "partial"
  | "good"
  | "primary";

export type AnalysisModelRunStatus =
  | "should_run"
  | "already_available"
  | "not_run_missing_inputs"
  | "not_run_not_implemented"
  | "not_run_not_applicable"
  | "disabled_by_company_type"
  | "failed";

// ─── Registry Entry ───────────────────────────────────────────────────────────

export type AnalysisModelRegistryEntry = {
  id: AnalysisModelId;
  label: string;
  description: string;
  implementationStatus: AnalysisModelImplementationStatus;
  defaultRole: AnalysisModelRole;
  defaultFit: AnalysisModelFit;
  applicableCompanyTypes: CompanyType[];
  weakCompanyTypes?: CompanyType[];
  notApplicableCompanyTypes?: CompanyType[];
  requiredInputs: string[];
  optionalInputs: string[];
  outputKind:
    | "valuation"
    | "quality"
    | "risk"
    | "momentum"
    | "revision"
    | "diagnostic"
    | "sector_specific"
    | "synthesis_context";
  warnings?: string[];
};

// ─── Registry ─────────────────────────────────────────────────────────────────

const ALL_TYPES: CompanyType[] = [
  "quality_compounder", "platform_conglomerate", "cyclical_hardware", "hypergrowth_software",
  "financial", "reit", "commodity_cyclical", "industrial_cyclical", "turnaround",
  "deep_value", "speculative_growth", "income", "unknown",
];

const NON_FINANCIAL_NON_REIT: CompanyType[] = ALL_TYPES.filter(
  t => t !== "financial" && t !== "reit",
);

export const MODEL_REGISTRY: AnalysisModelRegistryEntry[] = [
  // ─── Core implemented models ────────────────────────────────────────────────
  {
    id: "relative_valuation",
    label: "Relative Valuation",
    description: "Peer multiple comparison (P/E, EV/EBITDA, EV/Sales) vs sector and market.",
    implementationStatus: "implemented",
    defaultRole: "secondary",
    defaultFit: "good",
    applicableCompanyTypes: ALL_TYPES,
    requiredInputs: ["current_price", "market_cap"],
    optionalInputs: ["revenue", "ebit", "net_income", "gross_margin", "operating_margin", "analyst_consensus"],
    outputKind: "valuation",
  },
  {
    id: "dcf_scenarios",
    label: "DCF Scenarios (FCFF)",
    description: "FCFF DCF with bear/base/bull scenarios and WACC sector templates.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "good",
    applicableCompanyTypes: NON_FINANCIAL_NON_REIT,
    weakCompanyTypes: ["platform_conglomerate", "cyclical_hardware", "hypergrowth_software", "turnaround", "speculative_growth"],
    notApplicableCompanyTypes: ["financial", "reit"],
    requiredInputs: ["revenue", "operating_income", "free_cash_flow", "market_cap"],
    optionalInputs: ["capex", "net_debt", "shares_outstanding", "revenue_growth"],
    outputKind: "valuation",
    warnings: ["Generic FCFF DCF is a poor fit for financial companies and REITs."],
  },
  {
    id: "reverse_dcf",
    label: "Reverse DCF",
    description: "Back-calculates implied growth rate embedded in current market price.",
    implementationStatus: "implemented",
    defaultRole: "secondary",
    defaultFit: "good",
    applicableCompanyTypes: NON_FINANCIAL_NON_REIT,
    weakCompanyTypes: ["platform_conglomerate", "cyclical_hardware", "speculative_growth"],
    notApplicableCompanyTypes: ["financial", "reit"],
    requiredInputs: ["current_price", "revenue", "free_cash_flow"],
    optionalInputs: ["shares_outstanding", "net_debt"],
    outputKind: "valuation",
  },
  {
    id: "quality_score",
    label: "Quality Score",
    description: "Profitability, margin stability, and earnings quality assessment.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "good",
    applicableCompanyTypes: NON_FINANCIAL_NON_REIT,
    weakCompanyTypes: ["financial", "reit"],
    requiredInputs: ["revenue", "gross_margin", "operating_margin"],
    optionalInputs: ["fcf_margin", "roe", "roic"],
    outputKind: "quality",
  },
  {
    id: "moat_score",
    label: "Moat Score",
    description: "Competitive advantage durability assessment.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "good",
    applicableCompanyTypes: [
      "quality_compounder", "platform_conglomerate", "hypergrowth_software",
      "industrial_cyclical", "income", "deep_value", "unknown",
    ],
    weakCompanyTypes: ["cyclical_hardware", "turnaround", "speculative_growth", "commodity_cyclical"],
    requiredInputs: ["gross_margin", "operating_margin"],
    optionalInputs: ["roic", "revenue_growth"],
    outputKind: "quality",
  },
  {
    id: "capital_allocation_score",
    label: "Capital Allocation Score",
    description: "Management capital deployment quality (buybacks, capex, M&A).",
    implementationStatus: "implemented",
    defaultRole: "secondary",
    defaultFit: "good",
    applicableCompanyTypes: [
      "quality_compounder", "platform_conglomerate", "industrial_cyclical",
      "income", "deep_value", "turnaround", "unknown",
    ],
    weakCompanyTypes: ["cyclical_hardware", "hypergrowth_software", "speculative_growth", "commodity_cyclical"],
    requiredInputs: ["free_cash_flow", "capex"],
    optionalInputs: ["shares_outstanding", "net_debt", "revenue"],
    outputKind: "quality",
  },
  {
    id: "balance_sheet_score",
    label: "Balance Sheet Score",
    description: "Leverage, liquidity, and financial stress indicator.",
    implementationStatus: "planned",
    defaultRole: "secondary",
    defaultFit: "good",
    applicableCompanyTypes: [
      "cyclical_hardware", "industrial_cyclical", "turnaround", "deep_value",
      "commodity_cyclical", "income", "unknown",
    ],
    requiredInputs: ["net_debt", "total_debt", "cash"],
    optionalInputs: ["revenue", "operating_income", "free_cash_flow"],
    outputKind: "risk",
  },
  {
    id: "momentum_score",
    label: "Price Momentum Score",
    description: "Technical momentum and trend analysis.",
    implementationStatus: "implemented",
    defaultRole: "context",
    defaultFit: "partial",
    applicableCompanyTypes: ALL_TYPES,
    requiredInputs: ["price_history"],
    optionalInputs: ["technical_indicators"],
    outputKind: "momentum",
  },
  {
    id: "revision_momentum",
    label: "Analyst Revision Momentum",
    description: "Tracks direction and magnitude of analyst estimate changes.",
    implementationStatus: "implemented",
    defaultRole: "secondary",
    defaultFit: "good",
    applicableCompanyTypes: [
      "quality_compounder", "platform_conglomerate", "cyclical_hardware", "hypergrowth_software",
      "financial", "reit", "commodity_cyclical", "industrial_cyclical", "unknown",
    ],
    requiredInputs: ["analyst_estimates"],
    optionalInputs: ["estimate_revisions", "analyst_consensus"],
    outputKind: "revision",
  },
  {
    id: "risk_score",
    label: "Risk Score",
    description: "Composite risk: volatility, leverage, cyclicality, and data quality.",
    implementationStatus: "implemented",
    defaultRole: "secondary",
    defaultFit: "good",
    applicableCompanyTypes: ALL_TYPES,
    requiredInputs: ["market_cap"],
    optionalInputs: ["net_debt", "revenue", "operating_margin", "free_cash_flow"],
    outputKind: "risk",
  },
  {
    id: "valuation_divergence",
    label: "Valuation Divergence Analyzer",
    description: "Measures disagreement between analyst consensus, own model, and DCF.",
    implementationStatus: "implemented",
    defaultRole: "diagnostic",
    defaultFit: "good",
    applicableCompanyTypes: ALL_TYPES,
    requiredInputs: ["current_price"],
    optionalInputs: ["analyst_consensus"],
    outputKind: "diagnostic",
  },
  {
    id: "dcf_plausibility",
    label: "DCF Plausibility Check",
    description: "Evaluates DCF terminal-value sensitivity and model fit for the company type.",
    implementationStatus: "implemented",
    defaultRole: "diagnostic",
    defaultFit: "good",
    applicableCompanyTypes: ALL_TYPES,
    weakCompanyTypes: ["financial", "reit"],
    requiredInputs: ["current_price"],
    optionalInputs: ["analyst_consensus"],
    outputKind: "diagnostic",
  },
  {
    id: "reverse_dcf_plausibility",
    label: "Reverse DCF Plausibility Check",
    description: "Validates whether reverse DCF implied growth rate is within a plausible range.",
    implementationStatus: "implemented",
    defaultRole: "diagnostic",
    defaultFit: "good",
    applicableCompanyTypes: ALL_TYPES,
    weakCompanyTypes: ["financial", "reit"],
    requiredInputs: ["current_price", "free_cash_flow"],
    optionalInputs: [],
    outputKind: "diagnostic",
  },

  // ─── Sector-specific planned models ─────────────────────────────────────────
  {
    id: "bank_valuation",
    label: "Bank / Financial Valuation",
    description: "P/TBV, ROTCE, CET1, NIM, efficiency ratio, and credit-loss analysis.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["financial"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "financial"),
    requiredInputs: ["current_price", "tangible_book_value_per_share"],
    optionalInputs: ["book_value_per_share", "rotce", "roe", "cet1", "nim", "efficiency_ratio", "loan_losses"],
    outputKind: "sector_specific",
    warnings: ["Generic FCFF DCF is a poor fit for financial balance sheets; use P/TBV and ROTCE."],
  },
  {
    id: "insurance_underwriting",
    label: "Insurance Underwriting Model",
    description: "Combined ratio, investment yield, and reserve adequacy analysis.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["financial"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "financial"),
    requiredInputs: ["net_income", "operating_income"],
    optionalInputs: ["revenue", "total_debt"],
    outputKind: "sector_specific",
  },
  {
    id: "reit_affo_nav",
    label: "REIT AFFO / NAV Model",
    description: "Adjusted Funds From Operations, NAV, occupancy, cap rates, and payout ratio.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["reit"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "reit"),
    requiredInputs: ["current_price", "affo_per_share"],
    optionalInputs: ["ffo_per_share", "nav_per_share", "dividend_per_share", "occupancy", "same_store_noi", "cap_rates", "net_debt_to_ebitda"],
    outputKind: "sector_specific",
    warnings: ["Generic FCFF DCF should not dominate REIT valuation; use AFFO and NAV."],
  },
  {
    id: "commodity_energy_midcycle",
    label: "Commodity Energy Mid-Cycle Model",
    description: "Mid-cycle oil/gas price assumptions, production volume, and reserve analysis.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["commodity_cyclical"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "commodity_cyclical"),
    requiredInputs: ["current_price", "market_cap", "free_cash_flow"],
    optionalInputs: ["enterprise_value", "ebitda", "dividend_paid", "buybacks", "capex", "net_debt", "production_volume", "reserve_life", "oil_price", "midcycle_oil_price"],
    outputKind: "sector_specific",
    warnings: ["Do not extrapolate peak commodity earnings; require normalized mid-cycle price assumptions."],
  },
  {
    id: "commodity_mining_midcycle",
    label: "Commodity Mining Mid-Cycle Model",
    description: "Mid-cycle metals/materials pricing, cost curve, and reserve analysis.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["commodity_cyclical"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "commodity_cyclical"),
    requiredInputs: ["production_volume", "commodity_scenarios"],
    optionalInputs: ["reserves", "net_debt", "capex"],
    outputKind: "sector_specific",
    warnings: ["Do not extrapolate peak commodity earnings; require normalized mid-cycle price assumptions."],
  },
  {
    id: "software_rule_of_40",
    label: "Software Rule of 40",
    description: "ARR, NRR, SBC, FCF margin path, and growth/profitability balance.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["hypergrowth_software"],
    weakCompanyTypes: ["platform_conglomerate"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "hypergrowth_software" && t !== "platform_conglomerate"),
    requiredInputs: ["revenue_growth", "fcf_margin"],
    optionalInputs: ["arr", "nrr", "sbc", "ev_to_sales", "ev_to_fcf", "rule_of_40"],
    outputKind: "sector_specific",
    warnings: ["Watch SBC, ARR/NRR dilution, and FCF margin path alongside Rule-of-40."],
  },
  {
    id: "semiconductor_cycle",
    label: "Semiconductor Cycle Model",
    description: "Inventory cycle, structural AI compute demand, and through-cycle margins.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["cyclical_hardware"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "cyclical_hardware"),
    requiredInputs: ["revenue_growth"],
    optionalInputs: ["gross_margin", "operating_margin", "free_cash_flow", "ai_revenue", "datacenter_revenue", "memory_revenue", "inventory_growth", "customer_concentration", "ev_to_sales", "ev_to_ebitda", "pe"],
    outputKind: "sector_specific",
    warnings: ["Distinguish structural AI/compute growth from inventory/commodity cycle."],
  },
  {
    id: "cyclical_hardware_normalized",
    label: "Cyclical Hardware Normalized Earnings",
    description: "Normalized cycle earnings for hardware/infrastructure with margin/inventory stress.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["cyclical_hardware"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "cyclical_hardware"),
    requiredInputs: ["revenue", "operating_margin"],
    optionalInputs: ["gross_margin", "ebitda", "net_income", "free_cash_flow", "inventory_growth", "working_capital_growth", "customer_concentration", "historical_margin", "capex", "net_debt"],
    outputKind: "sector_specific",
    warnings: ["DCF can overstate value if peak growth/margins and terminal value are not stressed."],
  },
  {
    id: "platform_sotp",
    label: "Platform Sum-of-the-Parts (SOTP)",
    description: "Segment-aware valuation for mixed-margin platform conglomerates.",
    implementationStatus: "implemented",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["platform_conglomerate"],
    weakCompanyTypes: ["industrial_cyclical"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "platform_conglomerate" && t !== "industrial_cyclical"),
    requiredInputs: ["segments"],
    optionalInputs: ["segment_revenue", "segment_operating_income", "segment_ebitda", "segment_fcf", "market_cap", "net_debt", "shares_outstanding"],
    outputKind: "sector_specific",
    warnings: ["Generic consolidated DCF is too coarse for mixed-margin segments; SOTP should dominate."],
  },
  {
    id: "ai_exposure_narrative_score",
    label: "AI Exposure Narrative Score",
    description: "Cross-cutting diagnostic overlay that separates monetized AI exposure from narrative risk.",
    implementationStatus: "implemented",
    defaultRole: "diagnostic",
    defaultFit: "good",
    applicableCompanyTypes: ALL_TYPES,
    requiredInputs: [],
    optionalInputs: ["ai_indicator", "ai_revenue", "ai_backlog", "ai_capex", "datacenter_revenue", "ai_customer_wins", "revenue_growth", "fcf_margin", "gross_margin", "operating_margin", "sbc", "cash_burn", "market_cap"],
    outputKind: "diagnostic",
    warnings: ["AI exposure is an overlay, not a standalone valuation model or automatic Buy signal."],
  },
  {
    id: "healthcare_pharma_pipeline",
    label: "Healthcare Pharma Pipeline Valuation",
    description: "Risk-adjusted NPV for pharmaceutical pipeline, patent cliff, and pricing analysis.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["unknown"],
    requiredInputs: ["revenue", "operating_income"],
    optionalInputs: ["net_income", "free_cash_flow"],
    outputKind: "sector_specific",
    warnings: ["Pipeline risk, patent cliff, product concentration, and regulatory/pricing pressure."],
  },
  {
    id: "healthcare_medtech_procedure_volume",
    label: "Healthcare MedTech Procedure Volume Model",
    description: "Procedure volume, innovation cycle, reimbursement, and recall risk.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["unknown"],
    requiredInputs: ["revenue", "revenue_growth"],
    optionalInputs: ["operating_margin", "gross_margin"],
    outputKind: "sector_specific",
    warnings: ["Procedure volumes, innovation cycle, reimbursement, and recall risk."],
  },
  {
    id: "utilities_regulated_asset_base",
    label: "Utilities Regulated Asset Base Model",
    description: "Regulated asset base, allowed ROE, rate cases, and interest rate sensitivity.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["income"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "income"),
    requiredInputs: ["revenue", "operating_income", "net_debt"],
    optionalInputs: ["capex", "free_cash_flow"],
    outputKind: "sector_specific",
    warnings: ["Regulated asset base, allowed ROE, rate cases, interest rates, dividend coverage."],
  },
  {
    id: "telecom_fcf_leverage",
    label: "Telecom FCF and Leverage Model",
    description: "FCF yield, leverage, capex intensity, subscriber and ARPU trends.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["income"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "income"),
    requiredInputs: ["free_cash_flow", "net_debt", "capex"],
    optionalInputs: ["revenue", "operating_income"],
    outputKind: "sector_specific",
    warnings: ["FCF yield, leverage, capex intensity, subscriber/ARPU trends."],
  },
  {
    id: "industrial_normalized_earnings",
    label: "Industrial Normalized Earnings Model",
    description: "Order cycle, backlog, utilization, and normalized through-cycle margin analysis.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["industrial_cyclical"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "industrial_cyclical"),
    requiredInputs: ["revenue", "operating_margin"],
    optionalInputs: ["capex", "working_capital", "net_debt"],
    outputKind: "sector_specific",
    warnings: ["Use normalized margins, orders, backlog, and cycle position."],
  },
  {
    id: "consumer_staples_defensive",
    label: "Consumer Staples Defensive Model",
    description: "Pricing vs volume, brand strength, input cost inflation, and payout analysis.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["income", "quality_compounder"],
    notApplicableCompanyTypes: [
      "platform_conglomerate", "cyclical_hardware", "hypergrowth_software", "financial",
      "reit", "commodity_cyclical", "industrial_cyclical", "turnaround", "deep_value",
      "speculative_growth", "unknown",
    ],
    requiredInputs: ["revenue", "gross_margin", "operating_margin"],
    optionalInputs: ["revenue_growth", "free_cash_flow"],
    outputKind: "sector_specific",
    warnings: ["Pricing vs volume, brand strength, input cost inflation."],
  },
  {
    id: "consumer_discretionary_cycle",
    label: "Consumer Discretionary Cycle Model",
    description: "Consumer cycle, inventory, markdown risk, labor and input cost analysis.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["cyclical_hardware", "industrial_cyclical"],
    weakCompanyTypes: ["turnaround", "deep_value"],
    notApplicableCompanyTypes: [
      "quality_compounder", "platform_conglomerate", "hypergrowth_software", "financial",
      "reit", "commodity_cyclical", "speculative_growth", "income", "unknown",
    ],
    requiredInputs: ["revenue", "gross_margin"],
    optionalInputs: ["working_capital", "operating_margin", "revenue_growth"],
    outputKind: "sector_specific",
    warnings: ["Consumer cycle, inventory/markdowns, labor/input costs."],
  },
  {
    id: "transportation_logistics_cycle",
    label: "Transportation & Logistics Cycle Model",
    description: "Freight cycle, yield, volume, and cost structure analysis.",
    implementationStatus: "planned",
    defaultRole: "primary",
    defaultFit: "primary",
    applicableCompanyTypes: ["industrial_cyclical"],
    weakCompanyTypes: ["commodity_cyclical"],
    notApplicableCompanyTypes: ALL_TYPES.filter(t => t !== "industrial_cyclical" && t !== "commodity_cyclical"),
    requiredInputs: ["revenue", "operating_margin"],
    optionalInputs: ["capex", "net_debt"],
    outputKind: "sector_specific",
    warnings: ["Freight cycle, yield, volume, and cost structure."],
  },
];

// ─── Lookup helper ────────────────────────────────────────────────────────────

export function getModelById(id: AnalysisModelId): AnalysisModelRegistryEntry | undefined {
  return MODEL_REGISTRY.find(entry => entry.id === id);
}
