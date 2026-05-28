/**
 * DCF pipeline adapter — bridges dcf.ts to the analysis pipeline.
 * No LLM calls; all deterministic math.
 */

import {
  buildDcfScenarioInputsFromBase,
  calculateDcfScenarios,
  calculateDcfSafe,
  type DcfInput,
  type DcfScenariosOutput,
} from "./dcf";
import type { SectorTemplateKey } from "./valuation-model";
import type { AssetSnapshot } from "@/types/database";
import type { EdgarFacts } from "@/lib/finance-client";

export interface SectorDcfDefaults {
  wacc: number;
  terminalGrowth: number;
  opMargin: number;
  taxRate: number;
  reinvestment: number;
}

export const SECTOR_DCF_DEFAULTS: Record<SectorTemplateKey, SectorDcfDefaults> = {
  mega_cap_cloud_software: { wacc: 0.09, terminalGrowth: 0.03,  opMargin: 0.25, taxRate: 0.20, reinvestment: 0.20 },
  semiconductor:           { wacc: 0.10, terminalGrowth: 0.025, opMargin: 0.22, taxRate: 0.20, reinvestment: 0.25 },
  saas:                    { wacc: 0.10, terminalGrowth: 0.025, opMargin: 0.18, taxRate: 0.21, reinvestment: 0.30 },
  bank:                    { wacc: 0.09, terminalGrowth: 0.02,  opMargin: 0.20, taxRate: 0.25, reinvestment: 0.30 },
  consumer_brand:          { wacc: 0.08, terminalGrowth: 0.025, opMargin: 0.18, taxRate: 0.22, reinvestment: 0.25 },
  cyclical_industrial:     { wacc: 0.09, terminalGrowth: 0.02,  opMargin: 0.12, taxRate: 0.22, reinvestment: 0.35 },
  energy:                  { wacc: 0.10, terminalGrowth: 0.015, opMargin: 0.15, taxRate: 0.22, reinvestment: 0.35 },
  healthcare_pharma:       { wacc: 0.08, terminalGrowth: 0.025, opMargin: 0.20, taxRate: 0.20, reinvestment: 0.25 },
  insurance:               { wacc: 0.09, terminalGrowth: 0.02,  opMargin: 0.12, taxRate: 0.25, reinvestment: 0.30 },
  reit:                    { wacc: 0.07, terminalGrowth: 0.02,  opMargin: 0.35, taxRate: 0.21, reinvestment: 0.40 },
  speculative_growth:      { wacc: 0.13, terminalGrowth: 0.03,  opMargin: 0.05, taxRate: 0.21, reinvestment: 0.60 },
  marketplace_platform:    { wacc: 0.10, terminalGrowth: 0.025, opMargin: 0.15, taxRate: 0.21, reinvestment: 0.25 },
  payments_fintech:        { wacc: 0.09, terminalGrowth: 0.025, opMargin: 0.22, taxRate: 0.20, reinvestment: 0.25 },
  automotive:              { wacc: 0.10, terminalGrowth: 0.02,  opMargin: 0.08, taxRate: 0.22, reinvestment: 0.40 },
  general_quality_growth:  { wacc: 0.09, terminalGrowth: 0.025, opMargin: 0.15, taxRate: 0.21, reinvestment: 0.30 },
};

function ttmRevenueFromEdgar(edgarFacts: EdgarFacts | null): number | null {
  if (!edgarFacts || edgarFacts.revenue.length < 4) return null;
  const total = edgarFacts.revenue.slice(0, 4).reduce((sum, q) => sum + q.value, 0);
  return total > 0 ? total : null;
}

function estimateRevenueFromFcf(
  fcf: number,
  taxRate: number,
  opMargin: number,
  reinvestment: number,
): number | null {
  const denominator = opMargin * (1 - taxRate) * (1 - reinvestment);
  if (denominator <= 0) return null;
  const rev = fcf / denominator;
  return rev > 0 ? rev : null;
}

function buildGrowthSchedule(currentGrowth: number, terminalGrowth: number, years = 5): number[] {
  const clamped = Math.min(Math.max(currentGrowth, -0.30), 0.60);
  return Array.from({ length: years }, (_, i) => {
    const t = i / (years - 1);
    return clamped * (1 - t) + terminalGrowth * t;
  });
}

export function buildDcfInputFromSnapshot(
  snapshot: AssetSnapshot,
  edgarFacts: EdgarFacts | null,
  sectorTemplate: SectorTemplateKey,
): DcfInput | null {
  const defaults = SECTOR_DCF_DEFAULTS[sectorTemplate] ?? SECTOR_DCF_DEFAULTS.general_quality_growth;

  let revenue = ttmRevenueFromEdgar(edgarFacts);
  if (revenue == null && snapshot.free_cashflow != null && snapshot.free_cashflow > 0) {
    revenue = estimateRevenueFromFcf(snapshot.free_cashflow, defaults.taxRate, defaults.opMargin, defaults.reinvestment);
  }
  if (revenue == null || revenue <= 0) return null;
  if (snapshot.price == null || snapshot.price <= 0) return null;
  if (snapshot.market_cap == null || snapshot.market_cap <= 0) return null;

  const sharesOutstanding = snapshot.market_cap / snapshot.price;
  const currentGrowth = snapshot.revenue_growth ?? defaults.terminalGrowth;
  const revenueGrowthRates = buildGrowthSchedule(currentGrowth, defaults.terminalGrowth);

  return {
    ticker: snapshot.symbol ?? undefined,
    currentPrice: snapshot.price,
    revenue,
    revenueGrowthRates,
    operatingMarginRates: Array<number>(5).fill(defaults.opMargin),
    taxRate: defaults.taxRate,
    reinvestmentRate: defaults.reinvestment,
    wacc: defaults.wacc,
    terminalGrowthRate: defaults.terminalGrowth,
    netDebt: 0,
    sharesOutstanding,
  };
}

export function computeDcfScenarios(
  snapshot: AssetSnapshot,
  edgarFacts: EdgarFacts | null,
  sectorTemplate: SectorTemplateKey,
): DcfScenariosOutput | null {
  const baseInput = buildDcfInputFromSnapshot(snapshot, edgarFacts, sectorTemplate);
  if (!baseInput) return null;

  const revenueSource = ttmRevenueFromEdgar(edgarFacts) != null ? "EDGAR TTM" : "FCF-Schätzung";
  const sym = snapshot.symbol ?? "?";

  console.log(`[DCF][${sym}] Eingabe:`);
  console.log(`  Umsatzbasis (${revenueSource}): ${(baseInput.revenue / 1e9).toFixed(2)} Mrd.`);
  console.log(`  Starting FCF (Snapshot):       ${snapshot.free_cashflow != null ? (snapshot.free_cashflow / 1e9).toFixed(2) + " Mrd." : "N/A"}`);
  console.log(`  Sektortemplate:                ${sectorTemplate}`);
  console.log(`  WACC:                          ${(baseInput.wacc * 100).toFixed(1)}%`);
  console.log(`  Terminal Growth:               ${(baseInput.terminalGrowthRate * 100).toFixed(1)}%`);
  console.log(`  Operative Marge (Sektor):      ${(baseInput.operatingMarginRates[0] * 100).toFixed(1)}%`);
  console.log(`  Reinvestitionsrate:            ${((baseInput.reinvestmentRate ?? 0) * 100).toFixed(1)}%`);
  console.log(`  Aktien (Mrd.):                 ${(baseInput.sharesOutstanding / 1e9).toFixed(3)}`);
  console.log(`  Nettoverschuldung:             ${baseInput.netDebt}`);
  console.log(`  Wachstumsraten (Jahr 1-5):     ${baseInput.revenueGrowthRates.map(r => (r * 100).toFixed(1) + "%").join(" → ")}`);

  const scenarioInputs = buildDcfScenarioInputsFromBase(baseInput);
  let result: DcfScenariosOutput;
  try {
    result = calculateDcfScenarios(scenarioInputs);
  } catch {
    const { output } = calculateDcfSafe(baseInput);
    if (!output) return null;
    result = {
      bear: output,
      base: output,
      bull: output,
      limitations: ["Szenarien nicht verfügbar; Basis-DCF wird für alle Szenarien angezeigt."],
    };
  }

  console.log(`[DCF][${sym}] Basis-Szenario Prognose:`);
  for (const y of result.base.yearlyForecasts) {
    console.log(`  Jahr ${y.year}: Umsatz ${(y.revenue / 1e9).toFixed(2)} Mrd. | NOPAT ${(y.nopat / 1e9).toFixed(2)} Mrd. | FCF ${(y.freeCashFlow / 1e9).toFixed(2)} Mrd. | PV(FCF) ${(y.presentValueOfFcf / 1e9).toFixed(2)} Mrd.`);
  }
  console.log(`[DCF][${sym}] Terminal Value:           ${(result.base.terminalValue / 1e9).toFixed(2)} Mrd.`);
  console.log(`[DCF][${sym}] PV(Terminal Value):       ${(result.base.presentValueOfTerminalValue / 1e9).toFixed(2)} Mrd.`);
  console.log(`[DCF][${sym}] Enterprise Value:         ${(result.base.enterpriseValue / 1e9).toFixed(2)} Mrd.`);
  console.log(`[DCF][${sym}] Fair Value/Aktie Bear/Base/Bull: ${result.bear.fairValuePerShare.toFixed(2)} / ${result.base.fairValuePerShare.toFixed(2)} / ${result.bull.fairValuePerShare.toFixed(2)} ${snapshot.currency ?? "USD"}`);

  return result;
}
