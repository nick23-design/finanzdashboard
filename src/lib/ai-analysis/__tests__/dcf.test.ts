import {
  buildDcfScenarioInputsFromBase,
  calculateDcf,
  calculateDcfSafe,
  calculateDcfScenarios,
  calculateDcfSensitivity,
  type DcfInput,
} from "../dcf";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBaseInput(overrides: Partial<DcfInput> = {}): DcfInput {
  return {
    ticker: "TEST",
    currentPrice: 100,
    revenue: 1000,
    revenueGrowthRates: [0.1, 0.1, 0.1, 0.1, 0.1],
    operatingMarginRates: [0.2, 0.2, 0.2, 0.2, 0.2],
    taxRate: 0.25,
    reinvestmentRate: 0.25,
    wacc: 0.1,
    terminalGrowthRate: 0.03,
    netDebt: 0,
    sharesOutstanding: 100,
    ...overrides,
  };
}

// ─── Core DCF ─────────────────────────────────────────────────────────────────

describe("calculateDcf — core", () => {
  it("calculates fair value for a simple deterministic 1-year input", () => {
    // revenue=1000 → year1 revenue=1100, opIncome=220, nopat=165, fcf=123.75
    // TV = 123.75 * 1.03 / 0.07 = 1820.892857...
    // pvTV = 1820.892857 / 1.1 = 1655.357142...
    // EV = 112.5 + 1655.357142 = 1767.857142
    // fairValue = 1767.857142 / 100 = 17.678571...
    const result = calculateDcf(
      makeBaseInput({
        revenueGrowthRates: [0.1],
        operatingMarginRates: [0.2],
      }),
    );

    expect(result.fairValuePerShare).toBeCloseTo(17.68, 1);
    expect(result.enterpriseValue).toBeCloseTo(1767.86, 1);
    expect(result.equityValue).toBeCloseTo(1767.86, 1);
  });

  it("produces yearly forecasts with the correct length", () => {
    const result = calculateDcf(makeBaseInput());
    expect(result.yearlyForecasts).toHaveLength(5);
    result.yearlyForecasts.forEach((f, i) => {
      expect(f.year).toBe(i + 1);
    });
  });

  it("calculates terminal value and present value of terminal value correctly", () => {
    const input = makeBaseInput({ revenueGrowthRates: [0.1], operatingMarginRates: [0.2] });
    const result = calculateDcf(input);

    // finalYearFcf = 123.75 (from year 1 with reinvestmentRate=0.25)
    // TV = 123.75 * 1.03 / (0.10 - 0.03) = 127.4625 / 0.07
    const expectedTV = (123.75 * 1.03) / 0.07;
    const expectedPvTV = expectedTV / Math.pow(1.1, 1);

    expect(result.terminalValue).toBeCloseTo(expectedTV, 2);
    expect(result.presentValueOfTerminalValue).toBeCloseTo(expectedPvTV, 2);
  });

  it("calculates upside/downside percentage when currentPrice is provided", () => {
    const result = calculateDcf(
      makeBaseInput({ revenueGrowthRates: [0.1], operatingMarginRates: [0.2], currentPrice: 10 }),
    );
    // fairValuePerShare ≈ 17.68, currentPrice = 10 → upside ≈ 76.79%
    expect(result.upsideDownsidePct).not.toBeNull();
    expect(result.upsideDownsidePct!).toBeCloseTo(76.79, 0);
  });

  it("returns null upside/downside when currentPrice is not provided", () => {
    const { currentPrice: _cp, ...inputWithoutPrice } = makeBaseInput();
    const result = calculateDcf(inputWithoutPrice);
    expect(result.upsideDownsidePct).toBeNull();
  });

  it("uses the reinvestment-rate method when reinvestmentRate is provided", () => {
    const result = calculateDcf(
      makeBaseInput({ revenueGrowthRates: [0.1], operatingMarginRates: [0.2], reinvestmentRate: 0.25 }),
    );
    // nopat = 165, fcf = 165 * (1 - 0.25) = 123.75
    expect(result.yearlyForecasts[0].freeCashFlow).toBeCloseTo(123.75, 4);
  });

  it("uses line-item FCF method when D&A/CapEx/NWC assumptions are provided", () => {
    const result = calculateDcf(
      makeBaseInput({
        revenueGrowthRates: [0.1],
        operatingMarginRates: [0.2],
        reinvestmentRate: undefined,
        depreciationAndAmortizationPctRevenue: 0.05,
        capexPctRevenue: 0.08,
        workingCapitalPctRevenue: 0.02,
      }),
    );
    // revenue_1 = 1100, nopat = 165
    // fcf = 165 + 1100*0.05 - 1100*0.08 - 1100*0.02 = 165 + 55 - 88 - 22 = 110
    expect(result.yearlyForecasts[0].freeCashFlow).toBeCloseTo(110, 4);
  });

  it("falls back to NOPAT and records a limitation when FCF assumptions are missing", () => {
    const result = calculateDcf(
      makeBaseInput({
        revenueGrowthRates: [0.1],
        operatingMarginRates: [0.2],
        reinvestmentRate: undefined,
      }),
    );
    // nopat = 165, fcf = nopat = 165
    expect(result.yearlyForecasts[0].freeCashFlow).toBeCloseTo(165, 4);
    expect(result.limitations.join(" ")).toContain("NOPAT");
  });

  it("pads operatingMarginRates to match revenueGrowthRates length", () => {
    const result = calculateDcf(
      makeBaseInput({
        revenueGrowthRates: [0.1, 0.1, 0.1],
        operatingMarginRates: [0.2], // shorter — should pad with last value
      }),
    );
    expect(result.yearlyForecasts).toHaveLength(3);
    // all three years should have 20% margin applied
    expect(result.yearlyForecasts[2].operatingIncome).toBeCloseTo(
      result.yearlyForecasts[2].revenue * 0.2,
      4,
    );
  });

  it("accounts for netDebt when computing equityValue", () => {
    const withDebt = calculateDcf(makeBaseInput({ netDebt: 500 }));
    const withoutDebt = calculateDcf(makeBaseInput({ netDebt: 0 }));

    expect(withDebt.enterpriseValue).toBeCloseTo(withoutDebt.enterpriseValue, 2);
    expect(withDebt.equityValue).toBeCloseTo(withoutDebt.equityValue - 500, 2);
    expect(withDebt.fairValuePerShare).toBeLessThan(withoutDebt.fairValuePerShare);
  });
});

// ─── Guardrails ───────────────────────────────────────────────────────────────

describe("calculateDcf — guardrails", () => {
  it("throws when wacc <= terminalGrowthRate", () => {
    expect(() =>
      calculateDcf(makeBaseInput({ wacc: 0.03, terminalGrowthRate: 0.03 })),
    ).toThrow(/wacc.*terminalGrowthRate|Gordon/i);
  });

  it("throws when wacc < terminalGrowthRate", () => {
    expect(() =>
      calculateDcf(makeBaseInput({ wacc: 0.02, terminalGrowthRate: 0.03 })),
    ).toThrow();
  });

  it("throws when revenue is zero", () => {
    expect(() => calculateDcf(makeBaseInput({ revenue: 0 }))).toThrow(/revenue/i);
  });

  it("throws when revenue is negative", () => {
    expect(() => calculateDcf(makeBaseInput({ revenue: -100 }))).toThrow(/revenue/i);
  });

  it("throws when sharesOutstanding is zero", () => {
    expect(() => calculateDcf(makeBaseInput({ sharesOutstanding: 0 }))).toThrow(/sharesOutstanding/i);
  });

  it("throws when sharesOutstanding is negative", () => {
    expect(() => calculateDcf(makeBaseInput({ sharesOutstanding: -50 }))).toThrow(/sharesOutstanding/i);
  });

  it("throws when revenueGrowthRates is empty", () => {
    expect(() => calculateDcf(makeBaseInput({ revenueGrowthRates: [] }))).toThrow();
  });

  it("adds limitation for terminal growth rate above 4%", () => {
    const result = calculateDcf(makeBaseInput({ wacc: 0.15, terminalGrowthRate: 0.06 }));
    expect(result.limitations.join(" ")).toMatch(/terminal growth rate/i);
  });

  it("adds limitation for extreme positive revenue growth", () => {
    const result = calculateDcf(makeBaseInput({ revenueGrowthRates: [0.6, 0.6, 0.6, 0.6, 0.6] }));
    expect(result.limitations.join(" ")).toMatch(/aggressive/i);
  });

  it("adds limitation for extreme negative revenue growth", () => {
    const result = calculateDcf(makeBaseInput({ revenueGrowthRates: [-0.4, -0.4, -0.4, -0.4, -0.4] }));
    expect(result.limitations.join(" ")).toMatch(/contraction/i);
  });

  it("adds limitation when FCF assumptions are missing", () => {
    const result = calculateDcf(makeBaseInput({ reinvestmentRate: undefined }));
    expect(result.limitations.join(" ")).toContain("NOPAT");
  });

  it("adds limitation for out-of-range tax rate", () => {
    const result = calculateDcf(makeBaseInput({ taxRate: 0.5 }));
    expect(result.limitations.join(" ")).toMatch(/tax rate/i);
  });
});

// ─── calculateDcfSafe ─────────────────────────────────────────────────────────

describe("calculateDcfSafe", () => {
  it("returns output for valid input", () => {
    const { output, errors } = calculateDcfSafe(makeBaseInput());
    expect(output).not.toBeNull();
    expect(errors).toHaveLength(0);
  });

  it("returns null output and errors for invalid input", () => {
    const { output, errors } = calculateDcfSafe(makeBaseInput({ wacc: 0.01, terminalGrowthRate: 0.05 }));
    expect(output).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ─── Scenarios ────────────────────────────────────────────────────────────────

describe("buildDcfScenarioInputsFromBase", () => {
  it("returns bear, base, and bull inputs", () => {
    const scenarios = buildDcfScenarioInputsFromBase(makeBaseInput());
    expect(scenarios).toHaveProperty("bear");
    expect(scenarios).toHaveProperty("base");
    expect(scenarios).toHaveProperty("bull");
  });

  it("bear has lower revenue growth than base", () => {
    const base = makeBaseInput();
    const scenarios = buildDcfScenarioInputsFromBase(base);
    scenarios.bear.revenueGrowthRates.forEach((r, i) => {
      expect(r).toBeCloseTo(base.revenueGrowthRates[i] - 0.02, 6);
    });
  });

  it("bull has higher revenue growth than base", () => {
    const base = makeBaseInput();
    const scenarios = buildDcfScenarioInputsFromBase(base);
    scenarios.bull.revenueGrowthRates.forEach((r, i) => {
      expect(r).toBeCloseTo(base.revenueGrowthRates[i] + 0.02, 6);
    });
  });

  it("keeps terminal growth within allowed bounds in all scenarios", () => {
    const base = makeBaseInput({ terminalGrowthRate: 0.038, wacc: 0.05 });
    const scenarios = buildDcfScenarioInputsFromBase(base);

    expect(scenarios.bear.terminalGrowthRate).toBeGreaterThanOrEqual(-0.02);
    expect(scenarios.bear.terminalGrowthRate).toBeLessThanOrEqual(0.04);
    expect(scenarios.bull.terminalGrowthRate).toBeGreaterThanOrEqual(-0.02);
    expect(scenarios.bull.terminalGrowthRate).toBeLessThanOrEqual(0.04);
  });

  it("ensures wacc > terminalGrowthRate in all scenarios", () => {
    // Tight base: wacc barely above tgr
    const base = makeBaseInput({ wacc: 0.035, terminalGrowthRate: 0.03 });
    const scenarios = buildDcfScenarioInputsFromBase(base);

    expect(scenarios.bear.wacc).toBeGreaterThan(scenarios.bear.terminalGrowthRate);
    expect(scenarios.base.wacc).toBeGreaterThan(scenarios.base.terminalGrowthRate);
    expect(scenarios.bull.wacc).toBeGreaterThan(scenarios.bull.terminalGrowthRate);
  });
});

describe("calculateDcfScenarios", () => {
  it("returns bear, base, and bull outputs", () => {
    const inputs = buildDcfScenarioInputsFromBase(makeBaseInput());
    const result = calculateDcfScenarios(inputs);

    expect(result.bear).toBeDefined();
    expect(result.base).toBeDefined();
    expect(result.bull).toBeDefined();
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("bull fair value is generally >= base fair value", () => {
    const inputs = buildDcfScenarioInputsFromBase(makeBaseInput());
    const result = calculateDcfScenarios(inputs);
    expect(result.bull.fairValuePerShare).toBeGreaterThanOrEqual(result.base.fairValuePerShare);
  });

  it("base fair value is generally >= bear fair value", () => {
    const inputs = buildDcfScenarioInputsFromBase(makeBaseInput());
    const result = calculateDcfScenarios(inputs);
    expect(result.base.fairValuePerShare).toBeGreaterThanOrEqual(result.bear.fairValuePerShare);
  });

  it("accepts explicit scenario inputs", () => {
    const base = makeBaseInput();
    const bear = makeBaseInput({ wacc: 0.12, terminalGrowthRate: 0.02 });
    const bull = makeBaseInput({ wacc: 0.08, terminalGrowthRate: 0.035 });

    const result = calculateDcfScenarios({ bear, base, bull });
    expect(result.bull.fairValuePerShare).toBeGreaterThan(result.bear.fairValuePerShare);
  });

  it("includes a general limitation in output", () => {
    const inputs = buildDcfScenarioInputsFromBase(makeBaseInput());
    const result = calculateDcfScenarios(inputs);
    expect(result.limitations[0]).toMatch(/model estimates|differ materially/i);
  });
});

// ─── Sensitivity ──────────────────────────────────────────────────────────────

describe("calculateDcfSensitivity", () => {
  it("returns a 3×3 grid (9 points) when all default combinations are valid", () => {
    // wacc=0.1, tgr=0.03 — all 9 combos (0.09/0.10/0.11 × 0.025/0.03/0.035) are wacc > tgr
    const result = calculateDcfSensitivity(makeBaseInput());

    expect(result.points).toHaveLength(9);
    expect(result.waccValues).toHaveLength(3);
    expect(result.terminalGrowthRateValues).toHaveLength(3);
    expect(result.limitations).toHaveLength(0);
  });

  it("fair value decreases as WACC increases, holding terminal growth constant", () => {
    const result = calculateDcfSensitivity(makeBaseInput());
    const tgr = result.terminalGrowthRateValues[1]; // middle tgr

    const pointsByWacc = result.waccValues
      .map((wacc) => result.points.find((p) => p.wacc === wacc && p.terminalGrowthRate === tgr))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);

    expect(pointsByWacc).toHaveLength(3);
    expect(pointsByWacc[0].fairValuePerShare).toBeGreaterThan(pointsByWacc[1].fairValuePerShare);
    expect(pointsByWacc[1].fairValuePerShare).toBeGreaterThan(pointsByWacc[2].fairValuePerShare);
  });

  it("fair value increases as terminal growth increases, holding WACC constant", () => {
    const result = calculateDcfSensitivity(makeBaseInput());
    const wacc = result.waccValues[1]; // middle wacc

    const pointsByTgr = result.terminalGrowthRateValues
      .map((tgr) => result.points.find((p) => p.wacc === wacc && p.terminalGrowthRate === tgr))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);

    expect(pointsByTgr).toHaveLength(3);
    expect(pointsByTgr[0].fairValuePerShare).toBeLessThan(pointsByTgr[1].fairValuePerShare);
    expect(pointsByTgr[1].fairValuePerShare).toBeLessThan(pointsByTgr[2].fairValuePerShare);
  });

  it("skips invalid combinations and records a limitation", () => {
    // wacc=0.04, tgr=0.035; default spread creates wacc values [0.03, 0.04, 0.05]
    // and tgr values [0.03, 0.035, 0.04] — several combos invalid (wacc ≤ tgr)
    const result = calculateDcfSensitivity(
      makeBaseInput({ wacc: 0.04, terminalGrowthRate: 0.035 }),
    );

    expect(result.points.length).toBeLessThan(9);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.limitations[0]).toMatch(/skipped/i);
  });

  it("accepts custom waccSpread and terminalGrowthSpread options", () => {
    const result = calculateDcfSensitivity(makeBaseInput(), {
      waccSpread: [-0.02, 0, 0.02],
      terminalGrowthSpread: [0, 0.005],
    });

    expect(result.waccValues).toHaveLength(3);
    expect(result.terminalGrowthRateValues).toHaveLength(2);
    // wacc=0.08/0.10/0.12, tgr=0.03/0.035 — all valid
    expect(result.points).toHaveLength(6);
  });

  it("clamps terminal growth values to the allowed range", () => {
    // base tgr=0.038; +0.005 spread → 0.043 clamped to 0.04
    const result = calculateDcfSensitivity(makeBaseInput({ terminalGrowthRate: 0.038 }));
    for (const tgr of result.terminalGrowthRateValues) {
      expect(tgr).toBeLessThanOrEqual(0.04);
      expect(tgr).toBeGreaterThanOrEqual(-0.02);
    }
  });
});
