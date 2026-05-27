import type { AssetSnapshot } from "@/types/database";
import type { AnalystData } from "@/lib/finance-client";

export type SectorTemplateKey =
  | "mega_cap_cloud_software"
  | "semiconductor"
  | "saas"
  | "bank"
  | "consumer_brand"
  | "cyclical_industrial"
  | "energy"
  | "healthcare_pharma"
  | "insurance"
  | "reit"
  | "speculative_growth"
  | "marketplace_platform"
  | "payments_fintech"
  | "automotive"
  | "general_quality_growth";

export type ClassificationConfidence = "high" | "medium" | "low";
export type ValuationConfidence = "high" | "medium" | "low";

export interface ValueDriver {
  driver: string;
  why_it_matters: string;
  metrics: string[];
}

export interface BusinessDriverAnalysis {
  business_model_type: string;
  sector_template: SectorTemplateKey;
  secondary_types: string[];
  classification_confidence: ClassificationConfidence;
  classification_reasoning: string[];
  revenue_drivers: ValueDriver[];
  margin_drivers: ValueDriver[];
  cash_flow_drivers: ValueDriver[];
  sector_specific_kpis: string[];
  valuation_implications: string[];
  bull_case_assumptions: string[];
  base_case_assumptions: string[];
  bear_case_assumptions: string[];
  red_flags: string[];
  model_instructions: {
    revenue_model: string;
    margin_model: string;
    capex_model: string;
    valuation_methods: string[];
  };
}

export interface RawValuationRange {
  currency: string;
  bear: number | null;
  base: number | null;
  bull: number | null;
  rationale: string;
  source: "analyst_consensus" | "own_model";
  confidence: ValuationConfidence;
  methods: string[];
  limitations: string[];
}

interface DataQualityLike {
  completeness_score?: number;
  missing_fields?: string[];
}

interface DriverTemplate {
  business_model_type: string;
  revenue_drivers: ValueDriver[];
  margin_drivers: ValueDriver[];
  cash_flow_drivers: ValueDriver[];
  sector_specific_kpis: string[];
  valuation_implications: string[];
  bull_case_assumptions: string[];
  base_case_assumptions: string[];
  bear_case_assumptions: string[];
  red_flags: string[];
  model_instructions: BusinessDriverAnalysis["model_instructions"];
}

interface ValuationConfig {
  peMultiples: { bear: number; base: number; bull: number };
  fcfYields?: { bear: number; base: number; bull: number };
  fcfWeight: number;
}

const DRIVER_LIBRARY: Record<SectorTemplateKey, DriverTemplate> = {
  mega_cap_cloud_software: {
    business_model_type: "Mega-cap software / cloud infrastructure",
    revenue_drivers: [
      { driver: "Cloud growth", why_it_matters: "Cloud consumption is the main incremental growth engine.", metrics: ["cloud revenue growth", "commercial bookings", "remaining performance obligations"] },
      { driver: "AI product monetization", why_it_matters: "AI features must convert infrastructure spend into durable revenue.", metrics: ["AI-related revenue contribution", "Copilot adoption", "enterprise AI workloads"] },
      { driver: "Enterprise IT spending", why_it_matters: "Large customers drive renewals, seat expansion and cloud migrations.", metrics: ["enterprise bookings", "subscription growth", "customer retention"] },
    ],
    margin_drivers: [
      { driver: "AI infrastructure gross-margin pressure", why_it_matters: "Data centers, GPUs and depreciation can dilute margins before revenue scales.", metrics: ["gross margin", "depreciation", "AI infrastructure cost"] },
      { driver: "Operating leverage", why_it_matters: "Premium valuations require revenue growth to translate into operating income.", metrics: ["operating margin", "R&D as % of revenue", "sales efficiency"] },
    ],
    cash_flow_drivers: [
      { driver: "Capex intensity", why_it_matters: "Elevated AI capex can pressure near-term free cash flow.", metrics: ["capital expenditures", "capex as % of revenue", "data-center spend"] },
      { driver: "FCF conversion", why_it_matters: "High-quality software names should convert earnings into cash over time.", metrics: ["free cash flow", "FCF margin", "net income to FCF conversion"] },
    ],
    sector_specific_kpis: ["cloud revenue growth", "commercial bookings", "operating margin", "gross margin", "capex", "free cash flow"],
    valuation_implications: ["Separate analyst optimism from own FCF/multiple model.", "Treat AI capex efficiency as a core bear/base/bull variable.", "Use EV/FCF and P/E as sanity checks rather than a single target price."],
    bull_case_assumptions: ["AI workloads accelerate cloud growth.", "Copilot or AI features become measurable revenue contributors.", "Margins recover as infrastructure utilization rises."],
    base_case_assumptions: ["Cloud growth remains healthy but AI capex tempers FCF growth.", "Subscription base supports resilient earnings.", "Valuation multiple stays premium but not euphoric."],
    bear_case_assumptions: ["Capex grows faster than AI revenue.", "Gross margin pressure proves structural.", "Enterprise demand slows while expectations stay high."],
    red_flags: ["Capex grows faster than cloud revenue for multiple quarters", "FCF margin declines despite operating income growth", "AI monetization remains qualitative rather than measurable"],
    model_instructions: {
      revenue_model: "Use segment-based revenue model where possible, with cloud and subscription growth separated.",
      margin_model: "Model gross-margin pressure from AI infrastructure explicitly.",
      capex_model: "Separate normalized maintenance capex from elevated AI growth capex.",
      valuation_methods: ["EV/FCF", "P/E sanity check", "DCF-light"],
    },
  },
  semiconductor: {
    business_model_type: "Semiconductor / AI infrastructure supplier",
    revenue_drivers: [
      { driver: "Datacenter demand", why_it_matters: "AI and cloud capex cycles can dominate revenue growth.", metrics: ["datacenter revenue", "order backlog", "customer capex"] },
      { driver: "Cycle position", why_it_matters: "Semiconductor earnings can swing sharply through inventory cycles.", metrics: ["inventory", "book-to-bill", "revenue growth"] },
      { driver: "Customer concentration", why_it_matters: "A few hyperscalers can drive both upside and downside.", metrics: ["top customer exposure", "segment concentration"] },
    ],
    margin_drivers: [
      { driver: "Gross margin", why_it_matters: "Pricing power and product mix show whether growth is high quality.", metrics: ["gross margin", "ASP", "product mix"] },
      { driver: "Supply constraints", why_it_matters: "Capacity limits can support pricing but constrain shipments.", metrics: ["lead times", "foundry capacity", "supply availability"] },
    ],
    cash_flow_drivers: [
      { driver: "Inventory cycle", why_it_matters: "Inventory build can precede margin or demand pressure.", metrics: ["inventory days", "working capital", "free cash flow"] },
      { driver: "Capex exposure of customers", why_it_matters: "Supplier revenue depends on customer investment cycles.", metrics: ["hyperscaler capex", "order visibility"] },
    ],
    sector_specific_kpis: ["datacenter revenue", "gross margin", "inventory", "backlog", "customer concentration", "export restrictions"],
    valuation_implications: ["Use through-cycle multiples.", "Bull cases need margin durability and demand visibility.", "Wide scenario ranges are normal in cyclical semiconductors."],
    bull_case_assumptions: ["AI infrastructure demand remains supply constrained.", "Gross margins stay elevated.", "Customer capex continues expanding."],
    base_case_assumptions: ["Growth normalizes but remains above market.", "Margins ease from peak levels.", "Inventory remains manageable."],
    bear_case_assumptions: ["Customer capex pauses.", "Export controls or supply chain issues intensify.", "Inventory correction compresses revenue and margins."],
    red_flags: ["Inventory rises faster than revenue", "Gross margin rolls over while valuation stays peak", "Revenue depends too heavily on one customer group"],
    model_instructions: {
      revenue_model: "Use cycle-aware revenue scenarios rather than linear extrapolation.",
      margin_model: "Model gross margin separately and stress-test mean reversion.",
      capex_model: "Track customer capex as a demand proxy more than company capex.",
      valuation_methods: ["P/E through-cycle", "EV/EBITDA", "EV/Sales sanity check"],
    },
  },
  saas: {
    business_model_type: "Software-as-a-Service / subscription software",
    revenue_drivers: [
      { driver: "ARR growth", why_it_matters: "Recurring revenue growth drives long-term compounding.", metrics: ["ARR", "subscription revenue growth", "billings"] },
      { driver: "Net revenue retention", why_it_matters: "Expansion within existing customers lowers growth risk.", metrics: ["NRR", "churn", "upsell rate"] },
    ],
    margin_drivers: [
      { driver: "Operating leverage", why_it_matters: "SaaS valuation depends on scaling sales, R&D and G&A efficiently.", metrics: ["operating margin", "Rule of 40", "sales efficiency"] },
      { driver: "Stock-based compensation", why_it_matters: "SBC can dilute owners even when adjusted earnings look strong.", metrics: ["SBC as % of revenue", "share count growth"] },
    ],
    cash_flow_drivers: [
      { driver: "FCF margin", why_it_matters: "Mature SaaS should convert recurring revenue into cash.", metrics: ["free cash flow margin", "deferred revenue"] },
    ],
    sector_specific_kpis: ["ARR growth", "net revenue retention", "churn", "Rule of 40", "FCF margin", "SBC dilution"],
    valuation_implications: ["Prefer EV/FCF for profitable SaaS and EV/Sales only as a secondary sanity check.", "High growth without FCF requires low valuation confidence."],
    bull_case_assumptions: ["NRR remains strong.", "Operating leverage expands margins.", "AI features lift pricing or retention."],
    base_case_assumptions: ["Growth normalizes while margins improve.", "Customer retention remains healthy.", "Valuation multiple tracks FCF progress."],
    bear_case_assumptions: ["Growth slows before profitability scales.", "SBC dilution offsets FCF.", "Churn rises in weaker IT spending environment."],
    red_flags: ["NRR falls while sales efficiency weakens", "SBC remains high despite slowing growth", "Rule of 40 deteriorates"],
    model_instructions: {
      revenue_model: "Use recurring revenue growth and retention if available.",
      margin_model: "Explicitly model operating leverage and SBC dilution.",
      capex_model: "Capex is usually less central; focus on FCF conversion.",
      valuation_methods: ["EV/FCF", "Rule of 40 sanity check", "EV/Sales fallback"],
    },
  },
  bank: {
    business_model_type: "Bank / financial institution",
    revenue_drivers: [
      { driver: "Net interest income", why_it_matters: "Rate levels and deposit beta drive core earnings.", metrics: ["net interest income", "net interest margin", "deposit beta"] },
      { driver: "Loan growth", why_it_matters: "Credit demand determines balance-sheet growth.", metrics: ["loan growth", "deposit growth"] },
    ],
    margin_drivers: [
      { driver: "Credit losses", why_it_matters: "Provisioning can overwhelm revenue growth in downturns.", metrics: ["credit loss provisions", "charge-offs", "delinquencies"] },
    ],
    cash_flow_drivers: [
      { driver: "Capital strength", why_it_matters: "Buybacks, dividends and balance-sheet risk depend on regulatory capital.", metrics: ["CET1", "capital ratios", "payout ratio"] },
    ],
    sector_specific_kpis: ["net interest margin", "credit losses", "CET1", "loan growth", "deposit beta", "yield curve"],
    valuation_implications: ["Use P/E and price-to-book logic rather than industrial FCF.", "Debt-to-equity is structurally less comparable for banks."],
    bull_case_assumptions: ["Credit quality remains resilient.", "Net interest income stabilizes.", "Capital returns continue."],
    base_case_assumptions: ["Loan growth is moderate.", "Credit normalization is manageable.", "Capital ratios remain adequate."],
    bear_case_assumptions: ["Credit losses rise.", "Funding costs pressure margins.", "Regulatory capital requirements increase."],
    red_flags: ["Credit provisions rise faster than revenue", "Deposit costs accelerate", "Capital ratios weaken"],
    model_instructions: {
      revenue_model: "Focus on net interest income and fee income.",
      margin_model: "Model credit losses and efficiency ratio rather than gross margin.",
      capex_model: "Industrial capex is not central; use capital adequacy and payout capacity.",
      valuation_methods: ["P/E", "Price-to-book sanity check", "Dividend yield sanity check"],
    },
  },
  consumer_brand: {
    business_model_type: "Consumer brand / pricing power business",
    revenue_drivers: [
      { driver: "Organic growth", why_it_matters: "Volume plus price shows demand quality.", metrics: ["organic sales growth", "volume growth", "pricing"] },
      { driver: "Brand strength", why_it_matters: "Brand equity supports pricing power and resilience.", metrics: ["market share", "brand spend", "repeat purchases"] },
    ],
    margin_drivers: [
      { driver: "Gross margin", why_it_matters: "Input costs and pricing power determine profit quality.", metrics: ["gross margin", "input costs", "price/mix"] },
    ],
    cash_flow_drivers: [
      { driver: "Inventory health", why_it_matters: "Inventory pressure can precede markdowns.", metrics: ["inventory", "working capital", "FCF conversion"] },
    ],
    sector_specific_kpis: ["organic growth", "volume growth", "pricing", "gross margin", "inventory", "China exposure"],
    valuation_implications: ["Use P/E and FCF yield with lower growth assumptions than tech.", "Premium depends on pricing power and margin resilience."],
    bull_case_assumptions: ["Pricing power offsets costs.", "Volumes stabilize or improve.", "Brand strength supports market share."],
    base_case_assumptions: ["Moderate growth with stable margins.", "FCF conversion remains solid.", "Valuation stays near quality-consumer range."],
    bear_case_assumptions: ["Volumes weaken.", "Inventory or China exposure pressures margins.", "Pricing power fades."],
    red_flags: ["Volume declines while growth relies only on price", "Inventory builds", "Gross margin falls despite price increases"],
    model_instructions: {
      revenue_model: "Separate price and volume where available.",
      margin_model: "Track gross margin and input-cost pass-through.",
      capex_model: "Use normal FCF conversion and working-capital checks.",
      valuation_methods: ["P/E", "EV/FCF", "Dividend yield sanity check"],
    },
  },
  cyclical_industrial: {
    business_model_type: "Cyclical industrial / capital goods",
    revenue_drivers: [
      { driver: "Order cycle", why_it_matters: "Backlog and orders lead future revenue.", metrics: ["orders", "backlog", "book-to-bill"] },
      { driver: "End-market demand", why_it_matters: "Industrial demand is sensitive to macro cycles.", metrics: ["segment revenue", "PMI exposure", "utilization"] },
    ],
    margin_drivers: [
      { driver: "Operating leverage", why_it_matters: "Margins expand in upcycles and compress quickly in downturns.", metrics: ["operating margin", "capacity utilization"] },
    ],
    cash_flow_drivers: [
      { driver: "Working capital", why_it_matters: "Inventory and receivables often consume cash in cyclical turns.", metrics: ["working capital", "inventory", "FCF"] },
    ],
    sector_specific_kpis: ["orders", "backlog", "operating margin", "working capital", "capacity utilization", "PMI exposure"],
    valuation_implications: ["Use through-cycle multiples.", "Avoid extrapolating peak margins as base case."],
    bull_case_assumptions: ["Backlog supports revenue visibility.", "Operating leverage lifts margins.", "Cash conversion improves."],
    base_case_assumptions: ["Demand remains mixed but stable.", "Margins normalize.", "Backlog converts at planned pace."],
    bear_case_assumptions: ["Orders slow.", "Margins compress.", "Working capital consumes cash."],
    red_flags: ["Orders decline before revenue", "Inventory builds", "Margins peak while valuation expands"],
    model_instructions: {
      revenue_model: "Use order/backlog cycle where possible.",
      margin_model: "Stress-test margins against downcycle assumptions.",
      capex_model: "Model working-capital swings and maintenance capex.",
      valuation_methods: ["P/E through-cycle", "EV/EBITDA", "EV/FCF"],
    },
  },
  energy: {
    business_model_type: "Energy / commodity-sensitive producer",
    revenue_drivers: [
      { driver: "Commodity price exposure", why_it_matters: "Oil, gas or power prices dominate revenue and cash flow.", metrics: ["realized prices", "production", "commodity benchmarks"] },
      { driver: "Production volumes", why_it_matters: "Volume growth only creates value if returns exceed cost of capital.", metrics: ["production growth", "reserve life"] },
    ],
    margin_drivers: [
      { driver: "Cost curve position", why_it_matters: "Low-cost producers survive downcycles better.", metrics: ["lifting cost", "cash cost", "break-even price"] },
    ],
    cash_flow_drivers: [
      { driver: "Capital discipline", why_it_matters: "Shareholder returns depend on disciplined capex.", metrics: ["capex", "FCF", "dividends", "buybacks"] },
    ],
    sector_specific_kpis: ["realized commodity prices", "production", "break-even cost", "capex", "FCF", "shareholder returns"],
    valuation_implications: ["Use FCF yield and cycle-normalized commodity assumptions.", "Avoid treating spot-cycle earnings as permanent."],
    bull_case_assumptions: ["Commodity prices remain supportive.", "Capex stays disciplined.", "FCF funds buybacks or dividends."],
    base_case_assumptions: ["Commodity prices normalize.", "Production is stable.", "Capital returns continue at moderate pace."],
    bear_case_assumptions: ["Commodity prices fall.", "Capex rises into weaker prices.", "Policy or transition risk increases."],
    red_flags: ["Capex rises while FCF falls", "Debt increases in downcycle", "Returns rely on high spot prices"],
    model_instructions: {
      revenue_model: "Use commodity-sensitive scenarios rather than linear growth.",
      margin_model: "Stress-test costs and realized price assumptions.",
      capex_model: "Track sustaining versus growth capex.",
      valuation_methods: ["FCF yield", "EV/EBITDA through-cycle", "Dividend yield sanity check"],
    },
  },
  healthcare_pharma: {
    business_model_type: "Healthcare / pharma",
    revenue_drivers: [
      { driver: "Product portfolio growth", why_it_matters: "Patented products and indications drive revenue durability.", metrics: ["product revenue", "prescription growth", "market share"] },
      { driver: "Pipeline optionality", why_it_matters: "Clinical and approval events can change long-term value.", metrics: ["pipeline milestones", "trial readouts", "approvals"] },
    ],
    margin_drivers: [
      { driver: "R&D productivity", why_it_matters: "High R&D needs successful pipeline conversion.", metrics: ["R&D spend", "approval rate", "gross margin"] },
    ],
    cash_flow_drivers: [
      { driver: "Patent cliff risk", why_it_matters: "Loss of exclusivity can pressure long-term FCF.", metrics: ["LOE schedule", "generic competition", "FCF"] },
    ],
    sector_specific_kpis: ["product revenue growth", "pipeline milestones", "gross margin", "R&D productivity", "patent cliff", "regulatory events"],
    valuation_implications: ["Use P/E and FCF with explicit pipeline/patent risk.", "Speculative biotech requires much lower model confidence."],
    bull_case_assumptions: ["Key products keep share.", "Pipeline adds new growth legs.", "Margins remain resilient."],
    base_case_assumptions: ["Portfolio growth offsets patent pressure.", "Pipeline contributes gradually.", "FCF remains steady."],
    bear_case_assumptions: ["Patent cliff or pricing pressure hits revenue.", "Pipeline disappoints.", "Regulatory risk rises."],
    red_flags: ["One product dominates growth", "Pipeline setbacks", "Pricing pressure accelerates"],
    model_instructions: {
      revenue_model: "Separate major products and patent/pipeline events when data is available.",
      margin_model: "Track R&D burden and gross margin resilience.",
      capex_model: "Industrial capex is less central; focus on FCF and reinvestment.",
      valuation_methods: ["P/E", "EV/FCF", "Pipeline scenario sanity check"],
    },
  },
  insurance: {
    business_model_type: "Insurance / financial compounder",
    revenue_drivers: [
      { driver: "Premium growth", why_it_matters: "Underwriting growth must be profitable.", metrics: ["premium growth", "policy count"] },
      { driver: "Investment income", why_it_matters: "Rates and portfolio quality drive earnings.", metrics: ["investment income", "portfolio yield"] },
    ],
    margin_drivers: [
      { driver: "Combined ratio", why_it_matters: "Underwriting discipline is the central profitability measure.", metrics: ["combined ratio", "loss ratio"] },
    ],
    cash_flow_drivers: [
      { driver: "Capital returns", why_it_matters: "Excess capital supports dividends and buybacks.", metrics: ["solvency ratio", "buybacks", "dividends"] },
    ],
    sector_specific_kpis: ["premium growth", "combined ratio", "loss ratio", "investment income", "solvency ratio", "book value growth"],
    valuation_implications: ["Use P/E and book-value growth logic; industrial debt ratios are less informative."],
    bull_case_assumptions: ["Combined ratio remains attractive.", "Investment income improves.", "Capital returns continue."],
    base_case_assumptions: ["Premium growth is moderate.", "Claims normalize.", "Capital position stays strong."],
    bear_case_assumptions: ["Catastrophe losses or claims inflation rise.", "Investment income weakens.", "Capital returns slow."],
    red_flags: ["Combined ratio deteriorates", "Reserve releases mask underwriting weakness", "Capital ratio falls"],
    model_instructions: {
      revenue_model: "Use premium and investment income drivers.",
      margin_model: "Focus on combined ratio, not gross margin.",
      capex_model: "Use solvency and capital return capacity instead of industrial capex.",
      valuation_methods: ["P/E", "Price-to-book sanity check", "Dividend yield sanity check"],
    },
  },
  reit: {
    business_model_type: "REIT / real estate income vehicle",
    revenue_drivers: [
      { driver: "Same-store NOI", why_it_matters: "Property-level income drives sustainable growth.", metrics: ["same-store NOI", "occupancy", "lease spreads"] },
      { driver: "Rate sensitivity", why_it_matters: "Higher rates can pressure valuation and refinancing.", metrics: ["interest expense", "debt maturity", "cap rates"] },
    ],
    margin_drivers: [
      { driver: "Occupancy and lease pricing", why_it_matters: "Occupancy protects cash flow.", metrics: ["occupancy", "rent growth", "lease spreads"] },
    ],
    cash_flow_drivers: [
      { driver: "AFFO payout", why_it_matters: "Dividend safety depends on AFFO coverage.", metrics: ["AFFO", "payout ratio", "debt maturity"] },
    ],
    sector_specific_kpis: ["AFFO", "occupancy", "same-store NOI", "lease spreads", "cap rates", "debt maturity"],
    valuation_implications: ["Use AFFO yield and dividend coverage; P/E is often less useful."],
    bull_case_assumptions: ["Occupancy stays high.", "Rates stabilize or decline.", "AFFO covers dividend comfortably."],
    base_case_assumptions: ["NOI grows modestly.", "Refinancing costs are manageable.", "Dividend remains covered."],
    bear_case_assumptions: ["Rates rise.", "Occupancy falls.", "AFFO payout becomes stretched."],
    red_flags: ["AFFO payout exceeds comfort range", "Debt maturities cluster near term", "Occupancy falls"],
    model_instructions: {
      revenue_model: "Use same-store NOI and occupancy if available.",
      margin_model: "Track property-level NOI rather than operating margin.",
      capex_model: "Model maintenance capex and refinancing needs.",
      valuation_methods: ["AFFO yield", "Dividend yield sanity check", "NAV sanity check"],
    },
  },
  speculative_growth: {
    business_model_type: "Speculative growth / story-driven company",
    revenue_drivers: [
      { driver: "Execution milestones", why_it_matters: "Narrative value depends on converting story into measurable revenue.", metrics: ["revenue growth", "backlog", "milestones"] },
      { driver: "Funding runway", why_it_matters: "Negative FCF can create dilution or financing risk.", metrics: ["free cash flow", "cash balance", "share issuance"] },
    ],
    margin_drivers: [
      { driver: "Path to profitability", why_it_matters: "Gross margin and operating leverage must eventually support the valuation.", metrics: ["gross margin", "operating margin", "EBITDA"] },
    ],
    cash_flow_drivers: [
      { driver: "Cash burn", why_it_matters: "Burn rate determines dilution risk and survival horizon.", metrics: ["free cash flow", "cash burn", "debt"] },
    ],
    sector_specific_kpis: ["revenue growth", "backlog", "cash burn", "gross margin", "dilution", "execution milestones"],
    valuation_implications: ["Use very wide scenario ranges and low confidence unless profitability is visible.", "Avoid pseudo-precise targets."],
    bull_case_assumptions: ["Execution milestones are met.", "Revenue scales faster than cash burn.", "Funding risk remains manageable."],
    base_case_assumptions: ["Growth continues but profitability remains the key proof point.", "Scenario range stays wide.", "Entry quality matters heavily."],
    bear_case_assumptions: ["Milestones slip.", "Cash burn remains high.", "Dilution or debt funding becomes necessary."],
    red_flags: ["Negative FCF worsens while valuation rises", "Milestones are delayed", "Story relies on distant optionality without measurable KPIs"],
    model_instructions: {
      revenue_model: "Use scenario-based revenue, not linear extrapolation.",
      margin_model: "Focus on path to profitability and gross-margin proof points.",
      capex_model: "Track cash runway, dilution and funding needs.",
      valuation_methods: ["Scenario range", "EV/Sales sanity check", "No precise target if data is thin"],
    },
  },
  marketplace_platform: {
    business_model_type: "Marketplace / platform business",
    revenue_drivers: [
      { driver: "GMV or transaction volume", why_it_matters: "Platform revenue scales with ecosystem activity.", metrics: ["GMV", "transaction volume", "active users"] },
      { driver: "Take rate", why_it_matters: "Monetization quality depends on pricing power without hurting volume.", metrics: ["take rate", "ad revenue", "seller services"] },
    ],
    margin_drivers: [
      { driver: "Fulfillment or infrastructure cost", why_it_matters: "Platform growth can be margin-light or margin-heavy depending on operating model.", metrics: ["fulfillment cost", "gross margin", "operating margin"] },
    ],
    cash_flow_drivers: [
      { driver: "Working-capital and capex intensity", why_it_matters: "Asset-heavy platforms require stronger FCF tests.", metrics: ["capex", "working capital", "FCF"] },
    ],
    sector_specific_kpis: ["GMV", "take rate", "active users", "ad revenue", "operating margin", "FCF"],
    valuation_implications: ["Separate high-margin platform revenue from asset-heavy operations.", "Use sum-of-parts when segments differ materially."],
    bull_case_assumptions: ["Take rate rises without volume pressure.", "Ads or services expand margins.", "Scale improves FCF."],
    base_case_assumptions: ["Marketplace growth remains steady.", "Margins improve gradually.", "FCF conversion is mixed but improving."],
    bear_case_assumptions: ["Volume slows.", "Competition pressures take rate.", "Fulfillment or capex costs absorb growth."],
    red_flags: ["GMV slows while valuation assumes acceleration", "Take rate increases hurt volume", "Capex consumes incremental cash flow"],
    model_instructions: {
      revenue_model: "Segment marketplace, ads/services and asset-heavy units separately if possible.",
      margin_model: "Separate high-margin platform services from fulfillment-heavy operations.",
      capex_model: "Track working capital and infrastructure capex.",
      valuation_methods: ["Sum-of-parts", "EV/FCF", "P/E sanity check"],
    },
  },
  payments_fintech: {
    business_model_type: "Payments / fintech network",
    revenue_drivers: [
      { driver: "Payment volume", why_it_matters: "Network revenue follows consumer and merchant transaction growth.", metrics: ["payment volume", "processed transactions", "cross-border volume"] },
      { driver: "Take rate", why_it_matters: "Pricing and mix determine monetization.", metrics: ["take rate", "net revenue yield"] },
    ],
    margin_drivers: [
      { driver: "Network operating leverage", why_it_matters: "Scaled payment networks should expand earnings faster than revenue.", metrics: ["operating margin", "transaction margin"] },
    ],
    cash_flow_drivers: [
      { driver: "FCF conversion", why_it_matters: "High-quality payment networks are cash-generative.", metrics: ["free cash flow", "buybacks", "share count"] },
    ],
    sector_specific_kpis: ["payment volume", "cross-border volume", "take rate", "operating margin", "FCF", "fraud/regulatory risk"],
    valuation_implications: ["Use P/E and EV/FCF; premium depends on volume growth and margin durability."],
    bull_case_assumptions: ["Cross-border and payment volume accelerate.", "Margins remain high.", "Buybacks add per-share growth."],
    base_case_assumptions: ["Volume growth is stable.", "Margins stay resilient.", "FCF supports buybacks."],
    bear_case_assumptions: ["Regulation pressures fees.", "Competition lowers take rate.", "Consumer spending slows."],
    red_flags: ["Take rate compresses", "Cross-border slows", "Regulatory pressure rises"],
    model_instructions: {
      revenue_model: "Use payment volume and take-rate logic.",
      margin_model: "Track network operating leverage.",
      capex_model: "Focus on FCF conversion and buybacks more than capex.",
      valuation_methods: ["P/E", "EV/FCF", "FCF yield"],
    },
  },
  automotive: {
    business_model_type: "Automotive / mobility manufacturer",
    revenue_drivers: [
      { driver: "Unit deliveries", why_it_matters: "Volume growth is the base of revenue but not enough alone.", metrics: ["deliveries", "production", "ASP"] },
      { driver: "Software or optionality", why_it_matters: "Autonomous/software narratives can drive valuation beyond auto margins.", metrics: ["software revenue", "FSD adoption", "services revenue"] },
    ],
    margin_drivers: [
      { driver: "Automotive gross margin", why_it_matters: "Pricing cuts and mix shifts can quickly change profitability.", metrics: ["auto gross margin", "ASP", "COGS"] },
    ],
    cash_flow_drivers: [
      { driver: "Manufacturing capex", why_it_matters: "Factories and new models consume capital before returns are proven.", metrics: ["capex", "FCF", "inventory"] },
    ],
    sector_specific_kpis: ["deliveries", "ASP", "auto gross margin", "inventory", "capex", "software/services revenue"],
    valuation_implications: ["Separate core auto valuation from optionality.", "Use lower confidence when valuation relies on unproven AI/robotics narratives."],
    bull_case_assumptions: ["Deliveries grow with stable margins.", "Software/services optionality becomes measurable.", "Capex produces attractive returns."],
    base_case_assumptions: ["Volume growth is mixed.", "Margins normalize.", "Optionality remains partly narrative."],
    bear_case_assumptions: ["Price cuts erode margins.", "Inventory rises.", "Optionality fails to monetize."],
    red_flags: ["Deliveries grow but margins fall", "Inventory builds", "Valuation relies on distant optionality"],
    model_instructions: {
      revenue_model: "Model deliveries, ASP and optionality separately.",
      margin_model: "Stress-test automotive gross margin.",
      capex_model: "Track manufacturing capex and FCF conversion.",
      valuation_methods: ["P/E for profitable core", "EV/Sales sanity check", "Separate optionality scenario"],
    },
  },
  general_quality_growth: {
    business_model_type: "General quality growth company",
    revenue_drivers: [
      { driver: "Revenue growth durability", why_it_matters: "Sustained growth is needed to justify premium multiples.", metrics: ["revenue growth", "market share", "organic growth"] },
      { driver: "Competitive position", why_it_matters: "Moats determine whether growth converts into durable cash flow.", metrics: ["gross margin", "operating margin", "retention"] },
    ],
    margin_drivers: [
      { driver: "Margin resilience", why_it_matters: "Quality companies should defend margins in slower growth periods.", metrics: ["gross margin", "operating margin"] },
    ],
    cash_flow_drivers: [
      { driver: "FCF conversion", why_it_matters: "Cash generation validates accounting earnings.", metrics: ["free cash flow", "FCF margin", "working capital"] },
    ],
    sector_specific_kpis: ["revenue growth", "operating margin", "free cash flow", "debt", "return on capital", "valuation multiple"],
    valuation_implications: ["Use a conservative blend of P/E and FCF yield.", "Keep confidence medium unless sector-specific data is available."],
    bull_case_assumptions: ["Growth remains durable.", "Margins stay resilient.", "FCF conversion supports valuation."],
    base_case_assumptions: ["Growth normalizes.", "Margins are stable.", "Valuation remains fair relative to quality."],
    bear_case_assumptions: ["Growth slows.", "Margins compress.", "Debt or valuation risk rises."],
    red_flags: ["FCF diverges from earnings", "Debt rises while growth slows", "Multiple expands without improving fundamentals"],
    model_instructions: {
      revenue_model: "Use revenue-growth scenarios with conservative normalization.",
      margin_model: "Track margin resilience and operating leverage.",
      capex_model: "Use FCF conversion and working-capital checks.",
      valuation_methods: ["P/E", "EV/FCF", "FCF yield"],
    },
  },
};

const TICKER_OVERRIDES: Record<string, { primary: SectorTemplateKey; secondary?: string[]; confidence?: ClassificationConfidence; reasoning?: string[] }> = {
  MSFT: { primary: "mega_cap_cloud_software", secondary: ["enterprise_software", "ai_infrastructure_beneficiary"], confidence: "high", reasoning: ["Large enterprise software and cloud revenue mix.", "AI-related infrastructure capex is material."] },
  AMZN: { primary: "marketplace_platform", secondary: ["mega_cap_cloud_software", "cloud_infrastructure", "retail_platform"], confidence: "high", reasoning: ["AWS and marketplace economics require separate drivers.", "Fulfillment and infrastructure capex affect FCF."] },
  GOOGL: { primary: "mega_cap_cloud_software", secondary: ["advertising_platform", "ai_infrastructure_beneficiary"], confidence: "high", reasoning: ["Search advertising and cloud/AI infrastructure both drive valuation."] },
  GOOG: { primary: "mega_cap_cloud_software", secondary: ["advertising_platform", "ai_infrastructure_beneficiary"], confidence: "high", reasoning: ["Search advertising and cloud/AI infrastructure both drive valuation."] },
  META: { primary: "mega_cap_cloud_software", secondary: ["advertising_platform", "ai_infrastructure_beneficiary"], confidence: "high", reasoning: ["Advertising cash flows fund AI infrastructure and product bets."] },
  ORCL: { primary: "mega_cap_cloud_software", secondary: ["enterprise_software", "cloud_infrastructure"], confidence: "high" },
  NVDA: { primary: "semiconductor", secondary: ["ai_infrastructure_supplier", "high_growth_cyclical"], confidence: "high" },
  AMD: { primary: "semiconductor", secondary: ["ai_infrastructure_supplier", "cyclical_chipmaker"], confidence: "high" },
  AVGO: { primary: "semiconductor", secondary: ["infrastructure_software", "ai_networking"], confidence: "high" },
  ASML: { primary: "semiconductor", secondary: ["semicap_equipment", "supply_chain_chokepoint"], confidence: "high" },
  TSM: { primary: "semiconductor", secondary: ["foundry", "ai_supply_chain"], confidence: "high" },
  INTC: { primary: "semiconductor", secondary: ["turnaround", "foundry_optional"], confidence: "high" },
  MU: { primary: "semiconductor", secondary: ["memory_cycle"], confidence: "high" },
  ARM: { primary: "semiconductor", secondary: ["ip_licensing", "ai_optional"], confidence: "high" },
  QCOM: { primary: "semiconductor", secondary: ["mobile_chipmaker", "licensing"], confidence: "high" },
  CRM: { primary: "saas", secondary: ["enterprise_software"], confidence: "high" },
  NOW: { primary: "saas", secondary: ["workflow_platform"], confidence: "high" },
  ADBE: { primary: "saas", secondary: ["creative_software", "ai_monetization"], confidence: "high" },
  SNOW: { primary: "saas", secondary: ["data_platform", "speculative_growth"], confidence: "high" },
  DDOG: { primary: "saas", secondary: ["observability_platform"], confidence: "high" },
  NET: { primary: "saas", secondary: ["edge_network", "security"], confidence: "high" },
  JPM: { primary: "bank", secondary: ["money_center_bank"], confidence: "high" },
  BAC: { primary: "bank", secondary: ["money_center_bank"], confidence: "high" },
  WFC: { primary: "bank", secondary: ["retail_bank"], confidence: "high" },
  C: { primary: "bank", secondary: ["global_bank"], confidence: "high" },
  GS: { primary: "bank", secondary: ["investment_bank"], confidence: "high" },
  DB: { primary: "bank", secondary: ["european_bank"], confidence: "high" },
  "DBK.DE": { primary: "bank", secondary: ["european_bank"], confidence: "high" },
  KO: { primary: "consumer_brand", secondary: ["defensive_consumer"], confidence: "high" },
  PEP: { primary: "consumer_brand", secondary: ["defensive_consumer"], confidence: "high" },
  MCD: { primary: "consumer_brand", secondary: ["restaurant_brand"], confidence: "high" },
  NKE: { primary: "consumer_brand", secondary: ["global_brand"], confidence: "high" },
  SBUX: { primary: "consumer_brand", secondary: ["restaurant_brand"], confidence: "high" },
  CAT: { primary: "cyclical_industrial", secondary: ["capital_goods"], confidence: "high" },
  DE: { primary: "cyclical_industrial", secondary: ["agriculture_equipment"], confidence: "high" },
  BA: { primary: "cyclical_industrial", secondary: ["aerospace"], confidence: "high" },
  GE: { primary: "cyclical_industrial", secondary: ["aerospace_industrial"], confidence: "high" },
  XOM: { primary: "energy", secondary: ["integrated_energy"], confidence: "high" },
  CVX: { primary: "energy", secondary: ["integrated_energy"], confidence: "high" },
  SHEL: { primary: "energy", secondary: ["integrated_energy"], confidence: "high" },
  BP: { primary: "energy", secondary: ["integrated_energy"], confidence: "high" },
  LLY: { primary: "healthcare_pharma", secondary: ["pharma_growth"], confidence: "high" },
  NVO: { primary: "healthcare_pharma", secondary: ["pharma_growth"], confidence: "high" },
  MRK: { primary: "healthcare_pharma", secondary: ["large_pharma"], confidence: "high" },
  PFE: { primary: "healthcare_pharma", secondary: ["large_pharma"], confidence: "high" },
  JNJ: { primary: "healthcare_pharma", secondary: ["diversified_healthcare"], confidence: "high" },
  ABBV: { primary: "healthcare_pharma", secondary: ["large_pharma"], confidence: "high" },
  BRK: { primary: "insurance", secondary: ["conglomerate"], confidence: "high" },
  "BRK-B": { primary: "insurance", secondary: ["conglomerate"], confidence: "high" },
  "BRK.A": { primary: "insurance", secondary: ["conglomerate"], confidence: "high" },
  "ALV.DE": { primary: "insurance", secondary: ["european_insurance"], confidence: "high" },
  O: { primary: "reit", secondary: ["net_lease_reit"], confidence: "high" },
  PLD: { primary: "reit", secondary: ["industrial_reit"], confidence: "high" },
  AMT: { primary: "reit", secondary: ["tower_reit"], confidence: "high" },
  V: { primary: "payments_fintech", secondary: ["payment_network"], confidence: "high" },
  MA: { primary: "payments_fintech", secondary: ["payment_network"], confidence: "high" },
  PYPL: { primary: "payments_fintech", secondary: ["fintech_platform"], confidence: "high" },
  SQ: { primary: "payments_fintech", secondary: ["fintech_platform", "speculative_growth"], confidence: "high" },
  TSLA: { primary: "automotive", secondary: ["speculative_growth", "ai_optionalities"], confidence: "high" },
  RIVN: { primary: "automotive", secondary: ["speculative_growth"], confidence: "high" },
  LCID: { primary: "automotive", secondary: ["speculative_growth"], confidence: "high" },
  F: { primary: "automotive", secondary: ["legacy_auto"], confidence: "high" },
  GM: { primary: "automotive", secondary: ["legacy_auto"], confidence: "high" },
  RKLB: { primary: "speculative_growth", secondary: ["space_defense", "story_growth"], confidence: "high", reasoning: ["Execution milestones and funding runway matter more than classic near-term multiples."] },
  PLTR: { primary: "saas", secondary: ["ai_platform", "speculative_growth"], confidence: "high" },
};

const VALUATION_CONFIG: Record<SectorTemplateKey, ValuationConfig> = {
  mega_cap_cloud_software: { peMultiples: { bear: 22, base: 28, bull: 34 }, fcfYields: { bear: 0.038, base: 0.03, bull: 0.024 }, fcfWeight: 0.55 },
  semiconductor: { peMultiples: { bear: 18, base: 25, bull: 35 }, fcfYields: { bear: 0.06, base: 0.043, bull: 0.032 }, fcfWeight: 0.45 },
  saas: { peMultiples: { bear: 24, base: 34, bull: 45 }, fcfYields: { bear: 0.05, base: 0.037, bull: 0.028 }, fcfWeight: 0.5 },
  bank: { peMultiples: { bear: 8, base: 10, bull: 12 }, fcfWeight: 0 },
  consumer_brand: { peMultiples: { bear: 18, base: 23, bull: 28 }, fcfYields: { bear: 0.055, base: 0.043, bull: 0.034 }, fcfWeight: 0.45 },
  cyclical_industrial: { peMultiples: { bear: 13, base: 17, bull: 22 }, fcfYields: { bear: 0.075, base: 0.058, bull: 0.045 }, fcfWeight: 0.35 },
  energy: { peMultiples: { bear: 8, base: 10, bull: 13 }, fcfYields: { bear: 0.105, base: 0.08, bull: 0.06 }, fcfWeight: 0.5 },
  healthcare_pharma: { peMultiples: { bear: 15, base: 20, bull: 25 }, fcfYields: { bear: 0.06, base: 0.047, bull: 0.037 }, fcfWeight: 0.45 },
  insurance: { peMultiples: { bear: 9, base: 12, bull: 15 }, fcfWeight: 0 },
  reit: { peMultiples: { bear: 12, base: 15, bull: 18 }, fcfYields: { bear: 0.085, base: 0.067, bull: 0.052 }, fcfWeight: 0.65 },
  speculative_growth: { peMultiples: { bear: 12, base: 22, bull: 38 }, fcfWeight: 0 },
  marketplace_platform: { peMultiples: { bear: 20, base: 28, bull: 36 }, fcfYields: { bear: 0.05, base: 0.038, bull: 0.029 }, fcfWeight: 0.45 },
  payments_fintech: { peMultiples: { bear: 18, base: 24, bull: 30 }, fcfYields: { bear: 0.052, base: 0.04, bull: 0.032 }, fcfWeight: 0.45 },
  automotive: { peMultiples: { bear: 8, base: 13, bull: 20 }, fcfYields: { bear: 0.09, base: 0.07, bull: 0.052 }, fcfWeight: 0.3 },
  general_quality_growth: { peMultiples: { bear: 16, base: 21, bull: 27 }, fcfYields: { bear: 0.065, base: 0.05, bull: 0.039 }, fcfWeight: 0.45 },
};

function cloneTemplate(key: SectorTemplateKey): DriverTemplate {
  return JSON.parse(JSON.stringify(DRIVER_LIBRARY[key])) as DriverTemplate;
}

function baseSymbol(symbol: string): string {
  return symbol.toUpperCase().split(".")[0];
}

function roundMoney(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function classifyCompany(symbol: string, snapshot: AssetSnapshot): {
  primary: SectorTemplateKey;
  secondary: string[];
  confidence: ClassificationConfidence;
  reasoning: string[];
} {
  const upper = symbol.toUpperCase();
  const override = TICKER_OVERRIDES[upper] ?? TICKER_OVERRIDES[baseSymbol(symbol)];
  if (override) {
    return {
      primary: override.primary,
      secondary: override.secondary ?? [],
      confidence: override.confidence ?? "high",
      reasoning: override.reasoning ?? ["Ticker-Mapping matches a known company type."],
    };
  }

  const revenueGrowth = snapshot.revenue_growth ?? 0;
  const fcf = snapshot.free_cashflow ?? 0;
  const pe = snapshot.pe_ratio ?? null;
  const marketCap = snapshot.market_cap ?? 0;

  if (fcf < 0 && (revenueGrowth > 0.12 || marketCap < 50_000_000_000)) {
    return {
      primary: "speculative_growth",
      secondary: ["story_growth"],
      confidence: "medium",
      reasoning: ["Negative free cash flow with growth or smaller market cap suggests scenario-driven modeling."],
    };
  }

  if (validPositive(pe) && pe > 45 && revenueGrowth > 0.08) {
    return {
      primary: "general_quality_growth",
      secondary: ["premium_growth"],
      confidence: "low",
      reasoning: ["High multiple and positive growth indicate a growth profile, but sector data is unavailable."],
    };
  }

  if (fcf > 0 && revenueGrowth > 0.05) {
    return {
      primary: "general_quality_growth",
      secondary: ["cash_generative_growth"],
      confidence: "medium",
      reasoning: ["Positive free cash flow and revenue growth support a quality-growth fallback template."],
    };
  }

  return {
    primary: "general_quality_growth",
    secondary: ["fallback"],
    confidence: "low",
    reasoning: ["No reliable sector classification available; using conservative general template."],
  };
}

export function buildBusinessDriverAnalysis(symbol: string, snapshot: AssetSnapshot): BusinessDriverAnalysis {
  const classification = classifyCompany(symbol, snapshot);
  const template = cloneTemplate(classification.primary);

  return {
    business_model_type: template.business_model_type,
    sector_template: classification.primary,
    secondary_types: classification.secondary,
    classification_confidence: classification.confidence,
    classification_reasoning: classification.reasoning,
    revenue_drivers: template.revenue_drivers,
    margin_drivers: template.margin_drivers,
    cash_flow_drivers: template.cash_flow_drivers,
    sector_specific_kpis: template.sector_specific_kpis,
    valuation_implications: template.valuation_implications,
    bull_case_assumptions: template.bull_case_assumptions,
    base_case_assumptions: template.base_case_assumptions,
    bear_case_assumptions: template.bear_case_assumptions,
    red_flags: template.red_flags,
    model_instructions: template.model_instructions,
  };
}

export function buildAnalystConsensusValuation(analystData: AnalystData | null): RawValuationRange | null {
  if (!analystData?.mean_target) return null;
  const ratingCount = analystData.strong_buy + analystData.buy + analystData.hold + analystData.sell + analystData.strong_sell;
  const limitations = [
    "Analystenkonsens ist Marktmeinung, kein eigenes Bewertungsmodell.",
    "Kursziele können alt, revisionsanfällig oder stark streuend sein.",
  ];

  return {
    currency: "USD",
    bear: roundMoney(analystData.low_target ?? analystData.mean_target * 0.85),
    base: roundMoney(analystData.mean_target),
    bull: roundMoney(analystData.high_target ?? analystData.mean_target * 1.15),
    rationale: ratingCount > 0
      ? `Analystenkonsens aus ${ratingCount} Ratings; dient als Marktmeinung, nicht als eigenes Modell.`
      : "Analystenkonsens als Marktmeinung; kein eigenes Bewertungsmodell.",
    source: "analyst_consensus",
    confidence: "medium",
    methods: ["Analyst target consensus"],
    limitations,
  };
}

function buildPeRange(snapshot: AssetSnapshot, config: ValuationConfig): { bear: number; base: number; bull: number } | null {
  if (!validPositive(snapshot.price) || !validPositive(snapshot.pe_ratio) || snapshot.pe_ratio > 180) return null;

  const eps = snapshot.price / snapshot.pe_ratio;
  if (!Number.isFinite(eps) || eps <= 0) return null;

  const growth = clamp(snapshot.revenue_growth ?? 0.04, -0.25, 0.35);
  const bearEps = eps * (1 + clamp(growth - 0.08, -0.25, 0.1));
  const baseEps = eps * (1 + clamp(growth, -0.08, 0.18));
  const bullEps = eps * (1 + clamp(growth + 0.08, 0, 0.35));

  return {
    bear: bearEps * config.peMultiples.bear,
    base: baseEps * config.peMultiples.base,
    bull: bullEps * config.peMultiples.bull,
  };
}

function buildFcfRange(snapshot: AssetSnapshot, config: ValuationConfig): { bear: number; base: number; bull: number } | null {
  if (!config.fcfYields || !validPositive(snapshot.price) || !validPositive(snapshot.market_cap) || !validPositive(snapshot.free_cashflow)) {
    return null;
  }

  const growth = clamp(snapshot.revenue_growth ?? 0.03, -0.2, 0.3);
  const bearFcf = snapshot.free_cashflow * (1 + clamp(growth - 0.08, -0.25, 0.08));
  const baseFcf = snapshot.free_cashflow * (1 + clamp(growth, -0.08, 0.15));
  const bullFcf = snapshot.free_cashflow * (1 + clamp(growth + 0.06, 0, 0.25));

  return {
    bear: snapshot.price * ((bearFcf / config.fcfYields.bear) / snapshot.market_cap),
    base: snapshot.price * ((baseFcf / config.fcfYields.base) / snapshot.market_cap),
    bull: snapshot.price * ((bullFcf / config.fcfYields.bull) / snapshot.market_cap),
  };
}

function weightedBlend(
  peRange: { bear: number; base: number; bull: number } | null,
  fcfRange: { bear: number; base: number; bull: number } | null,
  fcfWeight: number,
): { bear: number; base: number; bull: number } | null {
  if (!peRange && !fcfRange) return null;
  if (peRange && !fcfRange) return peRange;
  if (!peRange && fcfRange) return fcfRange;

  const wFcf = clamp(fcfWeight, 0.1, 0.9);
  const wPe = 1 - wFcf;
  return {
    bear: peRange!.bear * wPe + fcfRange!.bear * wFcf,
    base: peRange!.base * wPe + fcfRange!.base * wFcf,
    bull: peRange!.bull * wPe + fcfRange!.bull * wFcf,
  };
}

function normalizeScenarioOrder(range: { bear: number; base: number; bull: number }): { bear: number; base: number; bull: number } {
  const base = Math.max(0.01, range.base);
  const bear = Math.min(range.bear, base * 0.95);
  const bull = Math.max(range.bull, base * 1.05);
  return { bear, base, bull };
}

function inferModelConfidence(
  snapshot: AssetSnapshot,
  methods: string[],
  dataQuality?: DataQualityLike | null,
  primaryType?: SectorTemplateKey,
): ValuationConfidence {
  const score = dataQuality?.completeness_score ?? 100;
  const missingCount = dataQuality?.missing_fields?.length ?? 0;
  const speculative = primaryType === "speculative_growth" || primaryType === "automotive";

  if (score < 65 || missingCount >= 5 || speculative) return "low";
  if (methods.length >= 2 && validPositive(snapshot.free_cashflow) && validPositive(snapshot.pe_ratio) && score >= 85) return "high";
  return "medium";
}

export function buildOwnModelValuation(
  snapshot: AssetSnapshot,
  drivers: BusinessDriverAnalysis,
  dataQuality?: DataQualityLike | null,
): RawValuationRange | null {
  const config = VALUATION_CONFIG[drivers.sector_template] ?? VALUATION_CONFIG.general_quality_growth;
  const peRange = buildPeRange(snapshot, config);
  const fcfRange = buildFcfRange(snapshot, config);
  const blended = weightedBlend(peRange, fcfRange, config.fcfWeight);

  if (!blended) return null;

  const ordered = normalizeScenarioOrder(blended);
  const methods = [
    peRange ? "P/E sanity check" : null,
    fcfRange ? "FCF yield model" : null,
    ...drivers.model_instructions.valuation_methods.filter(method =>
      method !== "P/E sanity check" && method !== "EV/FCF" && method !== "FCF yield",
    ).slice(0, 1),
  ].filter((item): item is string => !!item);
  const confidence = inferModelConfidence(snapshot, methods, dataQuality, drivers.sector_template);
  const limitations = [
    "Lightweight-Modell: keine vollständige DCF- oder Segmentmodellierung.",
    (dataQuality?.missing_fields?.length ?? 0) > 0
      ? `Fehlende Providerdaten (${dataQuality?.missing_fields?.slice(0, 4).join(", ")}) reduzieren die Modellkonfidenz, sind aber kein operatives Unternehmensrisiko.`
      : null,
    drivers.sector_template === "mega_cap_cloud_software"
      ? "AI-Capex und Margen werden qualitativ berücksichtigt, aber nicht quartalsgenau modelliert."
      : null,
    drivers.sector_template === "speculative_growth"
      ? "Story- und Execution-Risiken erzeugen eine breite Spanne mit niedriger Konfidenz."
      : null,
  ].filter((item): item is string => !!item);

  return {
    currency: (snapshot.currency ?? "USD").toUpperCase(),
    bear: roundMoney(ordered.bear),
    base: roundMoney(ordered.base),
    bull: roundMoney(ordered.bull),
    rationale: `Eigenes ${methods.join(" + ")} für ${drivers.business_model_type}; Szenario-Spanne statt punktgenauem Kursziel.`,
    source: "own_model",
    confidence,
    methods,
    limitations,
  };
}
