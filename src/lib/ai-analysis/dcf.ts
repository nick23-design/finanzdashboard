/**
 * Deterministic FCFF DCF Valuation Module
 *
 * Zero LLM calls — all calculations are pure math.
 * Use calculateDcf for direct use (throws on invalid inputs).
 * Use calculateDcfSafe for pipeline use (returns structured errors).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type DcfInput = {
  ticker?: string;
  currentPrice?: number;

  revenue: number;
  revenueGrowthRates: number[];
  operatingMarginRates: number[];

  taxRate: number;

  depreciationAndAmortizationPctRevenue?: number;
  capexPctRevenue?: number;
  workingCapitalPctRevenue?: number;

  reinvestmentRate?: number;

  wacc: number;
  terminalGrowthRate: number;

  netDebt: number;
  sharesOutstanding: number;
};

export type DcfYearlyForecast = {
  year: number;
  revenue: number;
  operatingIncome: number;
  nopat: number;
  freeCashFlow: number;
  discountFactor: number;
  presentValueOfFcf: number;
};

export type DcfOutput = {
  enterpriseValue: number;
  equityValue: number;
  fairValuePerShare: number;
  upsideDownsidePct: number | null;

  assumptions: {
    revenueGrowthRates: number[];
    operatingMarginRates: number[];
    taxRate: number;
    wacc: number;
    terminalGrowthRate: number;
  };

  yearlyForecasts: DcfYearlyForecast[];

  terminalValue: number;
  presentValueOfTerminalValue: number;

  limitations: string[];
};

export type DcfScenarioName = "bear" | "base" | "bull";

export type DcfScenarioOutput = {
  scenario: DcfScenarioName;
  output: DcfOutput;
};

export type DcfScenariosOutput = {
  bear: DcfOutput;
  base: DcfOutput;
  bull: DcfOutput;
  limitations: string[];
};

export type DcfScenarioInputs = {
  bear: DcfInput;
  base: DcfInput;
  bull: DcfInput;
};

export type DcfSensitivityPoint = {
  wacc: number;
  terminalGrowthRate: number;
  fairValuePerShare: number;
};

export type DcfSensitivityOutput = {
  points: DcfSensitivityPoint[];
  waccValues: number[];
  terminalGrowthRateValues: number[];
  limitations: string[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TERMINAL_GROWTH_MIN = -0.02;
const TERMINAL_GROWTH_MAX = 0.04;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function padRight(arr: number[], length: number, fill: number): number[] {
  if (arr.length >= length) return arr.slice(0, length);
  return [...arr, ...Array<number>(length - arr.length).fill(fill)];
}

// ─── Core DCF ─────────────────────────────────────────────────────────────────

export function calculateDcf(input: DcfInput): DcfOutput {
  const {
    revenue,
    revenueGrowthRates,
    operatingMarginRates,
    taxRate,
    wacc,
    terminalGrowthRate,
    netDebt,
    sharesOutstanding,
    currentPrice,
  } = input;

  if (!Number.isFinite(revenue) || revenue <= 0) {
    throw new Error(`DCF requires revenue > 0, got ${revenue}`);
  }
  if (!Number.isFinite(sharesOutstanding) || sharesOutstanding <= 0) {
    throw new Error(`DCF requires sharesOutstanding > 0, got ${sharesOutstanding}`);
  }
  if (!Number.isFinite(wacc) || wacc <= 0) {
    throw new Error(`DCF requires wacc > 0, got ${wacc}`);
  }
  if (!Number.isFinite(terminalGrowthRate)) {
    throw new Error("DCF requires a finite terminalGrowthRate");
  }
  if (wacc <= terminalGrowthRate) {
    throw new Error(
      `DCF requires wacc (${wacc}) > terminalGrowthRate (${terminalGrowthRate}); Gordon Growth Model undefined otherwise`,
    );
  }
  if (revenueGrowthRates.length === 0) {
    throw new Error("DCF requires at least one forecast year (revenueGrowthRates must not be empty)");
  }
  if (operatingMarginRates.length === 0) {
    throw new Error("DCF requires at least one operating margin rate (operatingMarginRates must not be empty)");
  }

  const forecastYears = revenueGrowthRates.length;
  const limitations: string[] = [];

  if (terminalGrowthRate < TERMINAL_GROWTH_MIN || terminalGrowthRate > TERMINAL_GROWTH_MAX) {
    limitations.push(
      `Terminal growth rate ${(terminalGrowthRate * 100).toFixed(1)}% is outside the typical range of −2% to +4%; results may be unreliable.`,
    );
  }
  if (taxRate < 0 || taxRate > 0.35) {
    limitations.push(
      `Tax rate ${(taxRate * 100).toFixed(1)}% is outside the typical range of 0%–35%; verify this assumption.`,
    );
  }

  const maxGrowth = Math.max(...revenueGrowthRates);
  const minGrowth = Math.min(...revenueGrowthRates);
  if (maxGrowth > 0.5) {
    limitations.push(
      `Revenue growth assumption of ${(maxGrowth * 100).toFixed(0)}% is very aggressive; treat results as optimistic.`,
    );
  }
  if (minGrowth < -0.3) {
    limitations.push(
      `Revenue growth assumption of ${(minGrowth * 100).toFixed(0)}% implies severe contraction; treat results with caution.`,
    );
  }

  const clampedMargins = operatingMarginRates.map((m) => clamp(m, -1, 1));
  if (operatingMarginRates.some((m, i) => m !== clampedMargins[i])) {
    limitations.push(
      "One or more operating margin rates were outside −100%/+100% and have been clamped for calculation.",
    );
  }

  const hasReinvestmentRate =
    typeof input.reinvestmentRate === "number" && Number.isFinite(input.reinvestmentRate);
  const hasLineItemInputs =
    typeof input.depreciationAndAmortizationPctRevenue === "number" &&
    Number.isFinite(input.depreciationAndAmortizationPctRevenue) &&
    typeof input.capexPctRevenue === "number" &&
    Number.isFinite(input.capexPctRevenue) &&
    typeof input.workingCapitalPctRevenue === "number" &&
    Number.isFinite(input.workingCapitalPctRevenue);

  if (!hasReinvestmentRate && !hasLineItemInputs) {
    limitations.push(
      "Free cash flow estimated from NOPAT due to missing reinvestment/capex/working-capital assumptions.",
    );
  }

  const lastMargin = clampedMargins[clampedMargins.length - 1];
  const paddedMargins = padRight(clampedMargins, forecastYears, lastMargin);
  const clampedTaxRate = clamp(taxRate, 0, 1);

  const yearlyForecasts: DcfYearlyForecast[] = [];
  let currentRevenue = revenue;
  let totalPvFcf = 0;

  for (let i = 0; i < forecastYears; i++) {
    const year = i + 1;
    currentRevenue = currentRevenue * (1 + revenueGrowthRates[i]);
    const operatingIncome = currentRevenue * paddedMargins[i];
    const nopat = operatingIncome * (1 - clampedTaxRate);

    let freeCashFlow: number;
    if (hasReinvestmentRate) {
      freeCashFlow = nopat * (1 - input.reinvestmentRate!);
    } else if (hasLineItemInputs) {
      freeCashFlow =
        nopat +
        currentRevenue * input.depreciationAndAmortizationPctRevenue! -
        currentRevenue * input.capexPctRevenue! -
        currentRevenue * input.workingCapitalPctRevenue!;
    } else {
      freeCashFlow = nopat;
    }

    const discountFactor = 1 / Math.pow(1 + wacc, year);
    const presentValueOfFcf = freeCashFlow * discountFactor;
    totalPvFcf += presentValueOfFcf;

    yearlyForecasts.push({
      year,
      revenue: currentRevenue,
      operatingIncome,
      nopat,
      freeCashFlow,
      discountFactor,
      presentValueOfFcf,
    });
  }

  const finalYearFcf = yearlyForecasts[forecastYears - 1].freeCashFlow;
  const terminalValue = (finalYearFcf * (1 + terminalGrowthRate)) / (wacc - terminalGrowthRate);
  const presentValueOfTerminalValue = terminalValue / Math.pow(1 + wacc, forecastYears);

  const enterpriseValue = totalPvFcf + presentValueOfTerminalValue;
  const equityValue = enterpriseValue - netDebt;
  const fairValuePerShare = equityValue / sharesOutstanding;
  const upsideDownsidePct =
    typeof currentPrice === "number" && Number.isFinite(currentPrice) && currentPrice > 0
      ? (fairValuePerShare / currentPrice - 1) * 100
      : null;

  return {
    enterpriseValue,
    equityValue,
    fairValuePerShare,
    upsideDownsidePct,
    assumptions: {
      revenueGrowthRates,
      operatingMarginRates,
      taxRate,
      wacc,
      terminalGrowthRate,
    },
    yearlyForecasts,
    terminalValue,
    presentValueOfTerminalValue,
    limitations,
  };
}

export function calculateDcfSafe(
  input: DcfInput,
): { output: DcfOutput | null; errors: string[] } {
  try {
    return { output: calculateDcf(input), errors: [] };
  } catch (err) {
    return {
      output: null,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

export function buildDcfScenarioInputsFromBase(base: DcfInput): DcfScenarioInputs {
  const bearWacc = base.wacc + 0.01;
  const bullWacc = Math.max(base.wacc - 0.01, 0.001);

  // Clamp to allowed range, then also ensure wacc > terminalGrowthRate
  const bearTerminalGrowth = Math.min(
    clamp(base.terminalGrowthRate - 0.005, TERMINAL_GROWTH_MIN, TERMINAL_GROWTH_MAX),
    bearWacc - 0.001,
  );
  const bullTerminalGrowth = Math.min(
    clamp(base.terminalGrowthRate + 0.005, TERMINAL_GROWTH_MIN, TERMINAL_GROWTH_MAX),
    bullWacc - 0.001,
  );

  return {
    bear: {
      ...base,
      revenueGrowthRates: base.revenueGrowthRates.map((r) => r - 0.02),
      operatingMarginRates: base.operatingMarginRates.map((m) => m - 0.015),
      wacc: bearWacc,
      terminalGrowthRate: bearTerminalGrowth,
    },
    base,
    bull: {
      ...base,
      revenueGrowthRates: base.revenueGrowthRates.map((r) => r + 0.02),
      operatingMarginRates: base.operatingMarginRates.map((m) => m + 0.01),
      wacc: bullWacc,
      terminalGrowthRate: bullTerminalGrowth,
    },
  };
}

export function calculateDcfScenarios(inputs: DcfScenarioInputs): DcfScenariosOutput {
  const bear = calculateDcf(inputs.bear);
  const base = calculateDcf(inputs.base);
  const bull = calculateDcf(inputs.bull);

  const seen = new Set<string>();
  const allLimitations: string[] = [];
  for (const lim of [...bear.limitations, ...base.limitations, ...bull.limitations]) {
    if (!seen.has(lim)) {
      seen.add(lim);
      allLimitations.push(lim);
    }
  }

  return {
    bear,
    base,
    bull,
    limitations: [
      "Scenario ranges are model estimates, not forecasts; actual outcomes may differ materially.",
      ...allLimitations,
    ],
  };
}

// ─── Sensitivity ──────────────────────────────────────────────────────────────

export function calculateDcfSensitivity(
  baseInput: DcfInput,
  options?: {
    waccSpread?: number[];
    terminalGrowthSpread?: number[];
  },
): DcfSensitivityOutput {
  const waccDeltas = options?.waccSpread ?? [-0.01, 0, 0.01];
  const tgrDeltas = options?.terminalGrowthSpread ?? [-0.005, 0, 0.005];

  const waccValues = waccDeltas.map((d) => baseInput.wacc + d);
  const terminalGrowthRateValues = tgrDeltas.map((d) =>
    clamp(baseInput.terminalGrowthRate + d, TERMINAL_GROWTH_MIN, TERMINAL_GROWTH_MAX),
  );

  const points: DcfSensitivityPoint[] = [];
  let skippedCount = 0;

  for (const wacc of waccValues) {
    for (const terminalGrowthRate of terminalGrowthRateValues) {
      if (wacc <= 0 || wacc <= terminalGrowthRate) {
        skippedCount++;
        continue;
      }
      const { output } = calculateDcfSafe({ ...baseInput, wacc, terminalGrowthRate });
      if (output) {
        points.push({ wacc, terminalGrowthRate, fairValuePerShare: output.fairValuePerShare });
      }
    }
  }

  const limitations: string[] = [];
  if (skippedCount > 0) {
    limitations.push(
      `${skippedCount} sensitivity combination(s) skipped because WACC ≤ terminal growth rate (Gordon Growth Model requires WACC > g).`,
    );
  }

  return {
    points,
    waccValues,
    terminalGrowthRateValues,
    limitations,
  };
}
