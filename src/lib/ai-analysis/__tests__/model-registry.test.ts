import {
  MODEL_REGISTRY,
  getModelById,
  type AnalysisModelId,
} from "../model-registry";

const CORE_IMPLEMENTED_IDS: AnalysisModelId[] = [
  "relative_valuation",
  "dcf_scenarios",
  "reverse_dcf",
  "quality_score",
  "moat_score",
  "capital_allocation_score",
  "momentum_score",
  "revision_momentum",
  "risk_score",
  "valuation_divergence",
  "dcf_plausibility",
  "reverse_dcf_plausibility",
];

const PLANNED_SECTOR_IDS: AnalysisModelId[] = [
  "bank_valuation",
  "insurance_underwriting",
  "reit_affo_nav",
  "commodity_energy_midcycle",
  "commodity_mining_midcycle",
  "software_rule_of_40",
  "semiconductor_cycle",
  "cyclical_hardware_normalized",
  "platform_sotp",
  "healthcare_pharma_pipeline",
  "healthcare_medtech_procedure_volume",
  "utilities_regulated_asset_base",
  "telecom_fcf_leverage",
  "industrial_normalized_earnings",
  "consumer_staples_defensive",
  "consumer_discretionary_cycle",
  "transportation_logistics_cycle",
];

describe("MODEL_REGISTRY", () => {
  it("contains all expected core model IDs", () => {
    const ids = MODEL_REGISTRY.map(e => e.id);
    for (const id of CORE_IMPLEMENTED_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("contains all planned sector-specific model IDs", () => {
    const ids = MODEL_REGISTRY.map(e => e.id);
    for (const id of PLANNED_SECTOR_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("marks core models as implemented (not planned)", () => {
    for (const id of CORE_IMPLEMENTED_IDS) {
      const entry = getModelById(id);
      expect(entry).toBeDefined();
      expect(["implemented", "partially_implemented"]).toContain(entry!.implementationStatus);
    }
  });

  it("marks sector-specific models as planned", () => {
    for (const id of PLANNED_SECTOR_IDS) {
      const entry = getModelById(id);
      expect(entry).toBeDefined();
      expect(entry!.implementationStatus).toBe("planned");
    }
  });

  it("all entries have non-empty label and description", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("all entries have at least one applicable company type", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(entry.applicableCompanyTypes.length).toBeGreaterThan(0);
    }
  });

  it("all entries declare requiredInputs and optionalInputs arrays", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(Array.isArray(entry.requiredInputs)).toBe(true);
      expect(Array.isArray(entry.optionalInputs)).toBe(true);
    }
  });

  it("all entries have a valid outputKind", () => {
    const validKinds = ["valuation", "quality", "risk", "momentum", "revision", "diagnostic", "sector_specific", "synthesis_context"];
    for (const entry of MODEL_REGISTRY) {
      expect(validKinds).toContain(entry.outputKind);
    }
  });

  it("bank_valuation is not applicable to quality_compounder", () => {
    const entry = getModelById("bank_valuation");
    expect(entry!.notApplicableCompanyTypes).toContain("quality_compounder");
  });

  it("reit_affo_nav is not applicable to financial", () => {
    const entry = getModelById("reit_affo_nav");
    expect(entry!.notApplicableCompanyTypes).toContain("financial");
  });

  it("dcf_scenarios is not applicable to financial and reit", () => {
    const entry = getModelById("dcf_scenarios");
    expect(entry!.notApplicableCompanyTypes).toContain("financial");
    expect(entry!.notApplicableCompanyTypes).toContain("reit");
  });

  it("getModelById returns the correct entry by ID", () => {
    const entry = getModelById("quality_score");
    expect(entry).toBeDefined();
    expect(entry!.id).toBe("quality_score");
    expect(entry!.implementationStatus).toBe("implemented");
  });

  it("getModelById returns undefined for an unknown ID", () => {
    const entry = getModelById("nonexistent" as AnalysisModelId);
    expect(entry).toBeUndefined();
  });

  it("no duplicate model IDs in the registry", () => {
    const ids = MODEL_REGISTRY.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("platform_sotp requires segment data inputs", () => {
    const entry = getModelById("platform_sotp");
    expect(entry!.requiredInputs).toContain("segments");
    expect(entry!.requiredInputs).toContain("segment_revenue");
  });

  it("bank_valuation requires bank-specific inputs", () => {
    const entry = getModelById("bank_valuation");
    expect(entry!.requiredInputs).toContain("cet1");
    expect(entry!.requiredInputs).toContain("rotce");
    expect(entry!.requiredInputs).toContain("ptbv");
  });

  it("reit_affo_nav requires AFFO and NAV inputs", () => {
    const entry = getModelById("reit_affo_nav");
    expect(entry!.requiredInputs).toContain("affo");
    expect(entry!.requiredInputs).toContain("nav");
  });

  it("commodity_energy_midcycle requires oil/gas and production volume", () => {
    const entry = getModelById("commodity_energy_midcycle");
    expect(entry!.requiredInputs).toContain("oil_price");
    expect(entry!.requiredInputs).toContain("production_volume");
  });
});
