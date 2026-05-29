import {
  inferSectorFamily,
  buildSectorSynthesisBrief,
  buildStructuredSynthesisInput,
  buildGrowthOutlookRequirements,
  buildSectorSpecificSynthesisTemplate,
  buildGrowthOutlookToolDescription,
  formatStructuredBriefingForPrompt,
  formatSectorSynthesisTemplate,
  type SectorFamily,
} from "../structured-synthesis-input";
import type { CompanyTypeClassification } from "../company-type-router";
import type { ModelSelectionPlan } from "../model-selector";
import { detectAvailableModelInputs, buildModelSelectionPlan } from "../model-selector";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function classification(
  primaryType: CompanyTypeClassification["primaryType"],
  confidence: 1 | 2 | 3 | 4 | 5 = 4,
): CompanyTypeClassification {
  return {
    primaryType,
    secondaryTypes: [],
    confidence,
    rationale: `Test: ${primaryType}`,
    evidence: ["test"],
    limitations: [],
  };
}

function planFor(
  primaryType: CompanyTypeClassification["primaryType"],
  financials: Record<string, unknown> = {},
): ModelSelectionPlan {
  const available = detectAvailableModelInputs({
    financials: { price: 100, market_cap: 1_000_000_000, free_cashflow: 5_000_000, ...financials },
  });
  return buildModelSelectionPlan({
    companyType: classification(primaryType),
    availableInputs: available,
  });
}

function structuredInput(
  primaryType: CompanyTypeClassification["primaryType"],
  sector?: string,
  industry?: string,
) {
  return buildStructuredSynthesisInput({
    ticker: "TEST",
    sector,
    industry,
    companyType: classification(primaryType),
    modelSelectionPlan: planFor(primaryType),
  });
}

// ─── inferSectorFamily tests ──────────────────────────────────────────────────

describe("inferSectorFamily", () => {
  const cases: Array<{
    label: string;
    primaryType?: CompanyTypeClassification["primaryType"];
    sector?: string;
    industry?: string;
    expected: SectorFamily;
  }> = [
    { label: "quality compounder", primaryType: "quality_compounder", expected: "quality_compounder" },
    { label: "platform conglomerate", primaryType: "platform_conglomerate", expected: "technology_platform" },
    { label: "cyclical hardware", primaryType: "cyclical_hardware", sector: "Technology", industry: "Computer Hardware", expected: "cyclical_hardware" },
    { label: "financial bank", primaryType: "financial", sector: "Financials", industry: "Diversified Banks", expected: "financial_bank" },
    { label: "financial insurance by industry", sector: "Financials", industry: "Property & Casualty Insurance", expected: "financial_insurance" },
    { label: "financial insurance", primaryType: "financial", sector: "Financials", industry: "Insurance", expected: "financial_insurance" },
    { label: "REIT by type", primaryType: "reit", expected: "reit" },
    { label: "REIT by industry", sector: "Real Estate", industry: "Industrial REIT", expected: "reit" },
    { label: "commodity energy", primaryType: "commodity_cyclical", sector: "Energy", industry: "Oil & Gas Exploration", expected: "commodity_energy" },
    { label: "commodity mining by industry", sector: "Materials", industry: "Gold Mining", expected: "commodity_mining" },
    { label: "software SaaS", primaryType: "hypergrowth_software", sector: "Technology", industry: "Application Software", expected: "software_saas" },
    { label: "software SaaS by industry", sector: "Technology", industry: "SaaS Platform", expected: "software_saas" },
    { label: "semiconductors by industry", sector: "Technology", industry: "Semiconductors", expected: "semiconductors" },
    { label: "utilities", sector: "Utilities", expected: "utilities" },
    { label: "telecom by industry", sector: "Communication Services", industry: "Telecom", expected: "telecom" },
    { label: "healthcare pharma", sector: "Healthcare", industry: "Pharmaceutical", expected: "healthcare_pharma" },
    { label: "healthcare pharma biotech", sector: "Healthcare", industry: "Biotechnology", expected: "healthcare_pharma" },
    { label: "healthcare medtech", sector: "Healthcare", industry: "Medical Devices", expected: "healthcare_medtech" },
    { label: "industrial cyclical", primaryType: "industrial_cyclical", sector: "Industrials", expected: "industrial_cyclical" },
    { label: "consumer staples", sector: "Consumer Staples", expected: "consumer_staples" },
    { label: "consumer discretionary", sector: "Consumer Discretionary", expected: "consumer_discretionary" },
    { label: "transportation logistics", sector: "Industrials", industry: "Freight & Logistics", expected: "transportation_logistics" },
    { label: "unknown fallback", primaryType: "unknown", expected: "unknown" },
  ];

  for (const { label, primaryType, sector, industry, expected } of cases) {
    it(`maps ${label} → ${expected}`, () => {
      const result = inferSectorFamily({
        companyType: primaryType ? classification(primaryType) : null,
        sector,
        industry,
      });
      expect(result).toBe(expected);
    });
  }

  it("falls back to unknown when no signals are present", () => {
    expect(inferSectorFamily({ companyType: null })).toBe("unknown");
  });
});

// ─── buildSectorSynthesisBrief tests ─────────────────────────────────────────

describe("buildSectorSynthesisBrief – structural", () => {
  const families: SectorFamily[] = [
    "financial_bank", "financial_insurance", "reit", "commodity_energy", "commodity_mining",
    "technology_platform", "quality_compounder", "cyclical_hardware", "semiconductors",
    "software_saas", "industrial_cyclical", "healthcare_pharma", "healthcare_medtech",
    "consumer_staples", "consumer_discretionary", "telecom", "utilities",
    "transportation_logistics", "unknown",
  ];

  for (const family of families) {
    describe(`${family}`, () => {
      let brief: ReturnType<typeof buildSectorSynthesisBrief>;

      beforeEach(() => {
        // Find a primaryType that maps to this family
        const primaryTypeMap: Record<SectorFamily, CompanyTypeClassification["primaryType"]> = {
          financial_bank: "financial",
          financial_insurance: "financial",
          reit: "reit",
          commodity_energy: "commodity_cyclical",
          commodity_mining: "commodity_cyclical",
          technology_platform: "platform_conglomerate",
          quality_compounder: "quality_compounder",
          cyclical_hardware: "cyclical_hardware",
          semiconductors: "cyclical_hardware",
          software_saas: "hypergrowth_software",
          industrial_cyclical: "industrial_cyclical",
          healthcare_pharma: "unknown",
          healthcare_medtech: "unknown",
          consumer_staples: "income",
          consumer_discretionary: "unknown",
          telecom: "income",
          utilities: "income",
          transportation_logistics: "industrial_cyclical",
          unknown: "unknown",
        };

        const industryMap: Partial<Record<SectorFamily, string>> = {
          financial_insurance: "Insurance",
          commodity_mining: "Gold Mining",
          semiconductors: "Semiconductors",
          healthcare_pharma: "Pharmaceutical",
          healthcare_medtech: "Medical Devices",
          consumer_staples: "Consumer Staples",
          consumer_discretionary: "Consumer Discretionary",
          telecom: "Telecom",
          utilities: "Utilities",
          transportation_logistics: "Freight & Logistics",
        };

        brief = buildSectorSynthesisBrief({
          companyType: classification(primaryTypeMap[family]),
          sector: undefined,
          industry: industryMap[family],
        });
      });

      it("has correct sectorFamily", () => {
        expect(brief.sectorFamily).toBe(family);
      });

      it("has non-empty growthDrivers", () => {
        expect(brief.growthDrivers.length).toBeGreaterThan(0);
      });

      it("has non-empty riskDrivers", () => {
        expect(brief.riskDrivers.length).toBeGreaterThan(0);
      });

      it("has non-empty keyMetricsToWatch", () => {
        expect(brief.keyMetricsToWatch.length).toBeGreaterThan(0);
      });
    });
  }
});

describe("buildSectorSynthesisBrief – financial_bank specific", () => {
  const brief = buildSectorSynthesisBrief({
    companyType: classification("financial"),
    sector: "Financials",
    industry: "Diversified Banks",
  });

  it("includes P/TBV in primary valuation logic", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("P/TBV");
  });

  it("includes ROTCE in primary valuation logic", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("ROTCE");
  });

  it("includes CET1 in primary valuation logic", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("CET1");
  });

  it("includes NIM in primary valuation logic", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("NIM");
  });

  it("includes CET1 in keyMetricsToWatch", () => {
    expect(brief.keyMetricsToWatch).toContain("CET1 ratio");
  });

  it("marks generic FCFF DCF as weak", () => {
    expect(brief.weakValuationMethods.join(" ")).toContain("FCFF DCF");
  });

  it("has required disclosure about bank valuation", () => {
    expect(brief.requiredDisclosures.join(" ")).toContain("P/TBV");
  });
});

describe("buildSectorSynthesisBrief – reit specific", () => {
  const brief = buildSectorSynthesisBrief({
    companyType: classification("reit"),
    sector: "Real Estate",
    industry: "Industrial REIT",
  });

  it("includes AFFO in primary valuation logic", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("AFFO");
  });

  it("includes NAV in primary valuation logic", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("NAV");
  });

  it("includes occupancy in keyMetricsToWatch", () => {
    expect(brief.keyMetricsToWatch.join(" ")).toContain("ccupancy");
  });

  it("includes cap rates in keyMetricsToWatch", () => {
    expect(brief.keyMetricsToWatch.join(" ")).toMatch(/cap rates/i);
  });

  it("marks generic FCFF DCF as weak", () => {
    expect(brief.weakValuationMethods.join(" ")).toContain("DCF");
  });
});

describe("buildSectorSynthesisBrief – commodity_energy specific", () => {
  const brief = buildSectorSynthesisBrief({
    companyType: classification("commodity_cyclical"),
    sector: "Energy",
    industry: "Oil & Gas",
  });

  it("includes mid-cycle FCF in primary valuation logic", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("mid-cycle");
  });

  it("includes commodity price scenarios", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("scenario");
  });

  it("includes dividend/buyback coverage in valuation logic", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("coverage");
  });

  it("warns about peak commodity extrapolation", () => {
    expect([...brief.requiredDisclosures, ...brief.synthesisWarnings].join(" ")).toContain("peak");
  });
});

describe("buildSectorSynthesisBrief – technology_platform specific", () => {
  const brief = buildSectorSynthesisBrief({
    companyType: classification("platform_conglomerate"),
  });

  it("includes segment/SOTP valuation logic", () => {
    expect(brief.primaryValuationLogic.join(" ")).toContain("SOTP");
  });

  it("includes cloud growth driver", () => {
    expect(brief.growthDrivers.join(" ")).toMatch(/cloud/i);
  });

  it("includes advertising growth driver", () => {
    expect(brief.growthDrivers.join(" ")).toMatch(/advertis/i);
  });

  it("warns about segment data missing", () => {
    expect([...brief.requiredDisclosures, ...brief.synthesisWarnings].join(" ")).toContain("segment");
  });
});

describe("buildSectorSynthesisBrief – quality_compounder specific", () => {
  const brief = buildSectorSynthesisBrief({
    companyType: classification("quality_compounder"),
  });

  it("includes moat/capital allocation in valuation logic", () => {
    expect([...brief.primaryValuationLogic, ...brief.growthDrivers].join(" ").toLowerCase()).toContain("moat");
  });

  it("includes buyback or FCF logic", () => {
    const allText = [...brief.cashFlowDrivers, ...brief.keyMetricsToWatch].join(" ");
    expect(allText.toLowerCase()).toMatch(/buyback|fcf/);
  });

  it("warns about expensive valuation not being automatic Sell", () => {
    expect(brief.requiredDisclosures.join(" ").toLowerCase()).toContain("sell");
  });
});

describe("buildSectorSynthesisBrief – cyclical_hardware specific", () => {
  const brief = buildSectorSynthesisBrief({
    companyType: classification("cyclical_hardware"),
  });

  it("includes inventory in keyMetricsToWatch", () => {
    expect(brief.keyMetricsToWatch.join(" ").toLowerCase()).toContain("inventory");
  });

  it("includes working capital in risk drivers", () => {
    const allText = [...brief.riskDrivers, ...brief.synthesisWarnings].join(" ");
    expect(allText.toLowerCase()).toContain("working capital");
  });

  it("includes gross margin in key metrics", () => {
    expect(brief.keyMetricsToWatch.join(" ").toLowerCase()).toContain("gross margin");
  });

  it("warns about DCF terminal value sensitivity", () => {
    expect([...brief.requiredDisclosures, ...brief.synthesisWarnings].join(" ").toLowerCase()).toContain("terminal value");
  });
});

// ─── buildStructuredSynthesisInput tests ─────────────────────────────────────

describe("buildStructuredSynthesisInput", () => {
  it("includes modelSelectionSummary", () => {
    const input = structuredInput("quality_compounder");
    expect(input.modelSelectionSummary).toBeDefined();
    expect(Array.isArray(input.modelSelectionSummary.primaryModels)).toBe(true);
    expect(Array.isArray(input.modelSelectionSummary.missingButRecommendedModels)).toBe(true);
  });

  it("includes sectorBrief", () => {
    const input = structuredInput("quality_compounder");
    expect(input.sectorBrief).toBeDefined();
    expect(input.sectorBrief.sectorFamily).toBe("quality_compounder");
    expect(input.sectorBrief.growthDrivers.length).toBeGreaterThan(0);
  });

  it("synthesisInstructions includes do not calculate new fair values", () => {
    const input = structuredInput("financial", "Financials", "Banks");
    expect(input.synthesisInstructions.join(" ")).toMatch(/do not calculate new fair values/i);
  });

  it("synthesisInstructions includes sector-specific growth_outlook", () => {
    const input = structuredInput("quality_compounder");
    expect(input.synthesisInstructions.join(" ")).toMatch(/sector-specific growth_outlook/i);
  });

  it("synthesisInstructions includes do not invent missing sector metrics", () => {
    const input = structuredInput("reit");
    expect(input.synthesisInstructions.join(" ")).toMatch(/do not invent missing sector metrics/i);
  });

  it("synthesisInstructions includes integers 1 to 5", () => {
    const input = structuredInput("quality_compounder");
    expect(input.synthesisInstructions.join(" ")).toMatch(/1 to 5/);
  });

  it("limitations include relevant model-fit disclosures", () => {
    const input = structuredInput("financial", "Financials", "Banks");
    // bank_valuation is planned → should appear in missingButRecommended → limitations
    expect(input.limitations.length).toBeGreaterThan(0);
  });

  it("limitations include REIT required disclosures", () => {
    const input = structuredInput("reit", "Real Estate", "Industrial REIT");
    const allText = input.limitations.join(" ");
    expect(allText.length).toBeGreaterThan(0);
  });

  it("prefers sector-specific growth_outlook instruction over generic fallback", () => {
    const input = structuredInput("financial", "Financials", "Banks");
    const instructions = input.synthesisInstructions.join(" ");
    // Primary instruction is to use sector-specific growth_outlook
    expect(instructions).toMatch(/sector-specific growth_outlook/i);
    // The fallback instruction must be conditional, not unconditional
    expect(instructions).toMatch(/fallback only when/i);
  });

  it("includes merged thesis triggers from sector brief", () => {
    const input = buildStructuredSynthesisInput({
      ticker: "TEST",
      companyType: classification("quality_compounder"),
      modelSelectionPlan: planFor("quality_compounder"),
      thesisChangeTriggers: {
        bullishTriggers: ["Custom bullish trigger"],
        bearishTriggers: ["Custom bearish trigger"],
        keyMetricsToWatch: ["Custom metric"],
      },
    });
    expect(input.thesisChangeTriggers?.bullishTriggers).toContain("Custom bullish trigger");
    // Also has sector brief triggers merged in
    expect(input.thesisChangeTriggers?.bullishTriggers.length).toBeGreaterThan(1);
  });

  it("works without a model selection plan", () => {
    const input = buildStructuredSynthesisInput({
      ticker: "TEST",
      companyType: classification("quality_compounder"),
      modelSelectionPlan: null,
    });
    expect(input.modelSelectionSummary.primaryModels).toEqual([]);
    expect(input.modelSelectionSummary.limitations).toContain("Model selection plan is not available.");
  });
});

// ─── Regression fixtures ──────────────────────────────────────────────────────

describe("regression fixtures", () => {
  it("Apple-like: quality_compounder → quality_compounder sector family", () => {
    const input = structuredInput("quality_compounder", "Technology", "Consumer Electronics");
    expect(input.sectorBrief.sectorFamily).toBe("quality_compounder");
    expect(input.synthesisInstructions.join(" ")).toMatch(/do not calculate new fair values/i);
  });

  it("Amazon-like: platform_conglomerate → technology_platform", () => {
    const input = structuredInput("platform_conglomerate", "Technology", "Internet Retail");
    expect(input.sectorBrief.sectorFamily).toBe("technology_platform");
    expect(input.sectorBrief.primaryValuationLogic.join(" ")).toContain("SOTP");
    expect(input.modelSelectionSummary.missingButRecommendedModels).toContain("platform_sotp");
  });

  it("SMCI-like: cyclical_hardware → cyclical_hardware", () => {
    const input = structuredInput("cyclical_hardware", "Technology", "Computer Hardware");
    expect(input.sectorBrief.sectorFamily).toBe("cyclical_hardware");
    expect(input.sectorBrief.synthesisWarnings.join(" ").toLowerCase()).toContain("inventory");
    expect(input.modelSelectionSummary.missingButRecommendedModels).toContain("cyclical_hardware_normalized");
  });

  it("JPM-like: financial/bank → financial_bank", () => {
    const input = structuredInput("financial", "Financials", "Diversified Banks");
    expect(input.sectorBrief.sectorFamily).toBe("financial_bank");
    expect(input.sectorBrief.primaryValuationLogic.join(" ")).toContain("P/TBV");
    expect(input.sectorBrief.primaryValuationLogic.join(" ")).toContain("CET1");
    expect(input.modelSelectionSummary.weakOrDisabledModels.length).toBeGreaterThan(0);
    expect(input.limitations.length).toBeGreaterThan(0);
  });

  it("PLD-like: reit → reit", () => {
    const input = structuredInput("reit", "Real Estate", "Industrial REIT");
    expect(input.sectorBrief.sectorFamily).toBe("reit");
    expect(input.sectorBrief.primaryValuationLogic.join(" ")).toContain("AFFO");
    expect(input.sectorBrief.primaryValuationLogic.join(" ")).toContain("NAV");
    expect(input.modelSelectionSummary.missingButRecommendedModels).toContain("reit_affo_nav");
  });

  it("XOM-like: commodity_cyclical/energy → commodity_energy", () => {
    const input = structuredInput("commodity_cyclical", "Energy", "Oil & Gas Integrated");
    expect(input.sectorBrief.sectorFamily).toBe("commodity_energy");
    expect(input.sectorBrief.primaryValuationLogic.join(" ")).toContain("mid-cycle");
    expect([...input.sectorBrief.requiredDisclosures, ...input.sectorBrief.synthesisWarnings].join(" ").toLowerCase()).toContain("peak");
    expect(input.modelSelectionSummary.missingButRecommendedModels).toContain("commodity_energy_midcycle");
  });
});

// ─── formatStructuredBriefingForPrompt tests ─────────────────────────────────

describe("formatStructuredBriefingForPrompt", () => {
  it("includes sector family in output", () => {
    const input = structuredInput("financial", "Financials", "Banks");
    const prompt = formatStructuredBriefingForPrompt(input);
    expect(prompt).toContain("financial_bank");
  });

  it("includes model selection summary", () => {
    const input = structuredInput("platform_conglomerate", "Technology", "Internet Retail");
    const prompt = formatStructuredBriefingForPrompt(input);
    expect(prompt).toContain("platform_sotp");
  });

  it("includes growth drivers", () => {
    const input = structuredInput("reit", "Real Estate", "Industrial REIT");
    const prompt = formatStructuredBriefingForPrompt(input);
    expect(prompt.toLowerCase()).toContain("wachstum");
  });

  it("includes risk drivers", () => {
    const input = structuredInput("cyclical_hardware", "Technology", "Computer Hardware");
    const prompt = formatStructuredBriefingForPrompt(input);
    expect(prompt.toLowerCase()).toContain("risiko");
  });

  it("includes required disclosures for bank", () => {
    const input = structuredInput("financial", "Financials", "Banks");
    const prompt = formatStructuredBriefingForPrompt(input);
    expect(prompt).toContain("P/TBV");
  });

  it("produces non-empty output for all sector families", () => {
    const types: Array<CompanyTypeClassification["primaryType"]> = [
      "quality_compounder", "platform_conglomerate", "cyclical_hardware", "hypergrowth_software",
      "financial", "reit", "commodity_cyclical", "industrial_cyclical", "unknown",
    ];
    for (const type of types) {
      const input = structuredInput(type);
      const prompt = formatStructuredBriefingForPrompt(input);
      expect(prompt.length).toBeGreaterThan(50);
    }
  });

  it("marks missing models with max-medium valuation_confidence note", () => {
    const input = structuredInput("reit", "Real Estate", "REIT");
    const prompt = formatStructuredBriefingForPrompt(input);
    expect(prompt).toMatch(/medium/i);
  });

  it("labels weak methods explicitly in briefing output", () => {
    const input = structuredInput("financial", "Financials", "Banks");
    const prompt = formatStructuredBriefingForPrompt(input);
    expect(prompt).toMatch(/SCHWACHE METHODEN/);
  });

  it("labels missing models explicitly in briefing output", () => {
    const input = structuredInput("reit", "Real Estate", "REIT");
    const prompt = formatStructuredBriefingForPrompt(input);
    expect(prompt).toMatch(/FEHLENDE EMPFOHLENE MODELLE/);
  });
});

// ─── buildGrowthOutlookRequirements tests ──────────────────────────────────────

describe("buildGrowthOutlookRequirements", () => {
  it("returns required topics for reit", () => {
    const result = buildGrowthOutlookRequirements("reit", [], true, true);
    expect(result).toMatch(/AFFO/i);
    expect(result).toMatch(/Belegungsgrad|Occupancy/i);
  });

  it("returns required topics for financial_bank", () => {
    const result = buildGrowthOutlookRequirements("financial_bank", [], true, true);
    expect(result).toMatch(/NIM/);
    expect(result).toMatch(/ROTCE/);
    expect(result).toMatch(/CET1/);
  });

  it("allows generic fallback only for unknown sector", () => {
    const result = buildGrowthOutlookRequirements("unknown", [], false, false);
    expect(result).toMatch(/Fallback/i);
  });

  it("includes missing models in requirement text", () => {
    const result = buildGrowthOutlookRequirements("reit", ["reit_affo_nav"], true, true);
    expect(result).toContain("reit_affo_nav");
  });

  it("forbids generic fallback when drivers exist for reit", () => {
    const result = buildGrowthOutlookRequirements("reit", [], true, true);
    expect(result).toMatch(/verboten/i);
  });
});

// ─── buildSectorSpecificSynthesisTemplate tests ────────────────────────────────

describe("buildSectorSpecificSynthesisTemplate", () => {
  it("includes sector name header", () => {
    const brief = buildSectorSynthesisBrief({ companyType: classification("reit") });
    const sel = { primaryModels: [], secondaryModels: [], weakOrDisabledModels: ["dcf_scenarios"], missingButRecommendedModels: ["reit_affo_nav"], warnings: [], limitations: [] };
    const result = buildSectorSpecificSynthesisTemplate(brief, sel);
    expect(result).toMatch(/REIT/i);
  });

  it("includes AFFO and NAV valuation obligations for reit", () => {
    const brief = buildSectorSynthesisBrief({ companyType: classification("reit") });
    const sel = { primaryModels: [], secondaryModels: [], weakOrDisabledModels: [], missingButRecommendedModels: ["reit_affo_nav"], warnings: [], limitations: [] };
    const result = buildSectorSpecificSynthesisTemplate(brief, sel);
    expect(result).toMatch(/AFFO/);
    expect(result).toMatch(/NAV/);
  });

  it("marks reit_affo_nav as missing with valuation confidence cap", () => {
    const brief = buildSectorSynthesisBrief({ companyType: classification("reit") });
    const sel = { primaryModels: [], secondaryModels: [], weakOrDisabledModels: [], missingButRecommendedModels: ["reit_affo_nav"], warnings: [], limitations: [] };
    const result = buildSectorSpecificSynthesisTemplate(brief, sel);
    expect(result).toContain("reit_affo_nav");
    expect(result).toMatch(/medium/i);
  });

  it("forbids generic DCF as primary for financial_bank", () => {
    const brief = buildSectorSynthesisBrief({ companyType: classification("financial"), industry: "Banks" });
    const sel = { primaryModels: [], secondaryModels: [], weakOrDisabledModels: ["dcf_scenarios"], missingButRecommendedModels: ["bank_valuation"], warnings: [], limitations: [] };
    const result = buildSectorSpecificSynthesisTemplate(brief, sel);
    expect(result).toMatch(/P\/TBV/);
    expect(result).toMatch(/ROTCE/);
    expect(result).toMatch(/CET1/);
  });

  it("includes growth_outlook required topics", () => {
    const brief = buildSectorSynthesisBrief({ companyType: classification("reit") });
    const sel = { primaryModels: [], secondaryModels: [], weakOrDisabledModels: [], missingButRecommendedModels: [], warnings: [], limitations: [] };
    const result = buildSectorSpecificSynthesisTemplate(brief, sel);
    expect(result).toMatch(/GROWTH_OUTLOOK/);
    expect(result).toMatch(/AFFO/);
  });

  it("includes bull and bear case required topics for reit", () => {
    const brief = buildSectorSynthesisBrief({ companyType: classification("reit") });
    const sel = { primaryModels: [], secondaryModels: [], weakOrDisabledModels: [], missingButRecommendedModels: [], warnings: [], limitations: [] };
    const result = buildSectorSpecificSynthesisTemplate(brief, sel);
    expect(result).toMatch(/BULL CASE/);
    expect(result).toMatch(/BEAR CASE/);
    expect(result).toMatch(/Cap-Rate/i);
  });
});

// ─── buildGrowthOutlookToolDescription tests ──────────────────────────────────

describe("buildGrowthOutlookToolDescription", () => {
  it("includes sector-specific topics for reit", () => {
    const input = structuredInput("reit", "Real Estate", "REIT");
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/AFFO/);
    expect(desc).toMatch(/Belegungsgrad|Occupancy/i);
  });

  it("includes sector-specific topics for financial_bank", () => {
    const input = structuredInput("financial", "Financials", "Banks");
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/NIM/);
    expect(desc).toMatch(/ROTCE/);
    expect(desc).toMatch(/CET1/);
  });

  it("forbids generic fallback when sector has topics", () => {
    const input = structuredInput("reit", "Real Estate", "REIT");
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/verboten/i);
  });

  it("includes fallback text for unknown sector", () => {
    const input = structuredInput("unknown");
    const desc = buildGrowthOutlookToolDescription(input, "Fallback-Placeholder");
    expect(desc).toContain("Fallback-Placeholder");
  });

  it("includes missing model reminder", () => {
    const input = structuredInput("reit", "Real Estate", "REIT");
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toContain("reit_affo_nav");
  });
});

// ─── formatSectorSynthesisTemplate tests ──────────────────────────────────────

describe("formatSectorSynthesisTemplate", () => {
  it("produces non-empty output for reit", () => {
    const input = structuredInput("reit", "Real Estate", "REIT");
    const result = formatSectorSynthesisTemplate(input);
    expect(result.length).toBeGreaterThan(100);
    expect(result).toMatch(/REIT/i);
  });

  it("produces non-empty output for financial_bank", () => {
    const input = structuredInput("financial", "Financials", "Banks");
    const result = formatSectorSynthesisTemplate(input);
    expect(result.length).toBeGreaterThan(100);
  });
});

// ─── Realty Income-like regression fixture ────────────────────────────────────

describe("Realty Income-like (REIT) regression", () => {
  let input: ReturnType<typeof structuredInput>;

  beforeEach(() => {
    input = structuredInput("reit", "Real Estate", "Retail REIT");
  });

  it("sector family is reit", () => {
    expect(input.sectorBrief.sectorFamily).toBe("reit");
  });

  it("growth_outlook requirements contain AFFO", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/AFFO/);
  });

  it("growth_outlook requirements contain occupancy", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/Belegungsgrad|[Oo]ccupancy/);
  });

  it("growth_outlook requirements contain rent growth", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/Mietpreis|[Rr]ent/);
  });

  it("growth_outlook requirements contain interest rate sensitivity", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/Zinssensitivit|[Ii]nterest/);
  });

  it("generic fallback is forbidden", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/verboten/i);
  });

  it("reit_affo_nav is in missingButRecommendedModels", () => {
    expect(input.modelSelectionSummary.missingButRecommendedModels).toContain("reit_affo_nav");
  });

  it("sector template mentions valuation confidence cap for missing AFFO/NAV model", () => {
    const template = formatSectorSynthesisTemplate(input);
    expect(template).toContain("reit_affo_nav");
    expect(template).toMatch(/medium/i);
  });

  it("sector template forbids generic DCF as primary", () => {
    const template = formatSectorSynthesisTemplate(input);
    expect(template).toMatch(/DCF/);
  });

  it("briefing marks reit_affo_nav as missing", () => {
    const briefing = formatStructuredBriefingForPrompt(input);
    expect(briefing).toContain("reit_affo_nav");
    expect(briefing).toMatch(/FEHLENDE EMPFOHLENE MODELLE/);
  });

  it("briefing labels DCF as weak method", () => {
    const briefing = formatStructuredBriefingForPrompt(input);
    expect(briefing).toMatch(/SCHWACHE METHODEN/);
  });

  it("synthesis instructions forbid generic fallback when REIT drivers exist", () => {
    const instructions = input.synthesisInstructions.join(" ");
    expect(instructions).toMatch(/sector-specific growth_outlook/i);
    expect(instructions).toMatch(/forbidden|verboten/i);
  });
});

// ─── Goldman Sachs-like regression fixture ────────────────────────────────────

describe("Goldman Sachs-like (financial_bank) regression", () => {
  let input: ReturnType<typeof structuredInput>;

  beforeEach(() => {
    input = structuredInput("financial", "Financials", "Investment Banking & Brokerage");
  });

  it("sector family is financial_bank", () => {
    expect(input.sectorBrief.sectorFamily).toBe("financial_bank");
  });

  it("growth_outlook requirements contain capital markets / investment banking", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/Kapitalmarkt|[Ii]nvestment [Bb]anking/);
  });

  it("growth_outlook requirements contain NIM", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/NIM/);
  });

  it("growth_outlook requirements contain ROTCE", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/ROTCE/);
  });

  it("growth_outlook requirements contain CET1", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/CET1/);
  });

  it("generic fallback is forbidden", () => {
    const desc = buildGrowthOutlookToolDescription(input, "Fallback");
    expect(desc).toMatch(/verboten/i);
  });

  it("bank_valuation is in missingButRecommendedModels", () => {
    expect(input.modelSelectionSummary.missingButRecommendedModels).toContain("bank_valuation");
  });

  it("sector template includes P/TBV and ROTCE obligations", () => {
    const template = formatSectorSynthesisTemplate(input);
    expect(template).toMatch(/P\/TBV/);
    expect(template).toMatch(/ROTCE/);
  });

  it("sector template marks bank_valuation as missing with confidence cap", () => {
    const template = formatSectorSynthesisTemplate(input);
    expect(template).toContain("bank_valuation");
    expect(template).toMatch(/medium/i);
  });

  it("sector template forbids generic FCFF DCF as primary", () => {
    const template = formatSectorSynthesisTemplate(input);
    expect(template).toMatch(/FCFF.{0,30}DCF/i);
  });

  it("briefing marks bank_valuation as missing", () => {
    const briefing = formatStructuredBriefingForPrompt(input);
    expect(briefing).toContain("bank_valuation");
    expect(briefing).toMatch(/FEHLENDE EMPFOHLENE MODELLE/);
  });

  it("briefing labels generic DCF as weak for banks", () => {
    const briefing = formatStructuredBriefingForPrompt(input);
    expect(briefing).toMatch(/SCHWACHE METHODEN/);
    expect(briefing).toMatch(/DCF/);
  });

  it("limitations include required bank disclosures", () => {
    expect(input.limitations.join(" ")).toMatch(/P\/TBV|ROTCE|bank/i);
  });
});
