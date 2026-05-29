import { calculateReitAffoNav, type ReitAffoNavInput, type ReitAffoNavOutput } from "./reit-affo-nav";
import { calculateBankValuation, type BankValuationInput, type BankValuationOutput } from "./bank-valuation";
import { calculateCommodityEnergyMidcycle, type CommodityEnergyMidcycleInput, type CommodityEnergyMidcycleOutput } from "./commodity-energy-midcycle";
import { calculatePlatformSotp, type PlatformSotpInput, type PlatformSotpOutput } from "./platform-sotp";
import { calculateCyclicalHardwareNormalized, type CyclicalHardwareNormalizedInput, type CyclicalHardwareNormalizedOutput } from "./cyclical-hardware-normalized";
import { calculateSoftwareRuleOf40, type SoftwareRuleOf40Input, type SoftwareRuleOf40Output } from "./software-rule-of-40";
import { calculateSemiconductorCycle, type SemiconductorCycleInput, type SemiconductorCycleOutput } from "./semiconductor-cycle";
import { calculateAiExposureNarrativeScore, type AiExposureNarrativeInput, type AiExposureNarrativeOutput } from "./ai-exposure-narrative-score";

// ─── Union output type ────────────────────────────────────────────────────────

export type SpecializedModelOutput =
  | ReitAffoNavOutput
  | BankValuationOutput
  | CommodityEnergyMidcycleOutput
  | PlatformSotpOutput
  | CyclicalHardwareNormalizedOutput
  | SoftwareRuleOf40Output
  | SemiconductorCycleOutput
  | AiExposureNarrativeOutput;

// ─── Specialized valuation results container ──────────────────────────────────

export type SpecializedValuations = {
  reitAffoNav?: ReitAffoNavOutput;
  bankValuation?: BankValuationOutput;
  commodityEnergyMidcycle?: CommodityEnergyMidcycleOutput;
  platformSotp?: PlatformSotpOutput;
  cyclicalHardwareNormalized?: CyclicalHardwareNormalizedOutput;
  softwareRuleOf40?: SoftwareRuleOf40Output;
  semiconductorCycle?: SemiconductorCycleOutput;
  aiExposureNarrative?: AiExposureNarrativeOutput;
};

// ─── Re-exports for convenience ────────────────────────────────────────────────

export type { ReitAffoNavInput, ReitAffoNavOutput } from "./reit-affo-nav";
export type { BankValuationInput, BankValuationOutput } from "./bank-valuation";
export type { CommodityEnergyMidcycleInput, CommodityEnergyMidcycleOutput } from "./commodity-energy-midcycle";
export type { PlatformSotpInput, PlatformSotpOutput } from "./platform-sotp";
export type { CyclicalHardwareNormalizedInput, CyclicalHardwareNormalizedOutput } from "./cyclical-hardware-normalized";
export type { SoftwareRuleOf40Input, SoftwareRuleOf40Output } from "./software-rule-of-40";
export type { SemiconductorCycleInput, SemiconductorCycleOutput } from "./semiconductor-cycle";
export type { AiExposureNarrativeInput, AiExposureNarrativeOutput } from "./ai-exposure-narrative-score";

// ─── Runner ───────────────────────────────────────────────────────────────────

export function runReitAffoNav(input: ReitAffoNavInput): ReitAffoNavOutput {
  try {
    return calculateReitAffoNav(input);
  } catch {
    return {
      modelId: "reit_affo_nav",
      status: "failed",
      valuation: {},
      qualitySignals: {},
      confidence: 1,
      warnings: [],
      limitations: ["REIT AFFO/NAV model failed due to unexpected error."],
    };
  }
}

export function runBankValuation(input: BankValuationInput): BankValuationOutput {
  try {
    return calculateBankValuation(input);
  } catch {
    return {
      modelId: "bank_valuation",
      status: "failed",
      valuation: {},
      profitabilitySignals: {},
      capitalAndCreditSignals: {},
      businessMixSignals: {},
      confidence: 1,
      warnings: [],
      limitations: ["Bank valuation model failed due to unexpected error."],
    };
  }
}

export function runCommodityEnergyMidcycle(input: CommodityEnergyMidcycleInput): CommodityEnergyMidcycleOutput {
  try {
    return calculateCommodityEnergyMidcycle(input);
  } catch {
    return {
      modelId: "commodity_energy_midcycle",
      status: "failed",
      valuation: {},
      shareholderReturnSignals: {},
      cycleSignals: {},
      confidence: 1,
      warnings: [],
      limitations: ["Commodity energy mid-cycle model failed due to unexpected error."],
    };
  }
}

export function runPlatformSotp(input: PlatformSotpInput): PlatformSotpOutput {
  try {
    return calculatePlatformSotp(input);
  } catch {
    return {
      modelId: "platform_sotp",
      status: "failed",
      valuation: { segmentValues: [] },
      confidence: 1,
      warnings: [],
      limitations: ["Platform SOTP model failed due to unexpected error."],
    };
  }
}

export function runCyclicalHardwareNormalized(input: CyclicalHardwareNormalizedInput): CyclicalHardwareNormalizedOutput {
  try {
    return calculateCyclicalHardwareNormalized(input);
  } catch {
    return {
      modelId: "cyclical_hardware_normalized",
      status: "failed",
      valuation: {},
      cycleSignals: {
        marginRisk: "moderate",
        workingCapitalRisk: "moderate",
        inventoryRisk: "moderate",
        customerConcentrationRisk: "moderate",
        fcfConversionAssessment: "weak",
      },
      confidence: 1,
      warnings: [],
      limitations: ["Cyclical hardware normalized model failed due to unexpected error."],
    };
  }
}

export function runSoftwareRuleOf40(input: SoftwareRuleOf40Input): SoftwareRuleOf40Output {
  try {
    return calculateSoftwareRuleOf40(input);
  } catch {
    return {
      modelId: "software_rule_of_40",
      status: "failed",
      scores: { growthScore: 0, profitabilityScore: 0, dilutionPenalty: 0 },
      valuationContext: { valuationState: "unknown" },
      qualitySignals: {
        growthDurability: "weak",
        profitabilityPath: "weak",
        retentionQuality: "unknown",
        dilutionRisk: "moderate",
      },
      confidence: 1,
      warnings: [],
      limitations: ["Software Rule of 40 model failed due to unexpected error."],
    };
  }
}

export function runSemiconductorCycle(input: SemiconductorCycleInput): SemiconductorCycleOutput {
  try {
    return calculateSemiconductorCycle(input);
  } catch {
    return {
      modelId: "semiconductor_cycle",
      status: "failed",
      cycleSignals: {
        structuralGrowthExposure: "low",
        memoryCycleRisk: "low",
        inventoryCycleRisk: "low",
        marginNormalizationRisk: "low",
        customerConcentrationRisk: "low",
      },
      valuationContext: { valuationState: "unknown" },
      confidence: 1,
      warnings: [],
      limitations: ["Semiconductor cycle model failed due to unexpected error."],
    };
  }
}

export function runAiExposureNarrativeScore(input: AiExposureNarrativeInput): AiExposureNarrativeOutput {
  try {
    return calculateAiExposureNarrativeScore(input);
  } catch {
    return {
      modelId: "ai_exposure_narrative_score",
      status: "failed",
      category: "unknown",
      scores: {
        aiExposureScore: 0,
        monetizationEvidenceScore: 0,
        narrativeRiskScore: 0,
        executionRiskScore: 0,
      },
      classification: {
        exposureLevel: "none",
        monetizationStage: "none",
        narrativeQuality: "weak",
      },
      ratingImplications: {
        canSupportBullCase: false,
        shouldIncreaseValuationConfidence: false,
        shouldDecreaseValuationConfidence: false,
        avoidStrongBuyWithoutProof: false,
        reason: "AI exposure overlay failed.",
      },
      confidence: 1,
      evidence: [],
      warnings: [],
      limitations: ["AI exposure narrative score failed due to unexpected error."],
    };
  }
}

// ─── Prompt formatter ─────────────────────────────────────────────────────────

export function formatSpecializedValuationsForPrompt(sv: SpecializedValuations): string {
  const lines: string[] = [];

  if (sv.reitAffoNav) {
    const m = sv.reitAffoNav;
    lines.push(`REIT AFFO/NAV Modell (Status: ${m.status}):`);
    if (m.status === "success") {
      const v = m.valuation;
      if (v.baseFairValue != null) {
        lines.push(`  Fairer Wert: Bear ${v.bearFairValue ?? "N/A"} / Base ${v.baseFairValue} / Bull ${v.bullFairValue ?? "N/A"}`);
      }
      if (v.affoYieldPct != null) lines.push(`  AFFO-Rendite: ${v.affoYieldPct.toFixed(1)}% | AFFO-Multiple: ${v.impliedAffoMultiple?.toFixed(1) ?? "N/A"}x`);
      if (v.navPremiumDiscountPct != null) lines.push(`  NAV-Prämie/Abschlag: ${v.navPremiumDiscountPct.toFixed(1)}%`);
      if (v.affoPayoutRatioPct != null) lines.push(`  AFFO-Ausschüttungsquote: ${v.affoPayoutRatioPct.toFixed(1)}%`);
      lines.push(`  Konfidenz: ${m.confidence}/5`);
      if (m.warnings.length > 0) lines.push(`  WARNUNGEN: ${m.warnings.slice(0, 2).join(" | ")}`);
      if (m.limitations.length > 0) lines.push(`  Limitierungen: ${m.limitations.slice(0, 2).join(" | ")}`);
      lines.push("  → Nutze AFFO/NAV als primären Bewertungsrahmen. Generic FCFF DCF bleibt schwach/sekundär.");
    } else if (m.status === "not_run_missing_inputs") {
      lines.push("  → Modell empfohlen aber nicht ausführbar: AFFO/NAV-Daten fehlen. Bewertungsüberzeugung reduzieren.");
      if (m.limitations.length > 0) lines.push(`  Fehlende Daten: ${m.limitations.slice(0, 2).join(" | ")}`);
    }
    lines.push("");
  }

  if (sv.bankValuation) {
    const m = sv.bankValuation;
    lines.push(`Bank-Bewertungsmodell (Status: ${m.status}):`);
    if (m.status === "success") {
      const v = m.valuation;
      if (v.baseFairValue != null) {
        lines.push(`  Fairer Wert: Bear ${v.bearFairValue ?? "N/A"} / Base ${v.baseFairValue} / Bull ${v.bullFairValue ?? "N/A"}`);
      }
      if (v.priceToTangibleBook != null) lines.push(`  P/TBV: ${v.priceToTangibleBook.toFixed(2)}x`);
      if (v.priceToBook != null) lines.push(`  P/B: ${v.priceToBook.toFixed(2)}x`);
      const rotce = m.profitabilitySignals.rotceAssessment;
      if (rotce) lines.push(`  ROTCE: ${rotce}`);
      const cet1 = m.capitalAndCreditSignals.cet1Assessment;
      if (cet1) lines.push(`  CET1: ${cet1}`);
      const capMkts = m.businessMixSignals.capitalMarketsAssessment;
      if (capMkts) lines.push(`  Kapitalmarkt-Zyklus: ${capMkts}`);
      lines.push(`  Konfidenz: ${m.confidence}/5`);
      if (m.warnings.filter(w => !w.includes("FCFF")).length > 0) {
        lines.push(`  WARNUNGEN: ${m.warnings.filter(w => !w.includes("FCFF")).slice(0, 2).join(" | ")}`);
      }
      if (m.limitations.length > 0) lines.push(`  Limitierungen: ${m.limitations.slice(0, 2).join(" | ")}`);
      lines.push("  → Nutze P/TBV + ROTCE + CET1 als primären Rahmen. FCFF DCF soll nicht dominieren.");
    } else if (m.status === "not_run_missing_inputs") {
      lines.push("  → Modell empfohlen aber nicht ausführbar: TBV/BV-Daten fehlen. Bewertungsüberzeugung reduzieren.");
      if (m.limitations.length > 0) lines.push(`  Fehlende Daten: ${m.limitations.slice(0, 2).join(" | ")}`);
    }
    lines.push("");
  }

  if (sv.commodityEnergyMidcycle) {
    const m = sv.commodityEnergyMidcycle;
    lines.push(`Commodity-Energie-Midcycle-Modell (Status: ${m.status}):`);
    if (m.status === "success") {
      const v = m.valuation;
      if (v.baseFairValue != null) {
        lines.push(`  Fairer Wert: Bear ${v.bearFairValue ?? "N/A"} / Base ${v.baseFairValue} / Bull ${v.bullFairValue ?? "N/A"}`);
      }
      if (v.fcfYieldPct != null) lines.push(`  FCF-Rendite: ${v.fcfYieldPct.toFixed(1)}%`);
      if (v.evToEbitda != null) lines.push(`  EV/EBITDA: ${v.evToEbitda.toFixed(1)}x`);
      const tsr = m.shareholderReturnSignals.totalShareholderReturnCoveragePct;
      if (tsr != null) lines.push(`  Kapitalrückführung (% des FCF): ${tsr.toFixed(0)}%`);
      lines.push(`  Konfidenz: ${m.confidence}/5`);
      if (m.warnings.filter(w => !w.includes("extrapolate")).length > 0) {
        lines.push(`  WARNUNGEN: ${m.warnings.filter(w => !w.includes("extrapolate")).slice(0, 2).join(" | ")}`);
      }
      if (m.limitations.length > 0) lines.push(`  Limitierungen: ${m.limitations.slice(0, 2).join(" | ")}`);
      lines.push("  → Nutze FCF-Rendite + EV/EBITDA als primären Rahmen. Keine Peak-Cycle-Extrapolation.");
    } else if (m.status === "not_run_missing_inputs") {
      lines.push("  → Modell empfohlen aber nicht ausführbar: FCF/MarketCap oder EV/EBITDA fehlen. Bewertungsüberzeugung reduzieren.");
      if (m.limitations.length > 0) lines.push(`  Fehlende Daten: ${m.limitations.slice(0, 2).join(" | ")}`);
    }
    lines.push("");
  }

  if (sv.platformSotp) {
    const m = sv.platformSotp;
    lines.push(`Platform-SOTP-Modell (Status: ${m.status}):`);
    if (m.status === "success") {
      const v = m.valuation;
      if (v.baseFairValue != null) {
        lines.push(`  Fairer Wert je Aktie: Bear ${v.bearFairValue ?? "N/A"} / Base ${v.baseFairValue} / Bull ${v.bullFairValue ?? "N/A"}`);
      } else if (v.enterpriseValue != null) {
        lines.push(`  Enterprise Value: ${Math.round(v.enterpriseValue).toLocaleString("en-US")}`);
      }
      const valuedSegments = v.segmentValues
        .filter(s => s.method !== "not_valued")
        .slice(0, 4)
        .map(s => `${s.name} (${s.type}, ${s.method}${s.multipleUsed != null ? ` ${s.multipleUsed}x` : ""})`);
      if (valuedSegments.length > 0) lines.push(`  Bewertete Segmente: ${valuedSegments.join(" | ")}`);
      lines.push(`  Konfidenz: ${m.confidence}/5`);
      if (m.warnings.length > 0) lines.push(`  WARNUNGEN: ${m.warnings.slice(0, 2).join(" | ")}`);
      if (m.limitations.length > 0) lines.push(`  Limitierungen: ${m.limitations.slice(0, 2).join(" | ")}`);
      lines.push("  → Für Plattform-Konglomerate SOTP als primären Bewertungsrahmen nutzen; Generic DCF bleibt sekundär.");
    } else if (m.status === "not_run_missing_inputs") {
      lines.push("  → SOTP empfohlen aber nicht ausführbar: Segmentdaten fehlen. Segment-Limitierung explizit nennen.");
      if (m.limitations.length > 0) lines.push(`  Fehlende Daten: ${m.limitations.slice(0, 2).join(" | ")}`);
    }
    lines.push("");
  }

  if (sv.cyclicalHardwareNormalized) {
    const m = sv.cyclicalHardwareNormalized;
    lines.push(`Cyclical-Hardware-Normalized-Modell (Status: ${m.status}):`);
    if (m.status === "success") {
      const v = m.valuation;
      if (v.baseFairValue != null) {
        lines.push(`  Fairer Wert je Aktie: Bear ${v.bearFairValue ?? "N/A"} / Base ${v.baseFairValue} / Bull ${v.bullFairValue ?? "N/A"}`);
      }
      if (v.normalizedOperatingMarginPct != null) lines.push(`  Normalisierte operative Marge: ${v.normalizedOperatingMarginPct.toFixed(1)}%`);
      lines.push(`  Zyklusrisiken: Marge ${m.cycleSignals.marginRisk}, Working Capital ${m.cycleSignals.workingCapitalRisk}, Inventar ${m.cycleSignals.inventoryRisk}, Kundenkonzentration ${m.cycleSignals.customerConcentrationRisk}, FCF-Konversion ${m.cycleSignals.fcfConversionAssessment}`);
      lines.push(`  Konfidenz: ${m.confidence}/5`);
      if (m.warnings.length > 0) lines.push(`  WARNUNGEN: ${m.warnings.slice(0, 3).join(" | ")}`);
      if (m.limitations.length > 0) lines.push(`  Limitierungen: ${m.limitations.slice(0, 2).join(" | ")}`);
      lines.push("  → Nutze normalisierte Margen/Working-Capital-Stress als primären Rahmen; optimistische DCF-Upside nicht dominieren lassen.");
    } else if (m.status === "not_run_missing_inputs") {
      lines.push("  → Modell empfohlen aber nicht ausführbar: Umsatz/Margen- oder Earnings-Basis fehlt.");
      if (m.limitations.length > 0) lines.push(`  Fehlende Daten: ${m.limitations.slice(0, 2).join(" | ")}`);
    }
    lines.push("");
  }

  if (sv.softwareRuleOf40) {
    const m = sv.softwareRuleOf40;
    lines.push(`Software-Rule-of-40-Modell (Status: ${m.status}):`);
    if (m.status === "success") {
      if (m.scores.ruleOf40Score != null) lines.push(`  Rule of 40: ${m.scores.ruleOf40Score.toFixed(1)} (Growth ${m.scores.growthScore.toFixed(1)} + Profitabilität ${m.scores.profitabilityScore.toFixed(1)})`);
      lines.push(`  Qualität: Wachstum ${m.qualitySignals.growthDurability}, Profitabilitätspfad ${m.qualitySignals.profitabilityPath}, Retention ${m.qualitySignals.retentionQuality}, Verwässerung ${m.qualitySignals.dilutionRisk}`);
      lines.push(`  Bewertung: EV/Sales ${m.valuationContext.evToSales ?? "N/A"} · Zustand ${m.valuationContext.valuationState}`);
      lines.push(`  Konfidenz: ${m.confidence}/5`);
      if (m.warnings.length > 0) lines.push(`  WARNUNGEN: ${m.warnings.slice(0, 3).join(" | ")}`);
      if (m.limitations.length > 0) lines.push(`  Limitierungen: ${m.limitations.slice(0, 2).join(" | ")}`);
      lines.push("  → SaaS/Software über Growth-vs-Profitability, Retention und SBC erklären; EV/Sales nie isoliert als Bull-Argument verwenden.");
    } else if (m.status === "not_run_missing_inputs") {
      lines.push("  → Modell empfohlen aber nicht ausführbar: Wachstums- oder Margendaten fehlen.");
      if (m.limitations.length > 0) lines.push(`  Fehlende Daten: ${m.limitations.slice(0, 2).join(" | ")}`);
    }
    lines.push("");
  }

  if (sv.semiconductorCycle) {
    const m = sv.semiconductorCycle;
    lines.push(`Semiconductor-Cycle-Modell (Status: ${m.status}):`);
    if (m.status === "success") {
      lines.push(`  Zyklus/AI-Signale: strukturelles Wachstum ${m.cycleSignals.structuralGrowthExposure}, Memory-Zyklus ${m.cycleSignals.memoryCycleRisk}, Inventar ${m.cycleSignals.inventoryCycleRisk}, Margennormalisierung ${m.cycleSignals.marginNormalizationRisk}, Kundenkonzentration ${m.cycleSignals.customerConcentrationRisk}`);
      if (m.fairValueContext?.baseFairValue != null) {
        lines.push(`  Multiple-Kontext je Aktie: Bear ${m.fairValueContext.bearFairValue ?? "N/A"} / Base ${m.fairValueContext.baseFairValue} / Bull ${m.fairValueContext.bullFairValue ?? "N/A"}`);
      }
      lines.push(`  Bewertung: EV/Sales ${m.valuationContext.evToSales ?? "N/A"} · EV/EBITDA ${m.valuationContext.evToEbitda ?? "N/A"} · P/E ${m.valuationContext.pe ?? "N/A"} · ${m.valuationContext.valuationState}`);
      lines.push(`  Konfidenz: ${m.confidence}/5`);
      if (m.warnings.length > 0) lines.push(`  WARNUNGEN: ${m.warnings.slice(0, 3).join(" | ")}`);
      if (m.limitations.length > 0) lines.push(`  Limitierungen: ${m.limitations.slice(0, 2).join(" | ")}`);
      lines.push("  → Strukturelle AI-/Datacenter-Nachfrage getrennt von Inventar-, Memory- und Margenzyklus bewerten.");
    } else if (m.status === "not_run_missing_inputs") {
      lines.push("  → Modell empfohlen aber nicht ausführbar: Semi-spezifische Zyklus-/Margen-/AI-Daten fehlen.");
      if (m.limitations.length > 0) lines.push(`  Fehlende Daten: ${m.limitations.slice(0, 2).join(" | ")}`);
    }
    lines.push("");
  }

  if (sv.aiExposureNarrative && sv.aiExposureNarrative.status !== "not_applicable") {
    const m = sv.aiExposureNarrative;
    lines.push(`AI-Exposure-Narrative-Overlay (Status: ${m.status}):`);
    if (m.status === "success") {
      lines.push(`  Kategorie: ${m.category} · Exposure ${m.classification.exposureLevel} · Monetarisierung ${m.classification.monetizationStage} · Narrative-Qualität ${m.classification.narrativeQuality}`);
      lines.push(`  Scores: Exposure ${m.scores.aiExposureScore}/100 · Monetarisierung ${m.scores.monetizationEvidenceScore}/100 · Narrative-Risiko ${m.scores.narrativeRiskScore}/100 · Execution-Risiko ${m.scores.executionRiskScore}/100`);
      lines.push(`  Implikation: ${m.ratingImplications.reason}`);
      lines.push(`  Konfidenz: ${m.confidence}/5`);
      if (m.evidence.length > 0) lines.push(`  Evidenz: ${m.evidence.slice(0, 3).join(" | ")}`);
      if (m.warnings.length > 0) lines.push(`  WARNUNGEN: ${m.warnings.slice(0, 3).join(" | ")}`);
      if (m.limitations.length > 0) lines.push(`  Limitierungen: ${m.limitations.slice(0, 2).join(" | ")}`);
      lines.push("  → AI ist Overlay/Diagnose, KEIN Bewertungsmodell und KEIN automatisches Kaufsignal. Monetarisierte AI stärkt Bull-Case; narrative AI ohne Umsatz erhöht Risiko.");
    } else if (m.status === "not_run_missing_inputs") {
      lines.push("  → AI-Relevanz erkennbar, aber Evidenz fehlt. AI nicht rating-erhöhend verwenden.");
      if (m.limitations.length > 0) lines.push(`  Fehlende Daten: ${m.limitations.slice(0, 2).join(" | ")}`);
    }
  }

  return lines.filter(Boolean).join("\n");
}
