import {
  computeSignalPerformance,
  filterByPeriodAvailability,
  type SignalRecord,
  type ForwardReturnRecord,
} from "../backtesting";

function signal(symbol: string, date: string, rating: string, alphaScore: number, priceAtSignal = 100): SignalRecord {
  return { symbol, date, rating, alphaScore, stockType: "quality_compounder", priceAtSignal };
}

function fwdReturn(symbol: string, signalDate: string, period: "3m" | "6m" | "12m" | "1m", forwardReturn: number, benchmarkReturn?: number): ForwardReturnRecord {
  return { symbol, signalDate, period, forwardReturn, benchmarkReturn };
}

describe("computeSignalPerformance", () => {
  it("returns empty result when no signals provided", () => {
    const result = computeSignalPerformance([], [], "3m");
    expect(result.sampleSize).toBe(0);
    expect(result.hitRate).toBe(0);
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("returns empty result when no forward returns match", () => {
    const signals = [signal("AAPL", "2024-01-01", "Kaufen", 75)];
    const result = computeSignalPerformance(signals, [], "3m");
    expect(result.sampleSize).toBe(0);
    expect(result.limitations.some(l => l.toLowerCase().includes("forward") || l.toLowerCase().includes("periode"))).toBe(true);
  });

  it("correctly computes average forward return", () => {
    const signals = [
      signal("AAPL", "2024-01-01", "Kaufen", 80),
      signal("MSFT", "2024-01-01", "Kaufen", 75),
    ];
    const returns = [
      fwdReturn("AAPL", "2024-01-01", "3m", 0.12),
      fwdReturn("MSFT", "2024-01-01", "3m", 0.08),
    ];
    const result = computeSignalPerformance(signals, returns, "3m");
    expect(result.sampleSize).toBe(2);
    expect(result.averageForwardReturn).toBeCloseTo(0.10, 5);
  });

  it("hit rate counts only positive returns", () => {
    const signals = [
      signal("A", "2024-01-01", "Kaufen", 70),
      signal("B", "2024-01-01", "Kaufen", 70),
      signal("C", "2024-01-01", "Halten", 50),
      signal("D", "2024-01-01", "Verkaufen", 30),
    ];
    const returns = [
      fwdReturn("A", "2024-01-01", "3m", 0.10),
      fwdReturn("B", "2024-01-01", "3m", -0.05),
      fwdReturn("C", "2024-01-01", "3m", 0.02),
      fwdReturn("D", "2024-01-01", "3m", -0.08),
    ];
    const result = computeSignalPerformance(signals, returns, "3m");
    expect(result.hitRate).toBeCloseTo(0.5, 5);
  });

  it("only matches signals with correct period", () => {
    const signals = [signal("AAPL", "2024-01-01", "Kaufen", 80)];
    const returns = [
      fwdReturn("AAPL", "2024-01-01", "6m", 0.20), // wrong period
    ];
    const result = computeSignalPerformance(signals, returns, "3m");
    expect(result.sampleSize).toBe(0);
  });

  it("groups results by rating correctly", () => {
    const signals = [
      signal("A", "2024-01-01", "Kaufen", 80),
      signal("B", "2024-02-01", "Verkaufen", 25),
    ];
    const returns = [
      fwdReturn("A", "2024-01-01", "3m", 0.15),
      fwdReturn("B", "2024-02-01", "3m", -0.10),
    ];
    const result = computeSignalPerformance(signals, returns, "3m");
    expect(result.byRating["Kaufen"]).toBeDefined();
    expect(result.byRating["Verkaufen"]).toBeDefined();
    expect(result.byRating["Kaufen"].avgReturn).toBeCloseTo(0.15, 5);
    expect(result.byRating["Verkaufen"].avgReturn).toBeCloseTo(-0.10, 5);
  });

  it("computes alpha excess return when benchmark is provided", () => {
    const signals = [signal("AAPL", "2024-01-01", "Kaufen", 78)];
    const returns = [fwdReturn("AAPL", "2024-01-01", "3m", 0.18, 0.10)];
    const result = computeSignalPerformance(signals, returns, "3m");
    expect(result.averageBenchmarkRelativeReturn).toBeCloseTo(0.08, 5);
  });

  it("assigns alpha score decile buckets correctly", () => {
    const signals = [
      signal("A", "2024-01-01", "Kaufen", 85),
      signal("B", "2024-02-01", "Kaufen", 45),
    ];
    const returns = [
      fwdReturn("A", "2024-01-01", "3m", 0.10),
      fwdReturn("B", "2024-02-01", "3m", 0.05),
    ];
    const result = computeSignalPerformance(signals, returns, "3m");
    expect(result.byAlphaScoreDecile).toBeDefined();
    expect(result.byAlphaScoreDecile!["80-90"]).toBeDefined();
    expect(result.byAlphaScoreDecile!["40-50"]).toBeDefined();
  });

  it("no look-ahead: signals without matching return are excluded", () => {
    const signals = [
      signal("AAPL", "2024-01-01", "Kaufen", 80),
      signal("AAPL", "2025-01-01", "Kaufen", 80), // future signal, no return
    ];
    const returns = [fwdReturn("AAPL", "2024-01-01", "3m", 0.12)];
    const result = computeSignalPerformance(signals, returns, "3m");
    expect(result.sampleSize).toBe(1);
  });

  it("adds small-sample limitation when < 10 data points", () => {
    const signals = [signal("AAPL", "2024-01-01", "Kaufen", 80)];
    const returns = [fwdReturn("AAPL", "2024-01-01", "3m", 0.10)];
    const result = computeSignalPerformance(signals, returns, "3m");
    expect(result.limitations.some(l => l.includes("Datenpunkte") || l.includes("statistische"))).toBe(true);
  });
});

describe("filterByPeriodAvailability", () => {
  it("correctly separates signals with and without matching returns", () => {
    const signals = [
      signal("AAPL", "2024-01-01", "Kaufen", 80),
      signal("MSFT", "2024-02-01", "Kaufen", 75),
    ];
    const returns = [fwdReturn("AAPL", "2024-01-01", "3m", 0.12)];
    const { withReturns, withoutReturns } = filterByPeriodAvailability(signals, returns, "3m");
    expect(withReturns).toHaveLength(1);
    expect(withReturns[0].symbol).toBe("AAPL");
    expect(withoutReturns).toHaveLength(1);
    expect(withoutReturns[0].symbol).toBe("MSFT");
  });

  it("uses period correctly when filtering", () => {
    const signals = [signal("AAPL", "2024-01-01", "Kaufen", 80)];
    const returns = [fwdReturn("AAPL", "2024-01-01", "6m", 0.20)];
    const { withReturns, withoutReturns } = filterByPeriodAvailability(signals, returns, "3m");
    expect(withReturns).toHaveLength(0);
    expect(withoutReturns).toHaveLength(1);
  });
});
