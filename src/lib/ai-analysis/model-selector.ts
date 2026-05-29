import type { CompanyType, CompanyTypeClassification } from "./company-type-router";
import {
  MODEL_REGISTRY,
  type AnalysisModelId,
  type AnalysisModelFit,
  type AnalysisModelRole,
  type AnalysisModelRunStatus,
  type AnalysisModelImplementationStatus,
  type AnalysisModelRegistryEntry,
} from "./model-registry";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SelectedAnalysisModel = {
  id: AnalysisModelId;
  role: AnalysisModelRole;
  fit: AnalysisModelFit;
  runStatus: AnalysisModelRunStatus;
  implementationStatus: AnalysisModelImplementationStatus;
  reason: string;
  requiredInputs: string[];
  optionalInputs: string[];
  availableInputs: string[];
  missingInputs: string[];
  warnings: string[];
  limitations: string[];
};

export type ModelSelectionPlan = {
  companyType: CompanyTypeClassification;
  sector?: string;
  industry?: string;
  models: SelectedAnalysisModel[];
  primaryModels: SelectedAnalysisModel[];
  secondaryModels: SelectedAnalysisModel[];
  diagnosticModels: SelectedAnalysisModel[];
  contextModels: SelectedAnalysisModel[];
  disabledModels: SelectedAnalysisModel[];
  missingButRecommendedModels: SelectedAnalysisModel[];
  warnings: string[];
  limitations: string[];
};

export type ModelInputAvailabilityContext = {
  financials?: unknown;
  marketData?: unknown;
  analystData?: unknown;
  technicals?: unknown;
  companyProfile?: unknown;
  segments?: unknown;
  estimates?: unknown;
  existingOutputs?: Partial<Record<AnalysisModelId, unknown>>;
};

export type ModelSelectionPlanInput = {
  companyType: CompanyTypeClassification;
  sector?: string;
  industry?: string;
  availableInputs: Set<string>;
  existingOutputs?: Partial<Record<AnalysisModelId, unknown>>;
};

export type ModelSelectionSummary = {
  primaryModels: string[];
  secondaryModels: string[];
  weakOrDisabledModels: string[];
  missingButRecommendedModels: string[];
  warnings: string[];
  limitations: string[];
};

// ─── Company-type model overrides ─────────────────────────────────────────────

type ModelOverride = {
  role: AnalysisModelRole;
  fit: AnalysisModelFit;
  reason: string;
  warnings?: string[];
};

type TypeConfig = {
  overrides: Partial<Record<AnalysisModelId, ModelOverride>>;
  typeWarnings: string[];
  typeLimitations: string[];
};

const TYPE_CONFIG: Partial<Record<CompanyType, TypeConfig>> = {
  quality_compounder: {
    overrides: {
      dcf_scenarios: {
        role: "primary", fit: "primary",
        reason: "Durable FCF and high quality support FCFF DCF as primary valuation.",
      },
      reverse_dcf: {
        role: "primary", fit: "good",
        reason: "Reverse DCF exposes growth expectations embedded in the price.",
      },
      relative_valuation: {
        role: "primary", fit: "good",
        reason: "Quality multiples should be checked against comparable quality-growth peers.",
      },
      quality_score: {
        role: "primary", fit: "primary",
        reason: "Business quality is the central thesis driver for quality compounders.",
      },
      moat_score: {
        role: "primary", fit: "primary",
        reason: "Moat durability is a defining trait of quality compounders.",
      },
      capital_allocation_score: {
        role: "primary", fit: "primary",
        reason: "Capital allocation quality defines long-term per-share value creation.",
      },
      momentum_score: {
        role: "secondary", fit: "partial",
        reason: "Momentum provides timing context but is not a primary driver.",
      },
      revision_momentum: {
        role: "secondary", fit: "good",
        reason: "Analyst revision trends inform timing and conviction.",
      },
      risk_score: {
        role: "secondary", fit: "good",
        reason: "Risk assessment frames downside and balance sheet health.",
      },
    },
    typeWarnings: [
      "Expensive valuation alone should not make this a hard Sell for a quality compounder.",
    ],
    typeLimitations: [],
  },

  platform_conglomerate: {
    overrides: {
      platform_sotp: {
        role: "primary", fit: "primary",
        reason: "SOTP is the right primary framework for mixed-margin platform segments.",
      },
      dcf_scenarios: {
        role: "secondary", fit: "partial",
        reason: "Consolidated FCFF DCF is too coarse for mixed-margin segments.",
        warnings: ["Do not let generic DCF dominate final rating for platform conglomerates."],
      },
      reverse_dcf: {
        role: "secondary", fit: "partial",
        reason: "Useful expectations check; segment mix can distort interpretation.",
      },
      relative_valuation: {
        role: "secondary", fit: "good",
        reason: "Peer multiples help triangulate; peer selection is difficult for conglomerates.",
      },
      quality_score: {
        role: "secondary", fit: "good",
        reason: "Quality matters but segment mix obscures the consolidated picture.",
      },
      risk_score: {
        role: "secondary", fit: "good",
        reason: "Risk assessment is relevant given operational and regulatory complexity.",
      },
    },
    typeWarnings: [
      "Generic consolidated DCF may be too coarse for mixed-margin segments.",
      "If segment data is missing, lower valuation confidence.",
    ],
    typeLimitations: [],
  },

  cyclical_hardware: {
    overrides: {
      cyclical_hardware_normalized: {
        role: "primary", fit: "primary",
        reason: "Normalized cycle earnings are more reliable than straight-line growth extrapolation.",
      },
      semiconductor_cycle: {
        role: "primary", fit: "primary",
        reason: "Semiconductor inventory cycle and structural demand analysis.",
      },
      relative_valuation: {
        role: "secondary", fit: "good",
        reason: "Through-cycle peer multiples are useful for hardware/capex-cycle businesses.",
      },
      dcf_scenarios: {
        role: "secondary", fit: "partial",
        reason: "DCF can overstate value without margin, inventory, and terminal-value stress.",
        warnings: ["Stress-test working capital, margins, and terminal value for cyclical hardware."],
      },
      reverse_dcf: {
        role: "secondary", fit: "partial",
        reason: "Expectations analysis useful but should be capped by cyclicality and execution risk.",
      },
      momentum_score: {
        role: "secondary", fit: "good",
        reason: "Momentum signals are especially relevant through hardware cycles.",
      },
      risk_score: {
        role: "secondary", fit: "good",
        reason: "Risk assessment is critical for inventory, leverage, and compliance exposure.",
      },
      balance_sheet_score: {
        role: "secondary", fit: "good",
        reason: "Working capital and inventory stress are important for cyclical hardware.",
      },
    },
    typeWarnings: [
      "DCF can overstate value if growth, margins, inventory, or terminal value are not stressed.",
      "Normalize working capital and inventory for cyclical hardware.",
    ],
    typeLimitations: [],
  },

  financial: {
    overrides: {
      bank_valuation: {
        role: "primary", fit: "primary",
        reason: "Banks should be valued with P/TBV, ROTCE, CET1, NIM, and credit metrics.",
      },
      insurance_underwriting: {
        role: "primary", fit: "primary",
        reason: "Insurers require combined ratio, investment yield, and reserve analysis.",
      },
      relative_valuation: {
        role: "secondary", fit: "good",
        reason: "P/E and P/TBV peer checks are useful external anchors.",
      },
      dcf_scenarios: {
        role: "disabled", fit: "poor",
        reason: "Industrial FCFF DCF is a poor fit for financial balance sheets.",
      },
      dcf_plausibility: {
        role: "diagnostic", fit: "partial",
        reason: "DCF plausibility check still surfaces useful diagnostics even when fit is poor.",
      },
      risk_score: {
        role: "secondary", fit: "good",
        reason: "Risk assessment is particularly important for financial leverage and credit risk.",
      },
      momentum_score: {
        role: "secondary", fit: "good",
        reason: "Price momentum provides timing context.",
      },
      revision_momentum: {
        role: "secondary", fit: "good",
        reason: "Analyst revisions reflect credit quality and rate outlook changes.",
      },
    },
    typeWarnings: [
      "Use P/TBV, ROTCE, CET1, NIM, efficiency ratio, and credit losses for banks.",
      "Generic FCFF DCF is a poor fit for financial balance sheets.",
    ],
    typeLimitations: [],
  },

  reit: {
    overrides: {
      reit_affo_nav: {
        role: "primary", fit: "primary",
        reason: "REIT valuation should center on NAV/AFFO and property economics.",
      },
      relative_valuation: {
        role: "secondary", fit: "good",
        reason: "AFFO multiple and yield spreads anchor relative valuation.",
      },
      dcf_scenarios: {
        role: "disabled", fit: "poor",
        reason: "Generic FCFF DCF is a poor fit for REITs; NAV/AFFO should dominate.",
      },
      risk_score: {
        role: "secondary", fit: "good",
        reason: "Interest rate sensitivity and refinancing risk are critical for REITs.",
      },
      momentum_score: {
        role: "secondary", fit: "good",
        reason: "Price momentum and dividend yield trends matter.",
      },
    },
    typeWarnings: [
      "Use AFFO, NAV, cap rates, occupancy, debt maturity, and payout ratio for REITs.",
      "Simple P/E and generic FCFF DCF should not dominate REIT valuation.",
    ],
    typeLimitations: [],
  },

  commodity_cyclical: {
    overrides: {
      commodity_energy_midcycle: {
        role: "primary", fit: "primary",
        reason: "Mid-cycle energy price normalization is required before valuing earnings power.",
      },
      commodity_mining_midcycle: {
        role: "primary", fit: "primary",
        reason: "Mid-cycle metals/materials pricing and cost curve analysis.",
      },
      relative_valuation: {
        role: "secondary", fit: "good",
        reason: "Through-cycle EV/EBITDA or FCF yield checks help avoid spot-price extrapolation.",
      },
      dcf_scenarios: {
        role: "secondary", fit: "partial",
        reason: "DCF is sensitive to commodity price assumptions; should not extrapolate peak cycle.",
        warnings: ["Normalize commodity prices; do not extrapolate peak-cycle cash flow."],
      },
      risk_score: {
        role: "secondary", fit: "good",
        reason: "Commodity price, reserve, and leverage risk are central.",
      },
      momentum_score: {
        role: "secondary", fit: "good",
        reason: "Commodity price and cycle momentum signals are relevant.",
      },
    },
    typeWarnings: [
      "Do not extrapolate peak commodity earnings linearly.",
      "Require mid-cycle price scenarios for commodity valuations.",
    ],
    typeLimitations: [],
  },

  hypergrowth_software: {
    overrides: {
      software_rule_of_40: {
        role: "primary", fit: "primary",
        reason: "Rule of 40 and ARR/NRR metrics are the primary growth/profitability framework.",
      },
      relative_valuation: {
        role: "secondary", fit: "good",
        reason: "EV/Sales and Rule-of-40 peer checks help triangulate.",
      },
      reverse_dcf: {
        role: "secondary", fit: "good",
        reason: "Expectations analysis is central when near-term FCF is immature.",
      },
      dcf_scenarios: {
        role: "secondary", fit: "partial",
        reason: "DCF needs long-duration margin assumptions; use only if FCF path is credible.",
        warnings: ["Only use DCF if FCF path is credible; keep confidence low."],
      },
      momentum_score: {
        role: "secondary", fit: "good",
        reason: "Growth deceleration and momentum signals are relevant.",
      },
      revision_momentum: {
        role: "secondary", fit: "good",
        reason: "Estimate revisions drive re-ratings in high-growth software.",
      },
    },
    typeWarnings: ["Watch SBC, ARR/NRR, FCF margin path, and growth deceleration."],
    typeLimitations: [],
  },

  industrial_cyclical: {
    overrides: {
      industrial_normalized_earnings: {
        role: "primary", fit: "primary",
        reason: "Order/backlog cycles and normalized margins should drive valuation.",
      },
      relative_valuation: {
        role: "secondary", fit: "good",
        reason: "Through-cycle P/E or EV/EBITDA peer checks are useful.",
      },
      dcf_scenarios: {
        role: "secondary", fit: "partial",
        reason: "DCF can work only with explicit downcycle margin and working-capital stress.",
      },
      risk_score: {
        role: "secondary", fit: "good",
        reason: "Cycle position, backlog, and leverage risk are important.",
      },
      momentum_score: {
        role: "secondary", fit: "good",
        reason: "Order cycle momentum and pricing power signals.",
      },
    },
    typeWarnings: ["Use normalized margins, orders, backlog, and cycle position."],
    typeLimitations: [],
  },

  unknown: {
    overrides: {
      relative_valuation: {
        role: "context", fit: "partial",
        reason: "External anchors can help when company type is unknown.",
      },
      quality_score: {
        role: "context", fit: "partial",
        reason: "Quality assessment provides baseline context.",
      },
      risk_score: {
        role: "context", fit: "partial",
        reason: "Risk assessment provides context.",
      },
      momentum_score: {
        role: "context", fit: "partial",
        reason: "Momentum provides timing context.",
      },
      dcf_scenarios: {
        role: "context", fit: "partial",
        reason: "DCF should remain low confidence until company type and core drivers are known.",
      },
    },
    typeWarnings: [
      "Company type is unknown; lower confidence and avoid hard Buy/Sell unless deterministic evidence is strong.",
    ],
    typeLimitations: [
      "Classification confidence is low; all model outputs should be treated with caution.",
    ],
  },
};

// ─── Input Availability Detection ─────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFiniteNumber(obj: AnyRecord, ...keys: string[]): boolean {
  return keys.some(key => {
    const v = obj[key];
    return typeof v === "number" && Number.isFinite(v) && v !== 0;
  });
}

function hasAnyValue(obj: AnyRecord, ...keys: string[]): boolean {
  return keys.some(key => obj[key] != null);
}

export function detectAvailableModelInputs(context: ModelInputAvailabilityContext): Set<string> {
  const available = new Set<string>();

  const fin = isRecord(context.financials) ? context.financials : {};
  const mkt = isRecord(context.marketData) ? context.marketData : {};
  const analyst = isRecord(context.analystData) ? context.analystData : {};
  const tech = isRecord(context.technicals) ? context.technicals : {};
  const profile = isRecord(context.companyProfile) ? context.companyProfile : {};
  const segs = context.segments;
  const outputs = context.existingOutputs ?? {};

  // Market data
  if (hasFiniteNumber(mkt, "price", "current_price") || hasFiniteNumber(fin, "price")) {
    available.add("current_price");
  }
  if (hasFiniteNumber(mkt, "market_cap", "marketCap") || hasFiniteNumber(fin, "market_cap")) {
    available.add("market_cap");
  }

  // Core income statement / FCF
  if (hasFiniteNumber(fin, "revenue", "totalRevenue")) available.add("revenue");
  if (hasFiniteNumber(fin, "ebit", "operatingIncome", "operating_income")) {
    available.add("ebit");
    available.add("operating_income");
  }
  if (hasFiniteNumber(fin, "netIncome", "net_income")) available.add("net_income");
  if (hasFiniteNumber(fin, "freeCashflow", "free_cashflow", "free_cash_flow", "fcf")) {
    available.add("free_cash_flow");
  }
  if (hasFiniteNumber(fin, "capitalExpenditures", "capex", "capital_expenditures")) {
    available.add("capex");
  }
  if (hasFiniteNumber(fin, "workingCapital", "working_capital")) available.add("working_capital");
  if (hasFiniteNumber(fin, "sharesOutstanding", "shares_outstanding")) {
    available.add("shares_outstanding");
  }

  // Balance sheet
  if (hasFiniteNumber(fin, "netDebt", "net_debt")) available.add("net_debt");
  if (hasFiniteNumber(fin, "cash", "cashAndEquivalents")) available.add("cash");
  if (hasFiniteNumber(fin, "totalDebt", "total_debt", "longTermDebt")) available.add("total_debt");

  // Margins and returns
  if (hasFiniteNumber(fin, "grossMargin", "gross_margin")) available.add("gross_margin");
  if (hasFiniteNumber(fin, "operatingMargin", "operating_margin")) available.add("operating_margin");
  if (hasFiniteNumber(fin, "fcfMargin", "fcf_margin")) available.add("fcf_margin");
  if (hasFiniteNumber(fin, "roe", "returnOnEquity")) available.add("roe");
  if (hasFiniteNumber(fin, "roic", "returnOnInvestedCapital")) available.add("roic");

  // Growth
  if (hasFiniteNumber(fin, "revenueGrowth", "revenue_growth")) available.add("revenue_growth");
  if (hasFiniteNumber(fin, "epsGrowth", "eps_growth")) available.add("eps_growth");

  // Analyst / consensus data
  if (hasAnyValue(analyst, "consensus", "recommendation", "targetPrice", "target_price")) {
    available.add("analyst_consensus");
  }
  if (hasAnyValue(analyst, "estimates", "eps_estimates", "revenue_estimates")) {
    available.add("analyst_estimates");
  }
  if (hasAnyValue(analyst, "revisions", "estimate_revisions", "eps_revisions")) {
    available.add("estimate_revisions");
  }

  // Technical indicators
  if (hasAnyValue(tech, "rsi", "RSI")) available.add("technical_indicators");
  if (
    hasAnyValue(tech, "price", "prices", "history", "close") ||
    hasAnyValue(mkt, "priceHistory", "price_history", "historicalData")
  ) {
    available.add("price_history");
  }

  // Profile / sector
  if (hasAnyValue(profile, "sector", "industry")) {
    available.add("sector");
    available.add("industry");
  }

  // Segments
  if (Array.isArray(segs) && segs.length >= 2) {
    available.add("segments");
    const segArr = segs as unknown[];
    if (segArr.some(s => isRecord(s) && hasFiniteNumber(s, "revenue", "revenuePct"))) {
      available.add("segment_revenue");
    }
    if (segArr.some(s => isRecord(s) && hasFiniteNumber(s, "operatingMargin", "operating_margin"))) {
      available.add("segment_operating_income");
    }
  } else if (isRecord(segs) && hasAnyValue(segs, "segments", "breakdown")) {
    available.add("segments");
  }

  // REIT-specific
  if (hasAnyValue(fin, "affo", "adjustedFundsFromOperations")) available.add("affo");
  if (hasAnyValue(fin, "nav", "netAssetValue")) available.add("nav");
  if (hasAnyValue(fin, "occupancy", "occupancyRate")) available.add("occupancy");
  if (hasAnyValue(fin, "sameStoreNoi", "same_store_noi")) available.add("same_store_noi");
  if (hasAnyValue(fin, "capRate", "cap_rates", "capRates")) available.add("cap_rates");

  // Bank-specific
  if (hasAnyValue(fin, "cet1", "tier1CapitalRatio")) available.add("cet1");
  if (hasAnyValue(fin, "nim", "netInterestMargin")) available.add("nim");
  if (hasAnyValue(fin, "rotce", "returnOnTangibleCommonEquity")) available.add("rotce");
  if (hasAnyValue(fin, "ptbv", "priceToTangibleBookValue")) available.add("ptbv");
  if (hasAnyValue(fin, "loanLosses", "loan_losses", "creditLosses")) available.add("loan_losses");
  if (hasAnyValue(fin, "efficiencyRatio", "efficiency_ratio")) available.add("efficiency_ratio");

  // Commodity-specific
  if (hasAnyValue(fin, "oilPrice", "oil_price")) available.add("oil_price");
  if (hasAnyValue(fin, "gasPrice", "gas_price")) available.add("gas_price");
  if (hasAnyValue(fin, "productionVolume", "production_volume")) available.add("production_volume");
  if (hasAnyValue(fin, "reserves")) available.add("reserves");
  if (hasAnyValue(fin, "commodityScenarios", "commodity_scenarios")) available.add("commodity_scenarios");

  // SaaS-specific
  if (hasAnyValue(fin, "arr", "annualRecurringRevenue")) available.add("arr");
  if (hasAnyValue(fin, "nrr", "netRevenueRetention")) available.add("nrr");
  if (hasAnyValue(fin, "sbc", "stockBasedCompensation", "stock_based_compensation")) {
    available.add("sbc");
  }
  if (hasAnyValue(fin, "ruleOf40", "rule_of_40")) available.add("rule_of_40");

  // Mark existing outputs
  for (const [id, value] of Object.entries(outputs)) {
    if (value != null) available.add(`output:${id}`);
  }

  return available;
}

// ─── Model Selector Helpers ───────────────────────────────────────────────────

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function isApplicable(entry: AnalysisModelRegistryEntry, companyType: CompanyType): boolean {
  if (entry.notApplicableCompanyTypes?.includes(companyType)) return false;
  return entry.applicableCompanyTypes.includes(companyType);
}

function isNotApplicable(entry: AnalysisModelRegistryEntry, companyType: CompanyType): boolean {
  if (entry.notApplicableCompanyTypes?.includes(companyType)) return true;
  if (!entry.applicableCompanyTypes.includes(companyType) && !entry.weakCompanyTypes?.includes(companyType)) {
    return true;
  }
  return false;
}

function resolveRoleAndFit(
  entry: AnalysisModelRegistryEntry,
  companyType: CompanyType,
  typeConfig: TypeConfig | undefined,
): { role: AnalysisModelRole; fit: AnalysisModelFit; reason: string; extraWarnings: string[] } {
  const override = typeConfig?.overrides[entry.id];
  if (override) {
    return {
      role: override.role,
      fit: override.fit,
      reason: override.reason,
      extraWarnings: override.warnings ?? [],
    };
  }

  if (entry.weakCompanyTypes?.includes(companyType)) {
    const weakRole: AnalysisModelRole =
      entry.defaultRole === "primary" ? "secondary" :
      entry.defaultRole === "secondary" ? "context" :
      entry.defaultRole;
    const weakFit: AnalysisModelFit =
      entry.defaultFit === "primary" ? "good" :
      entry.defaultFit === "good" ? "partial" :
      entry.defaultFit;
    return {
      role: weakRole,
      fit: weakFit,
      reason: `${entry.label} is a weaker fit for this company type.`,
      extraWarnings: [],
    };
  }

  return {
    role: entry.defaultRole,
    fit: entry.defaultFit,
    reason: `${entry.label} applies to this company type with default role and fit.`,
    extraWarnings: [],
  };
}

function computeInputSets(
  entry: AnalysisModelRegistryEntry,
  availableInputs: Set<string>,
): { availableInputs: string[]; missingInputs: string[] } {
  const avail = entry.requiredInputs.filter(k => availableInputs.has(k));
  const missing = entry.requiredInputs.filter(k => !availableInputs.has(k));
  return { availableInputs: avail, missingInputs: missing };
}

function computeRunStatus(
  entry: AnalysisModelRegistryEntry,
  role: AnalysisModelRole,
  missingInputs: string[],
  existingOutputs: Partial<Record<AnalysisModelId, unknown>>,
): AnalysisModelRunStatus {
  if (role === "disabled") return "disabled_by_company_type";

  if (existingOutputs[entry.id] != null) return "already_available";

  if (entry.implementationStatus === "planned" || entry.implementationStatus === "not_applicable") {
    return "not_run_not_implemented";
  }

  if (missingInputs.length > 0) return "not_run_missing_inputs";

  return "should_run";
}

function buildLimitations(
  entry: AnalysisModelRegistryEntry,
  runStatus: AnalysisModelRunStatus,
  missingInputs: string[],
): string[] {
  const limitations: string[] = [];
  if (runStatus === "not_run_not_implemented") {
    limitations.push(`${entry.label} is not yet implemented; outputs are unavailable.`);
  }
  if (runStatus === "not_run_missing_inputs" || (runStatus === "not_run_not_implemented" && missingInputs.length > 0)) {
    limitations.push(`Missing required inputs: ${missingInputs.join(", ")}.`);
  }
  if (runStatus === "disabled_by_company_type") {
    limitations.push(`${entry.label} is disabled for this company type.`);
  }
  return limitations;
}

// ─── Main Selector ────────────────────────────────────────────────────────────

export function buildModelSelectionPlan(input: ModelSelectionPlanInput): ModelSelectionPlan {
  const { companyType, sector, industry, availableInputs } = input;
  const primaryType = companyType.primaryType;
  const typeConfig = TYPE_CONFIG[primaryType];
  const existingOutputs = input.existingOutputs ?? {};

  const models: SelectedAnalysisModel[] = [];
  const allWarnings: string[] = [...(typeConfig?.typeWarnings ?? [])];
  const allLimitations: string[] = [...(typeConfig?.typeLimitations ?? [])];

  for (const entry of MODEL_REGISTRY) {
    const notApplicable = isNotApplicable(entry, primaryType);
    const applicable = isApplicable(entry, primaryType);

    if (!applicable && !notApplicable) continue;

    if (notApplicable) {
      models.push({
        id: entry.id,
        role: "disabled",
        fit: "poor",
        runStatus: "not_run_not_applicable",
        implementationStatus: entry.implementationStatus,
        reason: `${entry.label} is not applicable for ${primaryType} company type.`,
        requiredInputs: entry.requiredInputs,
        optionalInputs: entry.optionalInputs,
        availableInputs: [],
        missingInputs: entry.requiredInputs,
        warnings: entry.warnings ?? [],
        limitations: [`${entry.label} does not apply to ${primaryType}.`],
      });
      continue;
    }

    const { role, fit, reason, extraWarnings } = resolveRoleAndFit(entry, primaryType, typeConfig);
    const { availableInputs: avail, missingInputs } = computeInputSets(entry, availableInputs);
    const runStatus = computeRunStatus(entry, role, missingInputs, existingOutputs);
    const limitations = buildLimitations(entry, runStatus, missingInputs);
    const warnings = unique([...(entry.warnings ?? []), ...extraWarnings]);

    models.push({
      id: entry.id,
      role,
      fit,
      runStatus,
      implementationStatus: entry.implementationStatus,
      reason,
      requiredInputs: entry.requiredInputs,
      optionalInputs: entry.optionalInputs,
      availableInputs: avail,
      missingInputs,
      warnings,
      limitations,
    });
  }

  const activeModels = models.filter(m => m.runStatus !== "not_run_not_applicable");

  const primaryModels = activeModels.filter(
    m => m.role === "primary" &&
      m.runStatus !== "disabled_by_company_type" &&
      m.runStatus !== "not_run_not_applicable",
  );
  const secondaryModels = activeModels.filter(m => m.role === "secondary");
  const diagnosticModels = activeModels.filter(m => m.role === "diagnostic");
  const contextModels = activeModels.filter(m => m.role === "context");
  const disabledModels = models.filter(
    m => m.role === "disabled" || m.runStatus === "disabled_by_company_type" || m.runStatus === "not_run_not_applicable",
  );
  const missingButRecommendedModels = activeModels.filter(
    m =>
      m.runStatus === "not_run_not_implemented" &&
      (m.fit === "primary" || m.fit === "good") &&
      m.role !== "disabled" &&
      m.role !== "context",
  );

  if (companyType.confidence <= 2) {
    allWarnings.push("Company type confidence is low; treat all model recommendations with caution.");
    allLimitations.push("Low classification confidence reduces reliability of model selection.");
  }

  return {
    companyType,
    sector,
    industry,
    models,
    primaryModels,
    secondaryModels,
    diagnosticModels,
    contextModels,
    disabledModels,
    missingButRecommendedModels,
    warnings: unique(allWarnings),
    limitations: unique(allLimitations),
  };
}

// ─── Synthesis Summary ────────────────────────────────────────────────────────

export function summarizeModelSelectionForSynthesis(plan: ModelSelectionPlan): ModelSelectionSummary {
  const primaryModels = plan.primaryModels
    .filter(m => m.runStatus === "should_run" || m.runStatus === "already_available")
    .map(m => m.id);

  const secondaryModels = plan.secondaryModels
    .filter(m => m.runStatus === "should_run" || m.runStatus === "already_available")
    .map(m => m.id);

  const weakOrDisabledModels = plan.disabledModels.map(m => m.id);

  const missingButRecommendedModels = plan.missingButRecommendedModels.map(m => m.id);

  const warnings = unique([
    ...plan.warnings,
    ...plan.primaryModels.flatMap(m => m.warnings),
    ...plan.missingButRecommendedModels.map(m => `${m.id} is recommended but not yet implemented.`),
  ]);

  const limitations = unique([
    ...plan.limitations,
    ...plan.primaryModels.flatMap(m => m.limitations),
    ...plan.missingButRecommendedModels.flatMap(m => m.limitations),
  ]);

  return {
    primaryModels,
    secondaryModels,
    weakOrDisabledModels,
    missingButRecommendedModels,
    warnings,
    limitations,
  };
}
