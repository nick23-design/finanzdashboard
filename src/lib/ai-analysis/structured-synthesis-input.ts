import type { CompanyTypeClassification } from "./company-type-router";
import {
  summarizeModelSelectionForSynthesis,
  type ModelSelectionPlan,
  type ModelSelectionSummary,
} from "./model-selector";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SectorFamily =
  | "technology_platform"
  | "quality_compounder"
  | "cyclical_hardware"
  | "semiconductors"
  | "software_saas"
  | "financial_bank"
  | "financial_insurance"
  | "reit"
  | "commodity_energy"
  | "commodity_mining"
  | "industrial_cyclical"
  | "healthcare_pharma"
  | "healthcare_medtech"
  | "consumer_staples"
  | "consumer_discretionary"
  | "telecom"
  | "utilities"
  | "transportation_logistics"
  | "unknown";

export type SectorSynthesisBrief = {
  sectorFamily: SectorFamily;
  primaryValuationLogic: string[];
  weakValuationMethods: string[];
  growthDrivers: string[];
  marginDrivers: string[];
  cashFlowDrivers: string[];
  balanceSheetDrivers: string[];
  riskDrivers: string[];
  keyMetricsToWatch: string[];
  bullishTriggers: string[];
  bearishTriggers: string[];
  requiredDisclosures: string[];
  synthesisWarnings: string[];
};

export type StructuredSynthesisInput = {
  ticker: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  currentPrice?: number;

  companyType: CompanyTypeClassification | null;

  modelSelectionSummary: ModelSelectionSummary;

  sectorBrief: SectorSynthesisBrief;

  valuation?: {
    analystConsensus?: string | null;
    ownModel?: string | null;
    dcf?: string | null;
    divergenceStatus?: string | null;
  } | null;

  alphaFramework?: {
    alphaScore?: number | null;
    qualityScore?: number | null;
    moatScore?: number | null;
    riskScore?: number | null;
  } | null;

  confidence?: {
    dataConfidence?: number | null;
    valuationConfidence?: number | null;
    finalRatingConfidence?: number | null;
  } | null;

  guardrailsTriggered: string[];

  thesisChangeTriggers?: {
    bullishTriggers: string[];
    bearishTriggers: string[];
    keyMetricsToWatch: string[];
  };

  limitations: string[];
  synthesisInstructions: string[];
};

export type StructuredSynthesisInputParams = {
  ticker: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  currentPrice?: number;

  companyType: CompanyTypeClassification | null | undefined;
  modelSelectionPlan: ModelSelectionPlan | null | undefined;

  valuation?: StructuredSynthesisInput["valuation"];
  alphaFramework?: StructuredSynthesisInput["alphaFramework"];
  confidence?: StructuredSynthesisInput["confidence"];

  guardrailsTriggered?: string[];
  thesisChangeTriggers?: {
    bullishTriggers?: string[];
    bearishTriggers?: string[];
    keyMetricsToWatch?: string[];
  } | null;

  limitations?: string[];
};

// ─── Sector Family Inference ──────────────────────────────────────────────────

function lower(s: string | null | undefined): string {
  return typeof s === "string" ? s.toLowerCase() : "";
}

function hasAny(text: string, tokens: string[]): boolean {
  return tokens.some(t => text.includes(t));
}

function extractPrimaryType(companyType: CompanyTypeClassification | null | undefined): string {
  if (!companyType) return "";
  return companyType.primaryType ?? "";
}

export function inferSectorFamily(input: {
  companyType?: CompanyTypeClassification | null | undefined;
  sector?: string | null;
  industry?: string | null;
}): SectorFamily {
  const primaryType = extractPrimaryType(input.companyType);
  const sector = lower(input.sector);
  const industry = lower(input.industry);
  const combined = `${sector} ${industry}`;

  // Financial — split bank vs insurance first
  if (primaryType === "financial" || hasAny(combined, ["bank", "banking", "savings", "capital markets", "brokerage", "investment bank"])) {
    if (hasAny(combined, ["insurance", "property casualty", "life insurance", "reinsurance", "underwriting"])) {
      return "financial_insurance";
    }
    return "financial_bank";
  }
  // Insurance without "financial" primaryType
  if (hasAny(combined, ["insurance", "property casualty", "life insurance", "reinsurance"])) {
    return "financial_insurance";
  }

  // REIT
  if (primaryType === "reit" || hasAny(combined, ["reit", "real estate investment trust", "industrial reit", "retail reit", "residential reit", "office reit", "data center reit"])) {
    return "reit";
  }

  // Platform conglomerate
  if (primaryType === "platform_conglomerate" || hasAny(combined, ["marketplace", "cloud platform", "digital advertising", "internet retail", "internet content", "mega-cap platform"])) {
    return "technology_platform";
  }

  // Commodity — energy vs mining
  if (primaryType === "commodity_cyclical") {
    if (hasAny(combined, ["oil", "gas", "energy", "exploration", "production", "refining", "lng", "upstream", "integrated oil"])) {
      return "commodity_energy";
    }
    if (hasAny(combined, ["mining", "metals", "copper", "gold", "silver", "steel", "aluminum", "coal", "materials", "chemicals"])) {
      return "commodity_mining";
    }
    // If no sub-type signal, default to energy (more common mapping)
    return "commodity_energy";
  }
  if (hasAny(combined, ["oil", "gas", "integrated oil", "exploration & production", "lng terminal"])) {
    return "commodity_energy";
  }
  if (hasAny(combined, ["mining", "gold mine", "copper mine", "diversified metals"])) {
    return "commodity_mining";
  }

  // Semiconductors (check before cyclical_hardware)
  if (hasAny(combined, ["semiconductor", "chip", "memory", "analog chip", "foundry", "wafer", "integrated circuit", "gpu", "processor"])) {
    return "semiconductors";
  }

  // Cyclical hardware
  if (primaryType === "cyclical_hardware" || hasAny(combined, ["computer hardware", "server hardware", "ai server", "ai infrastructure", "data center hardware", "electronics manufacturing", "hardware manufacturer"])) {
    return "cyclical_hardware";
  }

  // Software SaaS
  if (primaryType === "hypergrowth_software" || hasAny(combined, ["saas", "application software", "cloud software", "enterprise software", "software as a service"])) {
    return "software_saas";
  }

  // Quality compounder
  if (primaryType === "quality_compounder") {
    // Try to sub-classify quality compounders
    if (hasAny(combined, ["consumer electronics", "consumer technology", "consumer hardware"])) {
      return "quality_compounder";
    }
    if (hasAny(combined, ["software", "cloud", "internet", "platform"])) {
      return "technology_platform";
    }
    if (hasAny(combined, ["consumer staples", "food", "beverage", "household"])) {
      return "consumer_staples";
    }
    return "quality_compounder";
  }

  // Healthcare
  if (hasAny(combined, ["pharmaceutical", "biotech", "drug manufacturer", "drug discovery", "biopharmaceutical"])) {
    return "healthcare_pharma";
  }
  if (hasAny(combined, ["medical device", "medtech", "diagnostic", "life science tool", "medical instrument", "healthcare equipment"])) {
    return "healthcare_medtech";
  }

  // Utilities
  if (hasAny(sector, ["utilities", "electric utility", "regulated utility", "water utility", "gas utility"])) {
    return "utilities";
  }

  // Telecom
  if (hasAny(combined, ["telecom", "wireless", "broadband", "communications carrier", "cable", "5g", "fiber"])) {
    return "telecom";
  }

  // Transportation & logistics
  if (hasAny(combined, ["logistics", "freight", "railroad", "airline", "shipping", "parcel delivery", "trucking", "transportation", "courier"])) {
    return "transportation_logistics";
  }

  // Industrial cyclical
  if (primaryType === "industrial_cyclical" || hasAny(combined, ["industrials", "machinery", "aerospace", "defense", "construction equipment", "capital goods", "manufacturing"])) {
    return "industrial_cyclical";
  }

  // Consumer staples — check before income fallback
  if (hasAny(combined, ["consumer staples", "food", "beverage", "household products", "tobacco", "personal care"])) {
    return "consumer_staples";
  }

  // Consumer discretionary — check before income fallback
  if (hasAny(combined, ["consumer discretionary", "retail", "apparel", "restaurants", "travel", "leisure", "autos", "automotive"])) {
    return "consumer_discretionary";
  }

  // Income/defensive fallbacks
  if (primaryType === "income") {
    return "utilities"; // default income mapping to utilities
  }

  return "unknown";
}

// ─── Sector Brief Builders ────────────────────────────────────────────────────

function brief(
  sectorFamily: SectorFamily,
  fields: Omit<SectorSynthesisBrief, "sectorFamily">,
): SectorSynthesisBrief {
  return { sectorFamily, ...fields };
}

const SECTOR_BRIEFS: Record<SectorFamily, SectorSynthesisBrief> = {
  financial_bank: brief("financial_bank", {
    primaryValuationLogic: [
      "P/TBV (Price-to-Tangible Book Value)",
      "ROTCE (Return on Tangible Common Equity)",
      "CET1 capital strength and regulatory buffer",
      "NIM (Net Interest Margin) and deposit cost trends",
      "Credit quality and loan loss provisions",
      "Efficiency ratio",
    ],
    weakValuationMethods: [
      "Generic FCFF DCF — industrial cash flow model does not fit bank balance sheets",
    ],
    growthDrivers: [
      "Net interest income expansion from rate environment",
      "Loan growth in target segments",
      "Fee income and capital markets activity",
      "Wealth management and advisory flows",
      "Operating leverage as expense growth trails revenue",
    ],
    marginDrivers: [
      "NIM trends vs deposit beta",
      "Efficiency ratio improvement",
      "Credit loss normalization",
      "Non-interest income mix improvement",
    ],
    cashFlowDrivers: [
      "Capital return through dividends and buybacks",
      "CET1 optimization and RWA management",
      "PPNR (pre-provision net revenue) growth",
    ],
    balanceSheetDrivers: [
      "CET1 capital ratio vs peer and regulatory minimum",
      "Loan-to-deposit ratio",
      "Allowance for credit losses vs NPL ratio",
      "Commercial real estate exposure",
    ],
    riskDrivers: [
      "Credit losses and loan impairment",
      "Rising deposit costs compressing NIM",
      "Regulatory capital requirements",
      "Commercial real estate stress",
      "Yield curve pressure",
      "Funding cost risk",
    ],
    keyMetricsToWatch: [
      "CET1 ratio",
      "ROTCE",
      "P/TBV",
      "NIM",
      "Efficiency ratio",
      "Loan loss provisions",
      "Deposit trends",
    ],
    bullishTriggers: [
      "NIM expands with controlled deposit costs",
      "Credit quality improves vs expectations",
      "Capital return accelerates via buyback",
      "Fee income diversifies away from rate-sensitive NII",
    ],
    bearishTriggers: [
      "Credit losses rise faster than provisioned",
      "Capital ratio weakens below comfort zone",
      "NIM compression accelerates materially",
      "CRE losses materialize at scale",
    ],
    requiredDisclosures: [
      "Generic FCFF DCF should not dominate bank valuation — use P/TBV, ROTCE, CET1, and NIM instead.",
    ],
    synthesisWarnings: [
      "If CET1/ROTCE/P/TBV data is missing, flag as a data limitation, not as a firm valuation signal.",
    ],
  }),

  reit: brief("reit", {
    primaryValuationLogic: [
      "AFFO (Adjusted Funds From Operations) per share",
      "NAV (Net Asset Value) per share",
      "Cap-rate spread vs risk-free rate",
      "Occupancy rate and lease duration",
      "Debt maturity schedule and refinancing risk",
      "AFFO payout ratio and dividend coverage",
    ],
    weakValuationMethods: [
      "Generic FCFF DCF — D&A distorts REIT cash flows",
      "Simple P/E without AFFO adjustment",
    ],
    growthDrivers: [
      "Same-store NOI growth from rent escalation",
      "Occupancy improvement toward stabilized targets",
      "Rent spreads on lease renewals and new leases",
      "Development pipeline yield on cost",
      "Accretive acquisitions or capital recycling",
    ],
    marginDrivers: [
      "Operating leverage on fixed property costs",
      "Rent escalation clauses (CPI-linked or fixed bumps)",
      "Cap rate compression in target markets",
    ],
    cashFlowDrivers: [
      "AFFO generation and coverage of distribution",
      "Development yield converting to income",
      "Capital recycling at attractive spread",
    ],
    balanceSheetDrivers: [
      "Net debt to EBITDA or net debt to total assets",
      "Debt maturity ladder profile",
      "Fixed vs floating rate mix",
      "Unencumbered asset pool for liquidity",
    ],
    riskDrivers: [
      "Interest rate rise and cap-rate expansion reducing NAV",
      "Refinancing risk in a higher-rate environment",
      "Tenant weakness or vacancy creep",
      "AFFO payout ratio approaching 100%",
      "Debt maturities in adverse credit markets",
    ],
    keyMetricsToWatch: [
      "AFFO per share",
      "AFFO payout ratio",
      "NAV per share",
      "Occupancy rate",
      "Same-store NOI growth",
      "Cap rates in core markets",
      "Debt maturity profile",
    ],
    bullishTriggers: [
      "Same-store NOI growth accelerates above CPI",
      "Cap rates stabilize or compress supporting NAV",
      "Occupancy reaches or sustains target levels",
      "Development pipeline converts at yields above cost of capital",
    ],
    bearishTriggers: [
      "Cap-rate expansion reduces NAV materially",
      "Refinancing costs rise compressing AFFO",
      "Occupancy declines materially below trend",
      "AFFO payout exceeds 100% or dividend is cut",
    ],
    requiredDisclosures: [
      "If AFFO/NAV data is missing, valuation confidence should be limited — generic DCF is a poor fit for REITs.",
    ],
    synthesisWarnings: [
      "Do not use simple P/E or generic FCFF DCF as primary valuation for REITs. AFFO and NAV are the correct primary frameworks.",
    ],
  }),

  commodity_energy: brief("commodity_energy", {
    primaryValuationLogic: [
      "Mid-cycle FCF at normalized oil/gas prices (not spot)",
      "EV/EBITDA through-cycle multiples",
      "Commodity price scenario analysis (bear/base/bull)",
      "Reserve/production outlook and reserve replacement",
      "Dividend and buyback coverage at mid-cycle prices",
    ],
    weakValuationMethods: [
      "Simple DCF extrapolating current spot commodity prices",
      "Peak-cycle P/E without price normalization",
    ],
    growthDrivers: [
      "Production volume growth from existing and new projects",
      "LNG or upstream project sanctioning",
      "Shale or unconventional resource development",
      "Refining margin improvement and utilization",
      "Cost discipline and efficiency gains",
    ],
    marginDrivers: [
      "Oil/gas price realization vs benchmark",
      "Lifting costs and development cost control",
      "Refining crack spread and utilization",
      "Hedging program effectiveness",
    ],
    cashFlowDrivers: [
      "FCF at mid-cycle commodity prices",
      "Dividend and buyback coverage at multiple price scenarios",
      "Capex discipline and capital allocation quality",
    ],
    balanceSheetDrivers: [
      "Net debt and leverage ratio",
      "Breakeven oil/gas price for dividend coverage",
      "Reserve replacement ratio and reserve life",
      "Capex vs operating cash flow balance",
    ],
    riskDrivers: [
      "Oil/gas price decline below mid-cycle",
      "Capex inflation eroding FCF",
      "Reserve replacement shortfall",
      "Regulatory and carbon transition policy risk",
      "Downstream margin compression",
    ],
    keyMetricsToWatch: [
      "Brent/WTI price scenario assumptions",
      "Production volumes and growth",
      "Capex plan",
      "FCF after capex at various price decks",
      "Dividend coverage ratio",
      "Buyback coverage at mid-cycle",
      "Net debt",
    ],
    bullishTriggers: [
      "Production grows with controlled lifting costs",
      "Commodity price stays above mid-cycle assumptions",
      "FCF enables accelerated capital return",
      "Reserve replacement exceeds depletion",
    ],
    bearishTriggers: [
      "Commodity prices fall below mid-cycle",
      "Reserve replacement declines materially",
      "Capex inflation erodes FCF materially",
      "Regulatory pressure restricts operations",
    ],
    requiredDisclosures: [
      "Do not extrapolate peak commodity earnings linearly — use normalized mid-cycle price scenarios.",
    ],
    synthesisWarnings: [
      "Valuation requires explicit commodity price scenarios. Without them, flag as a significant data limitation.",
      "Spot-price DCF systematically overstates value at cycle peaks and understates at cycle troughs.",
    ],
  }),

  technology_platform: brief("technology_platform", {
    primaryValuationLogic: [
      "Segment/SOTP valuation for materially different business lines",
      "DCF only as partial fit when segment economics differ",
      "Reverse DCF to expose expectations embedded in price",
      "Relative valuation vs platform and hyperscaler peers",
      "AI monetization optionality premium assessment",
    ],
    weakValuationMethods: [
      "Generic consolidated DCF when segment margins differ materially between business lines",
    ],
    growthDrivers: [
      "Cloud/infrastructure segment growth and backlog",
      "Advertising revenue growth and margin",
      "Marketplace and platform monetization improvements",
      "AI product and service monetization",
      "Subscription and enterprise segment expansion",
      "Operating leverage in high-margin segments",
    ],
    marginDrivers: [
      "High-margin segment mix shift (cloud, ads, software)",
      "AI compute cost efficiency and margin trajectory",
      "Platform network effect scaling",
      "Operating leverage on fixed cost base",
    ],
    cashFlowDrivers: [
      "FCF conversion from high-margin segments",
      "AI infrastructure investment monetization timeline",
      "Capex to FCF conversion ratio",
    ],
    balanceSheetDrivers: [
      "Capex intensity relative to revenue and FCF",
      "Net cash or net debt position",
      "Buyback capacity and historical execution",
    ],
    riskDrivers: [
      "AI capex intensity without clear ROI timeline",
      "Regulatory and antitrust pressure on core platforms",
      "Competitive displacement in high-margin segments",
      "Segment margin compression",
      "FCF conversion risk if capex exceeds cash generation",
    ],
    keyMetricsToWatch: [
      "Segment revenue and revenue growth by segment",
      "Segment operating income and margin",
      "Cloud backlog or RPO if available",
      "Advertising revenue growth",
      "Capex as % of revenue",
      "FCF conversion from EBITDA",
    ],
    bullishTriggers: [
      "High-margin segments outgrow low-margin segments",
      "AI monetization accelerates and converts capex to FCF",
      "SOTP sum validates or exceeds market cap",
      "Operating leverage drives margin expansion in key segments",
    ],
    bearishTriggers: [
      "Cloud or advertising growth decelerates materially",
      "Regulatory action limits core monetization",
      "Capex exceeds FCF without visible return timeline",
      "Segment margin compression across multiple lines",
    ],
    requiredDisclosures: [
      "If segment data is missing, generic consolidated DCF is only a partial fit — flag as a modeling limitation.",
    ],
    synthesisWarnings: [
      "Do not use generic consolidated DCF as primary valuation when segment margins differ materially.",
      "SOTP is the preferred framework; if segment data is unavailable, reduce valuation confidence.",
    ],
  }),

  quality_compounder: brief("quality_compounder", {
    primaryValuationLogic: [
      "DCF with conservative but durable growth assumptions",
      "Reverse DCF to expose implied market expectations",
      "Relative valuation vs peers and historical own multiples",
      "Capital allocation efficiency and buyback yield",
      "Moat durability and pricing power assessment",
    ],
    weakValuationMethods: [
      "Peak multiple extrapolation without quality/moat validation",
    ],
    growthDrivers: [
      "Installed base monetization and cross-sell",
      "Pricing power from brand strength and switching costs",
      "Services or recurring revenue mix shift",
      "Product refresh and innovation cycle",
      "International or adjacent market expansion",
      "Customer retention and lifetime value",
    ],
    marginDrivers: [
      "Operating leverage on fixed cost base",
      "Premium brand pricing power",
      "Services mix improving gross margins structurally",
      "Operational efficiency and cost discipline",
    ],
    cashFlowDrivers: [
      "High FCF conversion from earnings",
      "Buyback effectiveness in creating per-share value",
      "Dividend growth supported by FCF growth",
      "Capital allocation discipline (M&A returns)",
    ],
    balanceSheetDrivers: [
      "Balance sheet strength and net cash/debt",
      "Debt management relative to FCF coverage",
      "Working capital efficiency",
    ],
    riskDrivers: [
      "Valuation premium compression at high multiples",
      "Regulatory and antitrust pressure",
      "Market saturation in core markets",
      "Product cycle weakness or disruption",
      "Moat erosion from technology substitution",
      "Margin pressure from competition or input costs",
    ],
    keyMetricsToWatch: [
      "ROIC trend over multiple periods",
      "FCF margin and FCF conversion",
      "Gross and operating margin stability",
      "Buyback effectiveness and yield",
      "Revenue mix and services/recurring share",
      "Customer retention metrics if available",
    ],
    bullishTriggers: [
      "ROIC and FCF compound above market expectations",
      "Moat durability improves through pricing power or ecosystem lock-in",
      "Buybacks create visible per-share value without balance sheet deterioration",
    ],
    bearishTriggers: [
      "ROIC trend deteriorates for multiple consecutive periods",
      "Moat or pricing power weakens structurally",
      "Regulatory or platform risk begins to pressure margins or growth",
    ],
    requiredDisclosures: [
      "Expensive valuation alone should not automatically become Sell for a quality compounder — premium reflects moat and compounding durability.",
    ],
    synthesisWarnings: [
      "Separate business quality deterioration from valuation premium compression in your analysis.",
    ],
  }),

  cyclical_hardware: brief("cyclical_hardware", {
    primaryValuationLogic: [
      "Normalized through-cycle earnings",
      "Relative valuation through-cycle vs peers",
      "Stress-case DCF with working capital and margin normalization",
      "Working-capital-aware FCF analysis including inventory cycles",
    ],
    weakValuationMethods: [
      "Aggressive long-term DCF without cycle stress or terminal value sensitivity",
    ],
    growthDrivers: [
      "AI infrastructure capex cycle and hyperscaler demand",
      "Order backlog and demand visibility",
      "Market share gains in high-growth segments",
      "Supply availability and lead time normalization",
    ],
    marginDrivers: [
      "Gross margin through the cycle and at trough",
      "ASP (average selling price) and product mix",
      "Inventory management and working capital discipline",
      "Supply chain cost control",
    ],
    cashFlowDrivers: [
      "FCF conversion through the cycle including working capital normalization",
      "Capex discipline vs growth investment",
      "Debt management and balance sheet",
    ],
    balanceSheetDrivers: [
      "Inventory levels relative to revenue",
      "Cash conversion cycle",
      "Debt-to-equity and leverage through cycle",
      "Working capital as % of revenue",
    ],
    riskDrivers: [
      "Gross margin compression from ASP pressure or cost inflation",
      "Inventory build and working capital absorption",
      "Customer concentration risk",
      "Accounting or compliance risk factors",
      "Cyclical revenue deceleration",
      "DCF terminal value sensitivity at cycle trough",
    ],
    keyMetricsToWatch: [
      "Gross margin trend",
      "Inventory-to-revenue ratio",
      "FCF conversion ratio",
      "Order backlog",
      "Net debt",
      "Customer concentration metrics",
      "Working capital cycle",
    ],
    bullishTriggers: [
      "Gross margin expands while inventory stays controlled",
      "Customer concentration declines toward diversified base",
      "FCF conversion improves through cycle",
    ],
    bearishTriggers: [
      "Inventory builds faster than revenue",
      "Gross margin normalizes below through-cycle expectations",
      "Accounting, compliance, or governance risk materializes",
    ],
    requiredDisclosures: [
      "DCF upside should be treated with caution if driven by aggressive growth assumptions or terminal value — normalize cycle margins first.",
    ],
    synthesisWarnings: [
      "Do not extrapolate peak-cycle margins linearly in DCF.",
      "Working capital and inventory stress are required for credible cyclical hardware valuation.",
    ],
  }),

  semiconductors: brief("semiconductors", {
    primaryValuationLogic: [
      "Through-cycle normalized earnings",
      "EV/Sales with semiconductor premium relative to cycle position",
      "AI/compute structural growth vs inventory cycle overlay",
      "Relative valuation vs cycle leaders",
    ],
    weakValuationMethods: [
      "Peak-cycle P/E without inventory cycle normalization",
    ],
    growthDrivers: [
      "AI and data center compute demand",
      "Automotive semiconductor content per vehicle",
      "Advanced process technology leadership",
      "Leading-edge supply/demand dynamics",
      "Wireless upgrade cycles",
    ],
    marginDrivers: [
      "Mix shift to high-value compute and AI",
      "Process technology leadership premium",
      "Manufacturing utilization rates",
      "Pricing discipline through cycles",
    ],
    cashFlowDrivers: ["FCF at normalized utilization", "R&D spending efficiency", "Capex cycle management"],
    balanceSheetDrivers: ["Net cash position", "Capex as % of revenue", "Inventory weeks"],
    riskDrivers: [
      "Inventory correction cycles",
      "Geopolitical and export control risk",
      "Process technology transition risk",
      "Customer concentration",
      "Commodity vs differentiated product exposure",
    ],
    keyMetricsToWatch: [
      "Lead times and backlog",
      "Inventory weeks",
      "Gross margin vs cycle",
      "Revenue growth vs peers",
      "AI/data center revenue mix",
      "Utilization rates",
    ],
    bullishTriggers: [
      "AI demand sustains above cyclical inventory correction",
      "Technology leadership widens competitive moat",
      "Utilization recovers above structural break-even",
    ],
    bearishTriggers: [
      "Inventory correction extends beyond 2-3 quarters",
      "Export control restrictions limit key markets",
      "Technology leadership narrows vs peers",
    ],
    requiredDisclosures: [
      "Distinguish structural AI/compute growth from cyclical inventory correction.",
    ],
    synthesisWarnings: [
      "Use through-cycle normalized earnings, not peak-cycle P/E.",
    ],
  }),

  software_saas: brief("software_saas", {
    primaryValuationLogic: [
      "Rule of 40 (revenue growth + FCF margin)",
      "ARR growth and NRR (net revenue retention)",
      "EV/Sales relative to growth/margin profile",
      "Reverse DCF to expose implied growth expectations",
    ],
    weakValuationMethods: [
      "Near-term P/E before FCF maturity",
      "DCF without credible FCF conversion path",
    ],
    growthDrivers: [
      "ARR growth and expansion revenue",
      "NRR above 100% indicating land-and-expand success",
      "New customer acquisition and logo growth",
      "Platform expansion and upsell/cross-sell",
      "International market penetration",
    ],
    marginDrivers: [
      "Gross margin profile and scalability",
      "S&M leverage as cohort expands",
      "R&D leverage on existing platform",
      "FCF margin improvement path",
    ],
    cashFlowDrivers: ["FCF margin improvement trajectory", "SBC as % of revenue (dilution drag)", "Rule of 40 score"],
    balanceSheetDrivers: ["Net cash position and cash runway", "Share dilution from SBC and equity raises"],
    riskDrivers: [
      "SBC dilution eating into shareholder returns",
      "Growth deceleration below Rule of 40 threshold",
      "Competition from large platform players bundling",
      "FCF margin path uncertainty",
      "Churn acceleration or NRR compression",
    ],
    keyMetricsToWatch: [
      "ARR or revenue growth",
      "NRR",
      "Rule of 40 score",
      "FCF margin",
      "SBC as % of revenue",
      "Gross margin",
      "Churn rate",
    ],
    bullishTriggers: [
      "NRR sustains above 120% with strong expansion",
      "FCF margin path accelerates toward profitability",
      "Rule of 40 improves with balanced growth/profitability",
    ],
    bearishTriggers: [
      "Growth deceleration without FCF improvement",
      "NRR falls below 100%",
      "SBC dilution persistently high with no FCF offset",
    ],
    requiredDisclosures: [
      "Watch SBC dilution. ARR and NRR are the primary growth health indicators.",
    ],
    synthesisWarnings: [
      "Do not use near-term P/E before FCF maturity. Rule of 40 and NRR are the appropriate primary frameworks.",
    ],
  }),

  financial_insurance: brief("financial_insurance", {
    primaryValuationLogic: [
      "Combined ratio (loss ratio + expense ratio)",
      "Investment yield on float",
      "P/BV relative to ROE profile",
      "Reserve adequacy and loss development",
      "Dividend coverage and capital return",
    ],
    weakValuationMethods: [
      "Generic FCFF DCF — does not capture insurance underwriting dynamics",
    ],
    growthDrivers: [
      "Premium pricing power in hard market",
      "Underwriting discipline and risk selection",
      "Investment income growth from portfolio yield",
      "New product lines and geographic expansion",
    ],
    marginDrivers: [
      "Combined ratio improvement",
      "Investment yield improvement in rising rate environment",
      "Expense ratio reduction from scale",
    ],
    cashFlowDrivers: ["Float investment and yield", "Premium growth", "Capital return capacity"],
    balanceSheetDrivers: ["Reserve adequacy", "Investment portfolio credit quality", "Capital ratios"],
    riskDrivers: [
      "Catastrophe events and large claim events",
      "Reserve deterioration",
      "Investment portfolio credit/duration risk",
      "Competitive pricing pressure in soft market",
      "Regulatory capital requirements",
    ],
    keyMetricsToWatch: [
      "Combined ratio",
      "Loss ratio vs prior year",
      "Investment yield",
      "Reserve adequacy / development",
      "P/BV",
      "Dividend coverage",
    ],
    bullishTriggers: ["Hard market sustains strong pricing", "Investment yield improves", "Reserve releases boost earnings"],
    bearishTriggers: ["Catastrophe losses exceed expectations", "Reserve deterioration", "Soft market pricing pressure"],
    requiredDisclosures: ["Generic FCFF DCF does not capture insurance underwriting dynamics."],
    synthesisWarnings: ["Use combined ratio and P/BV vs ROE as primary valuation framework."],
  }),

  commodity_mining: brief("commodity_mining", {
    primaryValuationLogic: [
      "Mid-cycle commodity price DCF (not spot)",
      "NAV of reserves (net asset value approach)",
      "EV/EBITDA through-cycle multiples",
      "Cost curve position and competitive standing",
      "Reserve replacement ratio",
    ],
    weakValuationMethods: [
      "Peak commodity price extrapolation",
      "Simple growth DCF without price normalization",
    ],
    growthDrivers: [
      "Reserve development and mine expansion",
      "Production growth from project pipeline",
      "Grade improvement or ore processing efficiency",
      "Cost reduction and AISC improvement",
    ],
    marginDrivers: ["Commodity price realization", "AISC (all-in sustaining costs)", "Grade and processing efficiency"],
    cashFlowDrivers: ["FCF at mid-cycle prices", "Capex discipline", "Capital return at various price scenarios"],
    balanceSheetDrivers: ["Net debt", "Reserve replacement", "Capex vs depreciation"],
    riskDrivers: [
      "Commodity price decline",
      "Capex overruns and cost inflation",
      "Geopolitical risk in mining jurisdictions",
      "Environmental and regulatory risk",
      "Reserve impairment",
    ],
    keyMetricsToWatch: [
      "Commodity price assumptions (not spot)",
      "AISC (all-in sustaining costs)",
      "Reserve replacement ratio",
      "Net debt",
      "FCF at mid-cycle prices",
      "Capex plan vs budget",
    ],
    bullishTriggers: ["Commodity prices above mid-cycle", "AISC improvement from efficiency", "Reserve replacement exceeds depletion"],
    bearishTriggers: ["Commodity price below mid-cycle", "Capex inflation or overruns", "Reserve impairment or grade decline"],
    requiredDisclosures: ["Use mid-cycle commodity price assumptions, not spot prices, for DCF and NAV."],
    synthesisWarnings: ["NAV and mid-cycle FCF are the appropriate frameworks. Do not extrapolate spot prices."],
  }),

  industrial_cyclical: brief("industrial_cyclical", {
    primaryValuationLogic: [
      "Through-cycle normalized earnings (not peak)",
      "EV/EBITDA vs cycle position",
      "Backlog and book-to-bill visibility",
      "Operating leverage analysis at various utilization rates",
    ],
    weakValuationMethods: [
      "Peak-earnings P/E without cycle normalization",
    ],
    growthDrivers: [
      "Order backlog and book-to-bill ratio",
      "Infrastructure and capex spend cycles",
      "Aftermarket service and parts growth",
      "International market expansion",
      "Pricing discipline and mix improvement",
    ],
    marginDrivers: ["Pricing power and order mix", "Labor and input cost management", "Operating leverage at higher utilization"],
    cashFlowDrivers: ["FCF at normalized margins", "Working capital discipline through cycle", "Capex vs maintenance vs growth"],
    balanceSheetDrivers: ["Net debt and leverage", "Working capital cycle", "Pension obligations if relevant"],
    riskDrivers: [
      "Order cycle downturn and backlog depletion",
      "Pricing pressure in competitive bid markets",
      "Input cost and labor inflation",
      "Working capital consumption at cycle peak",
    ],
    keyMetricsToWatch: [
      "Order intake trend",
      "Backlog",
      "Book-to-bill ratio",
      "Margin trend vs cycle",
      "Working capital as % of revenue",
      "Net debt",
    ],
    bullishTriggers: ["Book-to-bill sustains above 1.0x", "Margins expand from operating leverage", "New market wins or pricing discipline"],
    bearishTriggers: ["Order intake declines for 2+ quarters", "Margins compress from input costs", "Backlog depletion without new orders"],
    requiredDisclosures: ["Use normalized through-cycle earnings for valuation — avoid extrapolating peak margins."],
    synthesisWarnings: ["Book-to-bill and backlog are leading indicators for industrial cyclicals."],
  }),

  healthcare_pharma: brief("healthcare_pharma", {
    primaryValuationLogic: [
      "Risk-adjusted NPV for pipeline (rNPV)",
      "Sum-of-the-parts: marketed products vs pipeline",
      "EV/Sales relative to growth and patent life",
      "Dividend capacity and capital return",
    ],
    weakValuationMethods: [
      "Simple P/E without pipeline risk adjustment",
      "Generic growth DCF ignoring patent cliff",
    ],
    growthDrivers: [
      "Pipeline advancement milestones and approvals",
      "New product launches and label expansions",
      "Biosimilar protection and patent life",
      "Geographic expansion for marketed products",
      "Pricing power in specialty categories",
    ],
    marginDrivers: ["Specialty/branded pricing", "Mix shift to high-margin products", "Manufacturing efficiency", "R&D productivity"],
    cashFlowDrivers: ["FCF from marketed products", "R&D efficiency (output per dollar spent)", "Capital allocation (M&A, buybacks, dividends)"],
    balanceSheetDrivers: ["Net cash or debt", "Pension obligations", "Contingent liabilities (litigation)"],
    riskDrivers: [
      "Patent cliff and loss of exclusivity",
      "Clinical trial failures",
      "Pricing and reimbursement pressure",
      "Product concentration risk",
      "Generic or biosimilar competition",
      "Regulatory delays or rejections",
    ],
    keyMetricsToWatch: [
      "Pipeline phase distribution",
      "Patent expiry timeline",
      "Top-3 product revenue concentration",
      "R&D spend and pipeline productivity",
      "Guidance vs consensus",
    ],
    bullishTriggers: ["Phase 3 pipeline success", "New approvals ahead of schedule", "Pricing power sustains above inflation"],
    bearishTriggers: ["Pipeline failures", "Pricing legislation or reimbursement pressure", "Loss of exclusivity without offset"],
    requiredDisclosures: ["Pipeline risk must be reflected in NPV. Do not use simple P/E without patent cliff adjustment."],
    synthesisWarnings: ["rNPV and SOTP are the appropriate frameworks for pharma. Highlight pipeline risks explicitly."],
  }),

  healthcare_medtech: brief("healthcare_medtech", {
    primaryValuationLogic: [
      "Procedure volume trends and TAM penetration",
      "EV/Sales with medtech growth premium",
      "FCF yield and capital allocation",
      "Innovation cycle and product replacement cycle",
    ],
    weakValuationMethods: [
      "Pure P/E without procedure volume normalization",
    ],
    growthDrivers: [
      "Procedure volume recovery post-pandemic",
      "New product launches and clinical evidence",
      "Geographic expansion in underpenetrated markets",
      "Robotics, digital, and minimally invasive conversion",
    ],
    marginDrivers: ["Pricing from clinical differentiation", "Manufacturing scale", "Mix shift to premium products"],
    cashFlowDrivers: ["FCF from mature product lines", "New product investment returns", "Capital discipline"],
    balanceSheetDrivers: ["Net debt", "Product recall reserves", "Litigation contingencies"],
    riskDrivers: [
      "Procedure volume softness",
      "Reimbursement pressure or coverage changes",
      "Product recalls and litigation",
      "Competition from disruptive technologies",
      "Regulatory delays",
    ],
    keyMetricsToWatch: [
      "Procedure volumes by key product",
      "Revenue per procedure or per unit",
      "New product contribution %",
      "Reimbursement coverage rates",
      "Regulatory pipeline milestones",
    ],
    bullishTriggers: ["Procedure volume recovery accelerates", "New product adoption above expectations", "Reimbursement coverage expands"],
    bearishTriggers: ["Procedure volume pressure", "Product recall or litigation", "Competitive product disruption"],
    requiredDisclosures: ["Procedure volumes and reimbursement are the primary growth drivers — flag if data is unavailable."],
    synthesisWarnings: ["Use procedure volume trends, not just earnings, as the primary growth health indicator."],
  }),

  consumer_staples: brief("consumer_staples", {
    primaryValuationLogic: [
      "DCF with stable, inflation-linked cash flows",
      "EV/EBITDA relative to staples peers",
      "Dividend yield analysis and payout coverage",
      "Volume/price mix decomposition",
    ],
    weakValuationMethods: ["Peak-margin extrapolation during input cost spikes"],
    growthDrivers: [
      "Pricing power and volume recovery post pricing",
      "Premium product segment growth",
      "Emerging market penetration",
      "Portfolio innovation and brand extension",
    ],
    marginDrivers: ["Pricing vs volume trade-off", "Input cost hedging", "Mix improvement to premium", "Efficiency programs"],
    cashFlowDrivers: ["Stable FCF from branded portfolio", "Dividend coverage and growth", "Capital return"],
    balanceSheetDrivers: ["Net debt/EBITDA", "Dividend coverage", "Pension obligations"],
    riskDrivers: [
      "Input cost inflation eroding margins",
      "Private label share gains",
      "Consumer trade-down from premium to value",
      "Volume elasticity to price increases",
      "Market saturation in developed markets",
    ],
    keyMetricsToWatch: [
      "Organic revenue growth (volume + price mix)",
      "Gross margin trend",
      "Market share data",
      "Brand investment",
      "Dividend coverage ratio",
    ],
    bullishTriggers: ["Volume recovers with pricing sustaining", "Brand investment improves market share", "Input costs ease"],
    bearishTriggers: ["Volume declines accelerate from price elasticity", "Private label gains share", "Input costs structurally elevated"],
    requiredDisclosures: ["Decompose organic growth into volume and price. Volume is the quality indicator."],
    synthesisWarnings: ["Volume/price decomposition is essential — price-only growth with volume declines is a risk signal."],
  }),

  consumer_discretionary: brief("consumer_discretionary", {
    primaryValuationLogic: [
      "EV/EBITDA through-cycle at normalized margins",
      "Relative valuation vs consumer confidence cycle",
      "FCF yield at through-cycle margins",
    ],
    weakValuationMethods: ["Peak-cycle earnings extrapolation"],
    growthDrivers: [
      "Consumer spending recovery",
      "Market share gains via differentiation",
      "New store, format, or digital expansion",
      "Premium product or experience penetration",
    ],
    marginDrivers: ["Inventory management and markdown discipline", "Labor cost control", "Premium mix shift"],
    cashFlowDrivers: ["FCF from normalized margins", "Working capital management", "Capital return"],
    balanceSheetDrivers: ["Inventory levels", "Net debt", "Lease obligations"],
    riskDrivers: [
      "Consumer spending cycle weakness",
      "Inventory excess and markdown risk",
      "Labor and input cost inflation",
      "E-commerce competitive disruption",
    ],
    keyMetricsToWatch: ["Same-store sales growth", "Inventory turns", "Gross margin vs year ago", "Consumer confidence trends", "Digital sales mix"],
    bullishTriggers: ["Same-store sales improve with stable margins", "Market share gains from operational excellence"],
    bearishTriggers: ["Inventory builds faster than sales", "Gross margin compressed by markdowns", "Consumer confidence deteriorates"],
    requiredDisclosures: ["Normalize earnings through consumer cycle before valuation."],
    synthesisWarnings: ["Inventory health is the leading indicator for discretionary retail."],
  }),

  telecom: brief("telecom", {
    primaryValuationLogic: [
      "FCF yield and dividend coverage",
      "EV/EBITDA at normalized capex",
      "Subscriber economics: ARPU and churn",
      "Leverage and debt maturity schedule",
    ],
    weakValuationMethods: ["Simple P/E without capex normalization"],
    growthDrivers: [
      "ARPU improvement from 5G and fiber upsell",
      "Subscriber growth in wireless and broadband",
      "Enterprise and B2B revenue growth",
      "Network monetization efficiencies",
    ],
    marginDrivers: ["Revenue per connection growth", "Network cost efficiency", "Bundling strategy"],
    cashFlowDrivers: ["FCF after capex", "Capex cycle management", "Dividend sustainability"],
    balanceSheetDrivers: ["Net debt/EBITDA", "Debt maturity profile", "Spectrum obligations"],
    riskDrivers: [
      "Capex intensity for network investment",
      "Debt leverage constraining capital return",
      "Subscriber churn and pricing pressure",
      "Regulatory spectrum and access rules",
    ],
    keyMetricsToWatch: ["ARPU", "Churn rate", "Capex", "Net debt/EBITDA", "FCF after capex", "Subscriber net adds"],
    bullishTriggers: ["ARPU growth accelerates from 5G/fiber monetization", "FCF improves as capex cycle peaks"],
    bearishTriggers: ["Churn accelerates on competitive pricing", "Capex exceeds FCF generation", "Regulatory spectrum costs increase"],
    requiredDisclosures: ["FCF after capex (not EBITDA) is the correct profitability measure for telecom."],
    synthesisWarnings: ["Normalize FCF after capex — EBITDA overstates telecom cash generation."],
  }),

  utilities: brief("utilities", {
    primaryValuationLogic: [
      "Regulated asset base × allowed ROE",
      "EV/EBITDA for regulated and unregulated mix",
      "Dividend yield and dividend coverage",
      "Rate case outcome analysis",
    ],
    weakValuationMethods: ["Generic growth DCF without rate case assumptions"],
    growthDrivers: [
      "Rate base growth from regulated infrastructure investment",
      "Rate case outcomes and allowed ROE",
      "Renewable energy transition projects",
      "Customer base and usage growth",
    ],
    marginDrivers: ["Allowed ROE vs earned ROE gap", "Cost of capital management", "Regulatory lag reduction"],
    cashFlowDrivers: ["Regulated cash flows from rate base returns", "Dividend coverage ratio", "Capex funded by equity/debt balance"],
    balanceSheetDrivers: ["Net debt/equity", "Regulatory equity cushion", "Pension obligations", "FFO/debt"],
    riskDrivers: [
      "Rising interest rates compressing yield spread",
      "Rate case rejection or unfavorable outcome",
      "Regulatory disallowances of capital projects",
      "Renewable transition capex overruns",
      "Weather and demand variability",
    ],
    keyMetricsToWatch: [
      "Allowed ROE vs cost of equity",
      "Rate base growth plan",
      "Dividend coverage ratio",
      "Net debt/equity",
      "Capex plan execution",
      "Rate case timeline",
    ],
    bullishTriggers: ["Favorable rate case increases allowed ROE", "Rate base growth accelerates", "Interest rates decline improving yield spread"],
    bearishTriggers: ["Rate case rejection or cut to allowed ROE", "Capex overruns reduce FCF", "Rising rates compress dividend yield premium"],
    requiredDisclosures: ["Rate case outcomes and allowed ROE are the primary value drivers — flag if pending or uncertain."],
    synthesisWarnings: ["Regulated asset base × allowed ROE drives value. Rate case risks must be prominently disclosed."],
  }),

  transportation_logistics: brief("transportation_logistics", {
    primaryValuationLogic: [
      "EV/EBITDA cycle-adjusted",
      "FCF yield at normalized freight markets",
      "Operating ratio for railroads and trucking",
      "Asset replacement cycle analysis",
    ],
    weakValuationMethods: ["Peak-freight P/E without cycle normalization"],
    growthDrivers: [
      "Freight volume recovery",
      "Pricing power and yield improvement",
      "Market share from service differentiation",
      "Network density and route economics",
      "E-commerce logistics tailwinds",
    ],
    marginDrivers: ["Operating ratio improvement", "Pricing discipline", "Fuel hedging effectiveness", "Labor efficiency"],
    cashFlowDrivers: ["FCF at normalized freight rates", "Fleet renewal discipline", "Capital return"],
    balanceSheetDrivers: ["Net debt and leverage", "Fleet age and capex requirements", "Lease obligations"],
    riskDrivers: [
      "Freight market weakness and pricing pressure",
      "Fuel cost exposure (unhedged)",
      "Labor cost and availability",
      "Overcapacity in key lanes",
      "Cyclical demand destruction",
    ],
    keyMetricsToWatch: [
      "Freight volumes",
      "Yield per unit/mile",
      "Operating ratio",
      "Fuel hedge position",
      "Capex cycle",
      "Load factor or utilization",
    ],
    bullishTriggers: ["Freight volume recovery with sustained pricing", "Operating ratio improves from network optimization"],
    bearishTriggers: ["Freight market oversupply", "Fuel costs spike without hedge coverage", "Volume declines from economic weakness"],
    requiredDisclosures: ["Normalize through the freight cycle — operating ratio at mid-cycle is the relevant margin measure."],
    synthesisWarnings: ["Use through-cycle normalized earnings. Peak-freight P/E overstates normalized value."],
  }),

  unknown: brief("unknown", {
    primaryValuationLogic: [
      "Relative valuation as external anchor",
      "Conservative DCF with wide scenario ranges",
      "Quality and risk assessment via Alpha Framework",
    ],
    weakValuationMethods: [
      "Hard Buy/Sell conclusions without sector-specific framework",
    ],
    growthDrivers: [
      "Revenue growth trend from available data",
      "Margin trajectory if discernible",
      "Market position signals from qualitative context",
    ],
    marginDrivers: ["Operating margin trend from available data"],
    cashFlowDrivers: ["FCF if available"],
    balanceSheetDrivers: ["Net debt if available", "Leverage ratio if available"],
    riskDrivers: [
      "Uncertain business model and limited classification signals",
      "Limited data for sector-specific risk assessment",
      "Execution and positioning risk",
    ],
    keyMetricsToWatch: [
      "Revenue growth",
      "Gross margin",
      "FCF",
      "Net debt",
      "Any available sector-specific KPIs",
    ],
    bullishTriggers: ["Revenue growth accelerates with margin improvement"],
    bearishTriggers: ["Revenue growth decelerates with margin compression"],
    requiredDisclosures: [
      "Company type classification confidence is low — all model outputs should be treated with caution.",
    ],
    synthesisWarnings: [
      "Company type is uncertain. Avoid hard Buy/Sell conclusions. Use conservative scenario assumptions and flag classification uncertainty.",
    ],
  }),
};

// ─── Public Builders ──────────────────────────────────────────────────────────

export function buildSectorSynthesisBrief(input: {
  companyType?: CompanyTypeClassification | null | undefined;
  sector?: string | null;
  industry?: string | null;
  modelSelectionSummary?: ModelSelectionSummary | null;
}): SectorSynthesisBrief {
  const sectorFamily = inferSectorFamily({
    companyType: input.companyType ?? null,
    sector: input.sector ?? null,
    industry: input.industry ?? null,
  });

  const base = SECTOR_BRIEFS[sectorFamily];

  // Augment with missing-model warnings from model selection summary
  const missingModels = input.modelSelectionSummary?.missingButRecommendedModels ?? [];
  const extraWarnings = missingModels.length > 0
    ? [`Missing recommended models: ${missingModels.join(", ")}. Mention as limitations in the synthesis.`]
    : [];

  const extraLimitations = input.modelSelectionSummary?.limitations ?? [];

  return {
    ...base,
    synthesisWarnings: [
      ...base.synthesisWarnings,
      ...extraWarnings,
      ...extraLimitations,
    ].filter((v, i, arr) => arr.indexOf(v) === i),
  };
}

// ─── Sector-specific growth_outlook required topics ───────────────────────────

const SECTOR_GROWTH_OUTLOOK_TOPICS: Partial<Record<SectorFamily, string[]>> = {
  financial_bank: ["NIM (Nettozinsmarge)", "Kreditqualität", "ROTCE", "Kapitalstärke (CET1)", "Kapitalmarkt- und Gebührenerträge", "Investmentbanking / Trading"],
  financial_insurance: ["Combined Ratio", "Investmenterträge", "Pricing-Disziplin", "Reserve-Angemessenheit"],
  reit: ["AFFO-Wachstumspfad", "Belegungsgrad (Occupancy)", "Same-Store-NOI-Wachstum", "Mietpreistrends bei Verlängerungen", "Zinssensitivität", "Cap-Rate-Entwicklung"],
  commodity_energy: ["Rohstoffpreisszenarien (Midcycle, nicht Spotpreis)", "Produktionsvolumen", "FCF nach Capex", "Dividenden- und Buyback-Coverage"],
  commodity_mining: ["Midcycle-Rohstoffpreise", "AISC-Kostenentwicklung", "Reservenersatz", "Produktionswachstum"],
  technology_platform: ["Segment-Wirtschaft (Cloud, Ads, Marketplace)", "Cloud-Wachstum", "AI-Monetarisierung", "Capex-zu-FCF-Konvertierung", "Operating Leverage"],
  quality_compounder: ["ROIC-Entwicklung", "FCF-Konvertierung", "Moat-Stärke", "Preissetzungsmacht", "Serviceanteil", "Buyback-Effektivität"],
  cyclical_hardware: ["Inventar-Normalisierung", "Bruttomarge im Zyklus", "AI-Infrastruktur-Capex-Zyklus", "Working-Capital-Entwicklung", "Kundenkonfiguration"],
  semiconductors: ["KI- und Rechenzentrum-Nachfrage vs. Inventarzyklus", "Prozess-Technologie-Leadership", "Auslastungsrate", "Strukturelles vs. zyklisches Wachstum"],
  software_saas: ["ARR-Wachstum", "NRR (Netto-Umsatzretention)", "Rule-of-40-Score", "FCF-Marge-Pfad", "SBC-Verwässerung"],
  industrial_cyclical: ["Auftragseingang und Book-to-Bill", "Auftragsbestand", "Normalisierte Margen durch den Zyklus"],
  healthcare_pharma: ["Pipeline-Meilensteine", "Patent-Cliff-Risiko", "Neue Zulassungen", "Preissetzungsmacht", "Produktkonzentration"],
  healthcare_medtech: ["Prozedurenvolumen", "Neuprodukt-Beiträge", "Erstattungsdeckung", "Innovationszyklus"],
  consumer_staples: ["Volumen- vs. Preiswachstum", "Markenpreissetzungsmacht", "Input-Kosten-Entwicklung"],
  consumer_discretionary: ["Same-Store-Sales", "Inventar-Gesundheit", "Verbraucherzyklus", "Margenentwicklung"],
  telecom: ["ARPU", "Subscriber-Wachstum", "5G/Glasfaser-Monetarisierung", "FCF nach Capex", "Verschuldung"],
  utilities: ["Rate-Case-Ausgang", "Regulatorische Vermögensbasis-Wachstum", "Dividendendeckung", "Zinssensitivität"],
  transportation_logistics: ["Frachtvolumen", "Yield-Entwicklung", "Betriebskostenquote", "Normalisierte FCF"],
};

// ─── Synthesis enforcement instructions ───────────────────────────────────────

const SYNTHESIS_INSTRUCTIONS: string[] = [
  "PRIORITY: Sector briefing has higher priority than generic financial interpretation. Use sector family first, then model selection, then raw metrics.",
  "Do not calculate new fair values — only synthesize, explain, and prioritize the provided deterministic outputs.",
  "Do not invent missing sector metrics (AFFO, NAV, CET1, ROTCE, P/TBV, ARR, NRR, oil price scenarios, segment data).",
  "Do not override deterministic guardrails silently.",
  "If weakValuationMethods are listed: explicitly state in the analysis why that method is a weak fit for this company type.",
  "If missingButRecommendedModels are listed: name them as valuation limitations and reduce valuation_confidence accordingly.",
  "If the recommended primary sector model is unavailable: valuation_confidence must not exceed 'medium'.",
  "If generic DCF is marked poor or partial fit for this company type, do not let it dominate the final rating.",
  "If sectorBrief growthDrivers and riskDrivers are available, write a sector-specific growth_outlook — generic fallback is forbidden.",
  "Use the generic growth_outlook fallback only when both company-specific and sector-specific context are genuinely insufficient (sectorFamily = unknown or empty drivers).",
  "If valuation models diverge, explain the divergence and lower valuation confidence accordingly.",
  "All claim confidence values must be integers from 1 to 5 (never 0, decimal, or null).",
  "Return only valid JSON matching the required schema.",
];

// ─── Sector-specific synthesis template ───────────────────────────────────────

const SECTOR_SYNTHESIS_TEMPLATES: Partial<Record<SectorFamily, {
  valuation: string[];
  growthOutlookMustMention: string[];
  bullCaseMustMention: string[];
  bearCaseMustMention: string[];
}>> = {
  financial_bank: {
    valuation: [
      "P/TBV und ROTCE sind die primären Wertmaßstäbe — KEIN Generic-FCFF-DCF als Hauptrahmen.",
      "CET1, NIM, Effizienzquote und Kreditverluste sind Pflichtbestandteile der Bewertungsaussage.",
    ],
    growthOutlookMustMention: ["NIM-Entwicklung", "Kreditqualität", "ROTCE", "CET1-Kapitalstärke", "Kapitalmarkt- und Investmentbanking-Erträge"],
    bullCaseMustMention: ["NIM-Ausweitung", "Kreditqualitätsverbesserung", "Kapitalrückführung"],
    bearCaseMustMention: ["Kreditverlustanstieg", "NIM-Kompression", "regulatorischer Druck"],
  },
  reit: {
    valuation: [
      "AFFO und NAV sind die primären Wertmaßstäbe — KEIN Generic-FCFF-DCF als Hauptrahmen.",
      "Cap-Rate-Spread, Belegungsgrad, Schuldenstruktur und AFFO-Ausschüttungsdeckung sind Pflichtbestandteile.",
    ],
    growthOutlookMustMention: ["AFFO", "Belegungsgrad", "Same-Store-NOI", "Mietpreiserhöhungen", "Zinssensitivität"],
    bullCaseMustMention: ["AFFO-Upside", "Belegungsverbesserung", "Cap-Rate-Stabilisierung"],
    bearCaseMustMention: ["Cap-Rate-Expansion (NAV-Erosion)", "Refinanzierungsrisiko", "Zinsdruck auf AFFO"],
  },
  commodity_energy: {
    valuation: [
      "Midcycle-FCF (NICHT Spot-Preis-Extrapolation) ist der primäre Bewertungsrahmen.",
      "Commodity-Preis-Szenarien, Produktionsvolumen und FCF-nach-Capex-Deckung sind Pflicht.",
    ],
    growthOutlookMustMention: ["Rohstoffpreis-Midcycle-Annahmen", "Produktionsvolumen", "FCF nach Capex", "Dividenden- und Buyback-Coverage"],
    bullCaseMustMention: ["Produktionswachstum", "Commodity-Preis über Midcycle", "Kapitalrückführung"],
    bearCaseMustMention: ["Commodity-Preisrückgang unter Midcycle", "Capex-Inflation", "Reservenersatz-Schwäche"],
  },
  technology_platform: {
    valuation: [
      "SOTP (Segment-Bewertung) ist der bevorzugte Rahmen — Generic-DCF nur als Ergänzung wenn Segmentdaten fehlen.",
      "Segment-Wirtschaft (Cloud, Ads, Marketplace), AI-Capex und FCF-Konvertierung sind Pflicht.",
    ],
    growthOutlookMustMention: ["Cloud-/Infrastruktur-Wachstum", "Werbeerträge", "AI-Monetarisierung", "Capex-zu-FCF-Konvertierung"],
    bullCaseMustMention: ["hochmargige Segmente wachsen stärker", "AI-Monetarisierung", "Operating Leverage"],
    bearCaseMustMention: ["regulatorischer Druck", "Capex-Intensität ohne sichtbaren ROI", "Segment-Margenkompression"],
  },
  quality_compounder: {
    valuation: [
      "DCF, Reverse-DCF und relative Bewertung sind alle valide — teure Bewertung allein ist KEIN Verkaufssignal.",
      "Moat-Stärke, Kapitalallokationsqualität und ROIC-Entwicklung sind Pflichtbestandteile.",
    ],
    growthOutlookMustMention: ["ROIC-Entwicklung", "FCF-Konvertierung", "Preissetzungsmacht", "Serviceanteil oder Recurring-Revenue"],
    bullCaseMustMention: ["ROIC oberhalb Erwartungen", "Moat-Stärkung", "Buyback-Effektivität"],
    bearCaseMustMention: ["ROIC-Verschlechterung", "Moat-Erosion", "regulatorischer Druck"],
  },
  cyclical_hardware: {
    valuation: [
      "Normalisierte Zyklus-Gewinne und stressgetestetes DCF sind erforderlich — KEIN aggressiver langfristiger DCF ohne Zyklus-Stress.",
      "Inventar, Working Capital und Bruttomarge im Zyklus sind Pflichtbestandteile.",
    ],
    growthOutlookMustMention: ["Inventar-Normalisierung", "Bruttomarge durch den Zyklus", "AI-Infrastruktur-Capex-Zyklus", "Working-Capital"],
    bullCaseMustMention: ["Bruttomarge-Ausweitung bei kontrolliertem Inventar", "AI-Nachfrage"],
    bearCaseMustMention: ["Inventaranstieg", "Bruttomargenkompression", "Working-Capital-Absorption"],
  },
};

export function buildGrowthOutlookRequirements(
  sectorFamily: SectorFamily,
  missingModels: string[],
  hasGrowthDrivers: boolean,
  hasRiskDrivers: boolean,
): string {
  if (sectorFamily === "unknown" || (!hasGrowthDrivers && !hasRiskDrivers)) {
    return `Wenn kein belastbarer Wachstumsausblick möglich: generischen Fallback verwenden.`;
  }

  const topics = SECTOR_GROWTH_OUTLOOK_TOPICS[sectorFamily];
  if (!topics || topics.length === 0) {
    return `Sektor-spezifischen Wachstumsausblick schreiben — generischer Fallback verboten.`;
  }

  const missingNote = missingModels.length > 0
    ? ` Fehlende Modelle als Limitation nennen: ${missingModels.join(", ")}.`
    : "";

  return `MUSS ENTHALTEN (generischer Fallback verboten): ${topics.join(", ")}.${missingNote}`;
}

export function buildSectorSpecificSynthesisTemplate(
  brief: SectorSynthesisBrief,
  summary: ModelSelectionSummary,
): string {
  const template = SECTOR_SYNTHESIS_TEMPLATES[brief.sectorFamily];
  const missing = summary.missingButRecommendedModels;
  const weak = summary.weakOrDisabledModels;

  const lines: string[] = [
    `[SEKTOR-SYNTHESE-PFLICHTEN: ${brief.sectorFamily.toUpperCase()}]`,
    "",
  ];

  // Valuation framework obligations
  if (template?.valuation?.length) {
    lines.push("BEWERTUNGSRAHMEN — PFLICHT:");
    for (const v of template.valuation) lines.push(`  • ${v}`);
    lines.push("");
  }

  // Weak method prohibition
  if (brief.weakValuationMethods.length > 0) {
    lines.push("SCHWACHE METHODEN — EXPLIZIT IM TEXT NENNEN:");
    for (const w of brief.weakValuationMethods) lines.push(`  ✗ ${w}`);
    lines.push("");
  }

  // Missing models → valuation confidence cap
  if (missing.length > 0) {
    lines.push("FEHLENDE EMPFOHLENE MODELLE — ALS LIMITATION NENNEN:");
    for (const m of missing) lines.push(`  ! ${m}: empfohlen aber nicht verfügbar → valuation_confidence max "medium"`);
    lines.push("");
  }

  // Weak/disabled models reminder
  if (weak.length > 0 && template?.valuation?.length) {
    lines.push(`DEAKTIVIERTE MODELLE (nicht als primäre Basis verwenden): ${weak.slice(0, 3).join(", ")}`);
    lines.push("");
  }

  // growth_outlook requirements
  const topics = SECTOR_GROWTH_OUTLOOK_TOPICS[brief.sectorFamily];
  if (topics && topics.length > 0) {
    lines.push("GROWTH_OUTLOOK — PFLICHTINHALT (generischer Fallback VERBOTEN):");
    lines.push(`  → ${topics.join("\n  → ")}`);
    lines.push("");
  }

  // Bull case requirements
  if (template?.bullCaseMustMention?.length) {
    lines.push("BULL CASE — MUSS THEMATISIEREN:");
    lines.push(`  → ${template.bullCaseMustMention.join("\n  → ")}`);
    lines.push("");
  }

  // Bear case requirements
  if (template?.bearCaseMustMention?.length) {
    lines.push("BEAR CASE — MUSS THEMATISIEREN:");
    lines.push(`  → ${template.bearCaseMustMention.join("\n  → ")}`);
    lines.push("");
  }

  // Required disclosures
  if (brief.requiredDisclosures.length > 0) {
    lines.push("PFLICHTANGABEN:");
    for (const d of brief.requiredDisclosures) lines.push(`  → ${d}`);
  }

  return lines.join("\n");
}

export function buildStructuredSynthesisInput(
  params: StructuredSynthesisInputParams,
): StructuredSynthesisInput {
  const {
    ticker,
    companyName,
    sector,
    industry,
    currentPrice,
    companyType,
    modelSelectionPlan,
    valuation,
    alphaFramework,
    confidence,
    guardrailsTriggered = [],
    thesisChangeTriggers,
    limitations: extraLimitations = [],
  } = params;

  // Summarize model selection plan
  const modelSelectionSummary: ModelSelectionSummary = modelSelectionPlan
    ? summarizeModelSelectionForSynthesis(modelSelectionPlan)
    : {
        primaryModels: [],
        secondaryModels: [],
        weakOrDisabledModels: [],
        missingButRecommendedModels: [],
        warnings: [],
        limitations: ["Model selection plan is not available."],
      };

  // Build sector brief
  const sectorBrief = buildSectorSynthesisBrief({
    companyType: companyType ?? null,
    sector: sector ?? null,
    industry: industry ?? null,
    modelSelectionSummary,
  });

  // Merge thesis triggers from provided + sector brief
  const mergedTriggers = {
    bullishTriggers: [
      ...(thesisChangeTriggers?.bullishTriggers ?? []),
      ...sectorBrief.bullishTriggers.slice(0, 2),
    ].filter((v, i, arr) => arr.indexOf(v) === i),
    bearishTriggers: [
      ...(thesisChangeTriggers?.bearishTriggers ?? []),
      ...sectorBrief.bearishTriggers.slice(0, 2),
    ].filter((v, i, arr) => arr.indexOf(v) === i),
    keyMetricsToWatch: [
      ...(thesisChangeTriggers?.keyMetricsToWatch ?? []),
      ...sectorBrief.keyMetricsToWatch.slice(0, 4),
    ].filter((v, i, arr) => arr.indexOf(v) === i),
  };

  // Aggregate limitations
  const limitations = [
    ...extraLimitations,
    ...modelSelectionSummary.limitations,
    ...modelSelectionSummary.warnings,
    ...sectorBrief.requiredDisclosures,
  ].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

  return {
    ticker,
    companyName,
    sector,
    industry,
    currentPrice,
    companyType: companyType ?? null,
    modelSelectionSummary,
    sectorBrief,
    valuation: valuation ?? null,
    alphaFramework: alphaFramework ?? null,
    confidence: confidence ?? null,
    guardrailsTriggered,
    thesisChangeTriggers: mergedTriggers,
    limitations,
    synthesisInstructions: SYNTHESIS_INSTRUCTIONS,
  };
}

// ─── Prompt Formatters ────────────────────────────────────────────────────────

export function formatStructuredBriefingForPrompt(input: StructuredSynthesisInput): string {
  const brief = input.sectorBrief;
  const sel = input.modelSelectionSummary;

  const lines: string[] = [
    `Sektor-Familie: ${brief.sectorFamily}`,
    `Primäre Bewertungslogik: ${brief.primaryValuationLogic.slice(0, 3).join(" | ")}`,
    brief.weakValuationMethods.length
      ? `SCHWACHE METHODEN (explizit nennen): ${brief.weakValuationMethods.join(" | ")}`
      : "",
    `Wachstumstreiber (growth_outlook MUSS diese reflektieren): ${brief.growthDrivers.slice(0, 4).join(" | ")}`,
    `Risikotreiber (bear_case MUSS diese reflektieren): ${brief.riskDrivers.slice(0, 3).join(" | ")}`,
    `Pflicht-Kennzahlen: ${brief.keyMetricsToWatch.slice(0, 5).join(" | ")}`,
    sel.primaryModels.length
      ? `Verfügbare primäre Modelle: ${sel.primaryModels.join(", ")}`
      : "",
    sel.missingButRecommendedModels.length
      ? `FEHLENDE EMPFOHLENE MODELLE (als Limitation nennen, valuation_confidence max "medium"): ${sel.missingButRecommendedModels.join(", ")}`
      : "",
    sel.weakOrDisabledModels.length
      ? `Deaktivierte Modelle (nicht als Primärbasis verwenden): ${sel.weakOrDisabledModels.slice(0, 3).join(", ")}`
      : "",
    brief.synthesisWarnings.slice(0, 2).join(" | "),
    brief.requiredDisclosures.length
      ? `PFLICHTANGABEN: ${brief.requiredDisclosures.join(" | ")}`
      : "",
    input.limitations.length
      ? `Modellbeschränkungen: ${input.limitations.slice(0, 3).join(" | ")}`
      : "",
  ];

  return lines.filter(Boolean).join("\n");
}

export function formatSectorSynthesisTemplate(input: StructuredSynthesisInput): string {
  return buildSectorSpecificSynthesisTemplate(input.sectorBrief, input.modelSelectionSummary);
}

export function buildGrowthOutlookToolDescription(
  input: StructuredSynthesisInput,
  defaultFallback: string,
): string {
  const { sectorBrief, modelSelectionSummary } = input;
  const topics = SECTOR_GROWTH_OUTLOOK_TOPICS[sectorBrief.sectorFamily];
  const missing = modelSelectionSummary.missingButRecommendedModels;

  if (!topics || topics.length === 0 || sectorBrief.sectorFamily === "unknown") {
    return `Konkreter Wachstumsausblick. Wenn nicht belastbar: "${defaultFallback}"`;
  }

  const missingNote = missing.length > 0
    ? ` Fehlende Modelle als Limitation nennen: ${missing.join(", ")}.`
    : "";

  return `SEKTOR-PFLICHT [${sectorBrief.sectorFamily}]: MUSS enthalten: ${topics.join(", ")}.${missingNote} Generischer Fallback verboten wenn Sektor-Treiber bekannt. Fallback nur wenn: "${defaultFallback}"`;
}
