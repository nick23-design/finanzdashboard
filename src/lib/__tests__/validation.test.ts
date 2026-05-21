import { tickerSchema, addWatchlistSchema } from "../validation";

describe("tickerSchema", () => {
  it("accepts valid uppercase tickers", () => {
    expect(tickerSchema.safeParse("AAPL").success).toBe(true);
    expect(tickerSchema.safeParse("MSFT").success).toBe(true);
    expect(tickerSchema.safeParse("SAP.DE").success).toBe(true);
    expect(tickerSchema.safeParse("BRK-B").success).toBe(true);
  });

  it("upcases lowercase input", () => {
    const result = tickerSchema.safeParse("aapl");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("AAPL");
  });

  it("rejects empty string", () => {
    expect(tickerSchema.safeParse("").success).toBe(false);
  });

  it("rejects strings longer than 10 chars", () => {
    expect(tickerSchema.safeParse("TOOLONGSTRING").success).toBe(false);
  });

  it("rejects special characters", () => {
    expect(tickerSchema.safeParse("AAPL!").success).toBe(false);
    expect(tickerSchema.safeParse("AA PL").success).toBe(false);
  });
});

describe("addWatchlistSchema", () => {
  it("accepts valid payload", () => {
    const result = addWatchlistSchema.safeParse({ symbol: "AAPL", name: "Apple Inc." });
    expect(result.success).toBe(true);
  });

  it("name is optional and defaults to empty string", () => {
    const result = addWatchlistSchema.safeParse({ symbol: "MSFT" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("");
  });

  it("rejects missing symbol", () => {
    expect(addWatchlistSchema.safeParse({ name: "Test" }).success).toBe(false);
  });

  it("rejects name longer than 200 chars", () => {
    expect(
      addWatchlistSchema.safeParse({ symbol: "AAPL", name: "A".repeat(201) }).success
    ).toBe(false);
  });
});
