export interface StockEntry {
  symbol: string;
  name: string;
  region: "US" | "DE" | "EU" | "CH" | "ETF";
}

export const STOCKS: StockEntry[] = [
  // ── US Tech ──────────────────────────────────────────────
  { symbol: "AAPL",  name: "Apple Inc.",                   region: "US" },
  { symbol: "MSFT",  name: "Microsoft Corporation",        region: "US" },
  { symbol: "GOOGL", name: "Alphabet Inc. (Google)",       region: "US" },
  { symbol: "AMZN",  name: "Amazon.com Inc.",              region: "US" },
  { symbol: "NVDA",  name: "NVIDIA Corporation",           region: "US" },
  { symbol: "META",  name: "Meta Platforms Inc.",          region: "US" },
  { symbol: "TSLA",  name: "Tesla Inc.",                   region: "US" },
  { symbol: "AVGO",  name: "Broadcom Inc.",                region: "US" },
  { symbol: "ORCL",  name: "Oracle Corporation",           region: "US" },
  { symbol: "ADBE",  name: "Adobe Inc.",                   region: "US" },
  { symbol: "CRM",   name: "Salesforce Inc.",              region: "US" },
  { symbol: "AMD",   name: "Advanced Micro Devices",       region: "US" },
  { symbol: "INTC",  name: "Intel Corporation",            region: "US" },
  { symbol: "QCOM",  name: "Qualcomm Inc.",                region: "US" },
  { symbol: "NFLX",  name: "Netflix Inc.",                 region: "US" },
  { symbol: "UBER",  name: "Uber Technologies",            region: "US" },
  { symbol: "SNOW",  name: "Snowflake Inc.",               region: "US" },
  { symbol: "SHOP",  name: "Shopify Inc.",                 region: "US" },
  { symbol: "PYPL",  name: "PayPal Holdings",              region: "US" },
  { symbol: "SQ",    name: "Block Inc. (Square)",          region: "US" },
  // ── US Finance ───────────────────────────────────────────
  { symbol: "BRK-B", name: "Berkshire Hathaway B",        region: "US" },
  { symbol: "JPM",   name: "JPMorgan Chase",               region: "US" },
  { symbol: "BAC",   name: "Bank of America",              region: "US" },
  { symbol: "GS",    name: "Goldman Sachs",                region: "US" },
  { symbol: "MS",    name: "Morgan Stanley",               region: "US" },
  { symbol: "V",     name: "Visa Inc.",                    region: "US" },
  { symbol: "MA",    name: "Mastercard Inc.",              region: "US" },
  { symbol: "AXP",   name: "American Express",             region: "US" },
  { symbol: "BLK",   name: "BlackRock Inc.",               region: "US" },
  // ── US Healthcare ────────────────────────────────────────
  { symbol: "JNJ",   name: "Johnson & Johnson",            region: "US" },
  { symbol: "UNH",   name: "UnitedHealth Group",           region: "US" },
  { symbol: "PFE",   name: "Pfizer Inc.",                  region: "US" },
  { symbol: "ABBV",  name: "AbbVie Inc.",                  region: "US" },
  { symbol: "MRK",   name: "Merck & Co.",                  region: "US" },
  { symbol: "LLY",   name: "Eli Lilly and Company",        region: "US" },
  { symbol: "NVO",   name: "Novo Nordisk",                 region: "US" },
  // ── US Consumer / Industrie ──────────────────────────────
  { symbol: "WMT",   name: "Walmart Inc.",                 region: "US" },
  { symbol: "COST",  name: "Costco Wholesale",             region: "US" },
  { symbol: "MCD",   name: "McDonald's Corporation",       region: "US" },
  { symbol: "KO",    name: "Coca-Cola Company",            region: "US" },
  { symbol: "PEP",   name: "PepsiCo Inc.",                 region: "US" },
  { symbol: "PG",    name: "Procter & Gamble",             region: "US" },
  { symbol: "BA",    name: "Boeing Company",               region: "US" },
  { symbol: "CAT",   name: "Caterpillar Inc.",             region: "US" },
  { symbol: "GE",    name: "GE Aerospace",                 region: "US" },
  { symbol: "XOM",   name: "Exxon Mobil Corporation",      region: "US" },
  { symbol: "CVX",   name: "Chevron Corporation",          region: "US" },
  { symbol: "DIS",   name: "Walt Disney Company",          region: "US" },
  { symbol: "SPOT",  name: "Spotify Technology",           region: "US" },
  // ── DAX 40 (Deutschland) ─────────────────────────────────
  { symbol: "SAP.DE",   name: "SAP SE",                   region: "DE" },
  { symbol: "SIE.DE",   name: "Siemens AG",               region: "DE" },
  { symbol: "ALV.DE",   name: "Allianz SE",               region: "DE" },
  { symbol: "MBG.DE",   name: "Mercedes-Benz Group",      region: "DE" },
  { symbol: "BMW.DE",   name: "BMW AG",                   region: "DE" },
  { symbol: "VOW3.DE",  name: "Volkswagen AG (Vz.)",      region: "DE" },
  { symbol: "DTE.DE",   name: "Deutsche Telekom AG",      region: "DE" },
  { symbol: "BAS.DE",   name: "BASF SE",                  region: "DE" },
  { symbol: "BAYN.DE",  name: "Bayer AG",                 region: "DE" },
  { symbol: "DBK.DE",   name: "Deutsche Bank AG",         region: "DE" },
  { symbol: "MUV2.DE",  name: "Munich Re",                region: "DE" },
  { symbol: "ADS.DE",   name: "adidas AG",                region: "DE" },
  { symbol: "RWE.DE",   name: "RWE AG",                   region: "DE" },
  { symbol: "IFX.DE",   name: "Infineon Technologies",    region: "DE" },
  { symbol: "HEN3.DE",  name: "Henkel AG & Co.",          region: "DE" },
  { symbol: "FRE.DE",   name: "Fresenius SE & Co.",       region: "DE" },
  { symbol: "HEI.DE",   name: "HeidelbergCement AG",      region: "DE" },
  { symbol: "ENR.DE",   name: "Siemens Energy AG",        region: "DE" },
  { symbol: "AIR.DE",   name: "Airbus SE",                region: "DE" },
  { symbol: "CON.DE",   name: "Continental AG",           region: "DE" },
  { symbol: "ZAL.DE",   name: "Zalando SE",               region: "DE" },
  { symbol: "PUM.DE",   name: "PUMA SE",                  region: "DE" },
  // ── Europa ───────────────────────────────────────────────
  { symbol: "NESN.SW",  name: "Nestlé SA",                region: "CH" },
  { symbol: "ROG.SW",   name: "Roche Holding AG",         region: "CH" },
  { symbol: "NOVN.SW",  name: "Novartis AG",              region: "CH" },
  { symbol: "LONN.SW",  name: "Lonza Group AG",           region: "CH" },
  { symbol: "ASML",     name: "ASML Holding N.V.",        region: "EU" },
  { symbol: "LVMH.PA",  name: "LVMH Moët Hennessy",      region: "EU" },
  { symbol: "OR.PA",    name: "L'Oréal SA",               region: "EU" },
  { symbol: "TTE.PA",   name: "TotalEnergies SE",         region: "EU" },
  { symbol: "SAN.PA",   name: "Sanofi SA",                region: "EU" },
  { symbol: "BNP.PA",   name: "BNP Paribas",              region: "EU" },
  { symbol: "INGA.AS",  name: "ING Groep N.V.",           region: "EU" },
  { symbol: "PHIA.AS",  name: "Philips N.V.",             region: "EU" },
  { symbol: "UNA.AS",   name: "Unilever PLC",             region: "EU" },
  { symbol: "SHEL",     name: "Shell PLC",                region: "EU" },
  { symbol: "BP",       name: "BP PLC",                   region: "EU" },
  { symbol: "GSK",      name: "GSK PLC",                  region: "EU" },
  { symbol: "AZN",      name: "AstraZeneca PLC",          region: "EU" },
  { symbol: "HSBA.L",   name: "HSBC Holdings",            region: "EU" },
  // ── ETFs ─────────────────────────────────────────────────
  { symbol: "SPY",   name: "SPDR S&P 500 ETF",            region: "ETF" },
  { symbol: "QQQ",   name: "Invesco QQQ (NASDAQ-100)",    region: "ETF" },
  { symbol: "VTI",   name: "Vanguard Total Stock Market", region: "ETF" },
  { symbol: "VWCE.DE", name: "Vanguard FTSE All-World",  region: "ETF" },
  { symbol: "EWG",   name: "iShares MSCI Germany ETF",    region: "ETF" },
  { symbol: "IVV",   name: "iShares Core S&P 500 ETF",   region: "ETF" },
  { symbol: "GLD",   name: "SPDR Gold Shares",            region: "ETF" },
  { symbol: "ARKK",  name: "ARK Innovation ETF",          region: "ETF" },
];

/** Fuzzy-Suche: Symbol oder Name enthält alle Wörter des Query */
export function searchStocks(query: string, limit = 8): StockEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];

  const words = q.split(/\s+/);

  return STOCKS.filter((s) => {
    const haystack = `${s.symbol} ${s.name}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  }).slice(0, limit);
}
