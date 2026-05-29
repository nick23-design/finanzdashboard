import { calculateReitAffoNav, type ReitAffoNavInput, type ReitAffoNavOutput } from "./reit-affo-nav";
import { calculateBankValuation, type BankValuationInput, type BankValuationOutput } from "./bank-valuation";
import { calculateCommodityEnergyMidcycle, type CommodityEnergyMidcycleInput, type CommodityEnergyMidcycleOutput } from "./commodity-energy-midcycle";

// ─── Union output type ────────────────────────────────────────────────────────

export type SpecializedModelOutput =
  | ReitAffoNavOutput
  | BankValuationOutput
  | CommodityEnergyMidcycleOutput;

// ─── Specialized valuation results container ──────────────────────────────────

export type SpecializedValuations = {
  reitAffoNav?: ReitAffoNavOutput;
  bankValuation?: BankValuationOutput;
  commodityEnergyMidcycle?: CommodityEnergyMidcycleOutput;
};

// ─── Re-exports for convenience ────────────────────────────────────────────────

export type { ReitAffoNavInput, ReitAffoNavOutput } from "./reit-affo-nav";
export type { BankValuationInput, BankValuationOutput } from "./bank-valuation";
export type { CommodityEnergyMidcycleInput, CommodityEnergyMidcycleOutput } from "./commodity-energy-midcycle";

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
  }

  return lines.filter(Boolean).join("\n");
}
