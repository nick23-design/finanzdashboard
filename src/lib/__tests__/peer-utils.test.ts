import {
  expandSymbolsWithPeers,
  getConfiguredPeers,
  normalizeTickerSymbol,
} from "../peer-utils";

describe("peer-utils", () => {
  it("normalizes ticker symbols conservatively", () => {
    expect(normalizeTickerSymbol(" avgo ")).toBe("AVGO");
    expect(normalizeTickerSymbol("VOW3.DE")).toBe("VOW3.DE");
    expect(normalizeTickerSymbol("bad symbol")).toBeNull();
  });

  it("returns configured peers for known symbols", () => {
    expect(getConfiguredPeers("AVGO")).toEqual(["NVDA", "AMD", "QCOM", "MRVL"]);
  });

  it("expands symbols with peers while preserving order and limit", () => {
    expect(expandSymbolsWithPeers(["AVGO"], 3)).toEqual(["AVGO", "NVDA", "AMD"]);
  });

  it("deduplicates seed symbols and peers", () => {
    expect(expandSymbolsWithPeers(["NVDA", "AMD"], 10)).toEqual([
      "NVDA",
      "AMD",
      "INTC",
      "QCOM",
    ]);
  });
});
