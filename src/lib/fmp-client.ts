import type {
  AnalystData,
  EdgarFactPeriod,
  EdgarFacts,
  InstitutionalData,
  InstitutionalHolder,
} from "@/lib/finance-client";

const FMP_STABLE_BASE = "https://financialmodelingprep.com/stable";
const FMP_LEGACY_BASE = "https://financialmodelingprep.com/api/v3";
const FMP_LEGACY_V4_BASE = "https://financialmodelingprep.com/api/v4";
const FMP_TIMEOUT_MS = 12_000;

export interface FmpAnalystConsensus extends AnalystData {
  raw: unknown;
}

export interface FmpInstitutionalOwnership extends InstitutionalData {
  raw: unknown;
}

export interface FmpQuarterlyFacts extends EdgarFacts {
  raw: unknown;
}

function getApiKey(): string {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) {
    throw new Error("FMP_API_KEY fehlt");
  }
  return key;
}

function stableUrl(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const url = new URL(path.replace(/^\//, ""), `${FMP_STABLE_BASE}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set("apikey", getApiKey());
  return url.toString();
}

function legacyUrl(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const url = new URL(path.replace(/^\//, ""), `${FMP_LEGACY_BASE}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set("apikey", getApiKey());
  return url.toString();
}

function legacyV4Url(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const url = new URL(path.replace(/^\//, ""), `${FMP_LEGACY_V4_BASE}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set("apikey", getApiKey());
  return url.toString();
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("apikey")) parsed.searchParams.set("apikey", "[redacted]");
    return parsed.toString();
  } catch {
    return url.replace(/apikey=[^&]+/i, "apikey=[redacted]");
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(FMP_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`FMP HTTP ${res.status} bei ${redactUrl(url)}`);
  }
  if (!text.trim()) return null;
  const json = JSON.parse(text) as unknown;
  if (isRecord(json) && typeof json["Error Message"] === "string") {
    throw new Error(String(json["Error Message"]));
  }
  if (isRecord(json) && typeof json.error === "string") {
    throw new Error(String(json.error));
  }
  if (isRecord(json) && typeof json.message === "string" && Object.keys(json).length <= 3) {
    throw new Error(String(json.message));
  }
  return json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function numberFrom(record: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const raw = record[key];
    if (raw == null || raw === "") continue;
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[%,$]/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function stringFrom(record: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

function normalizePct(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (Math.abs(value) > 1) return value / 100;
  return value;
}

function firstWithNumber(rows: Record<string, unknown>[], keys: string[]): Record<string, unknown> | null {
  return rows.find(row => numberFrom(row, keys) != null) ?? rows[0] ?? null;
}

function combineRaw(parts: Record<string, unknown>): unknown {
  return JSON.parse(JSON.stringify(parts)) as unknown;
}

export async function fetchFmpAnalystConsensus(symbol: string): Promise<FmpAnalystConsensus | null> {
  const upper = symbol.toUpperCase();
  const [consensusResult, summaryResult, estimatesResult, legacyConsensusResult, legacySummaryResult, legacyTargetsResult] = await Promise.allSettled([
    fetchJson(stableUrl("price-target-consensus", { symbol: upper })),
    fetchJson(stableUrl("price-target-summary", { symbol: upper })),
    fetchJson(stableUrl("analyst-estimates", { symbol: upper, period: "annual", page: 0, limit: 5 })),
    fetchJson(legacyV4Url("price-target-consensus", { symbol: upper })),
    fetchJson(legacyV4Url("price-target-summary", { symbol: upper })),
    fetchJson(legacyV4Url("price-target", { symbol: upper })),
  ]);

  const consensusRaw = consensusResult.status === "fulfilled" ? consensusResult.value : null;
  const summaryRaw = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const estimatesRaw = estimatesResult.status === "fulfilled" ? estimatesResult.value : null;
  const legacyConsensusRaw = legacyConsensusResult.status === "fulfilled" ? legacyConsensusResult.value : null;
  const legacySummaryRaw = legacySummaryResult.status === "fulfilled" ? legacySummaryResult.value : null;
  const legacyTargetsRaw = legacyTargetsResult.status === "fulfilled" ? legacyTargetsResult.value : null;
  const rows = [
    ...records(consensusRaw),
    ...records(summaryRaw),
    ...records(estimatesRaw),
    ...records(legacyConsensusRaw),
    ...records(legacySummaryRaw),
  ];

  const targetRow = firstWithNumber(rows, [
    "targetConsensus",
    "targetMedian",
    "targetMean",
    "targetAverage",
    "median",
    "priceTargetAverage",
    "priceTargetAvg",
    "priceTargetMedian",
    "estimatedPriceTargetAvg",
  ]);
  if (!targetRow) return null;

  const meanTarget = numberFrom(targetRow, [
    "targetConsensus",
    "targetMedian",
    "targetMean",
    "targetAverage",
    "median",
    "priceTargetAverage",
    "priceTargetAvg",
    "priceTargetMedian",
    "estimatedPriceTargetAvg",
  ]);
  const highTarget = numberFrom(targetRow, [
    "targetHigh",
    "targetHighest",
    "priceTargetHigh",
    "estimatedPriceTargetHigh",
    "high",
  ]);
  const lowTarget = numberFrom(targetRow, [
    "targetLow",
    "targetLowest",
    "priceTargetLow",
    "estimatedPriceTargetLow",
    "low",
  ]);
  const ratingCount = numberFrom(targetRow, [
    "numberOfAnalysts",
    "numberOfAnalyst",
    "analystCount",
    "ratingCount",
    "analysts",
  ]);

  const individualTargets = records(legacyTargetsRaw)
    .map(row => numberFrom(row, [
      "priceTarget",
      "priceTargetNew",
      "targetPrice",
      "target",
      "targetTo",
    ]))
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  const individualMean = individualTargets.length
    ? individualTargets.reduce((sum, value) => sum + value, 0) / individualTargets.length
    : null;
  const individualHigh = individualTargets.length ? Math.max(...individualTargets) : null;
  const individualLow = individualTargets.length ? Math.min(...individualTargets) : null;

  if (meanTarget == null && highTarget == null && lowTarget == null && individualMean == null) return null;

  return {
    mean_target: meanTarget ?? individualMean,
    high_target: highTarget ?? individualHigh,
    low_target: lowTarget ?? individualLow,
    rating_count: ratingCount ?? (individualTargets.length || null),
    strong_buy: 0,
    buy: 0,
    hold: 0,
    sell: 0,
    strong_sell: 0,
    source: "fmp",
    raw: combineRaw({
      consensus: consensusRaw,
      summary: summaryRaw,
      estimates: estimatesRaw,
      legacyConsensus: legacyConsensusRaw,
      legacySummary: legacySummaryRaw,
      legacyTargets: legacyTargetsRaw,
    }),
  };
}

function recentClosedQuarters(limit = 2): Array<{ year: number; quarter: number }> {
  const now = new Date();
  let year = now.getUTCFullYear();
  let quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  quarter -= 1;
  if (quarter === 0) {
    quarter = 4;
    year -= 1;
  }
  const out: Array<{ year: number; quarter: number }> = [];
  for (let i = 0; i < limit; i++) {
    out.push({ year, quarter });
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
  }
  return out;
}

function parseInstitutionalHolder(row: Record<string, unknown>): InstitutionalHolder | null {
  const holder = stringFrom(row, ["holder", "holderName", "investorName", "name", "companyName", "institution"]);
  if (!holder) return null;
  const pctHeld = normalizePct(numberFrom(row, [
    "pct_held",
    "ownership",
    "ownershipPercent",
    "changeInOwnershipPercentage",
    "weight",
    "portfolioWeight",
  ]));
  return {
    holder,
    pct_held: pctHeld,
    shares: numberFrom(row, ["shares", "sharesHeld", "reportedShares", "valueShares", "sshPrnamt"]),
  };
}

export async function fetchFmpInstitutionalOwnership(symbol: string): Promise<FmpInstitutionalOwnership | null> {
  const upper = symbol.toUpperCase();
  const quarterUrls = recentClosedQuarters(2).map(({ year, quarter }) =>
    stableUrl("institutional-ownership/symbol-positions-summary", {
      symbol: upper,
      year,
      quarter,
    }),
  );

  const [holdersResult, ...summaryResults] = await Promise.allSettled([
    fetchJson(stableUrl("institutional-ownership/symbol-ownership", {
      symbol: upper,
      includeCurrentQuarter: "false",
    })),
    fetchJson(legacyV4Url("institutional-ownership/symbol-ownership", {
      symbol: upper,
      includeCurrentQuarter: "false",
    })),
    fetchJson(legacyUrl(`institutional-holder/${encodeURIComponent(upper)}`)),
    ...quarterUrls.map(url => fetchJson(url)),
  ]);

  const symbolOwnershipRaw = holdersResult.status === "fulfilled" ? holdersResult.value : null;
  const legacySymbolOwnershipRaw = summaryResults[0]?.status === "fulfilled" ? summaryResults[0].value : null;
  const holdersRaw = summaryResults[1]?.status === "fulfilled" ? summaryResults[1].value : null;
  const summaryRaw = summaryResults
    .slice(2)
    .filter((result): result is PromiseFulfilledResult<unknown> => result.status === "fulfilled")
    .map(result => result.value);

  const topHolders = [
    ...records(symbolOwnershipRaw),
    ...records(legacySymbolOwnershipRaw),
    ...records(holdersRaw),
  ]
    .map(parseInstitutionalHolder)
    .filter((item): item is InstitutionalHolder => item != null)
    .slice(0, 10);

  const summaryRows = [
    ...records(symbolOwnershipRaw),
    ...records(legacySymbolOwnershipRaw),
    ...summaryRaw.flatMap(records),
  ];
  const summary = firstWithNumber(summaryRows, [
    "ownershipPercent",
    "institutionalOwnershipPercentage",
    "percentOfSharesOutstanding",
    "percentage",
    "ownershipPercentage",
    "institutionalOwnership",
    "pct_institutions",
  ]);
  const pctInstitutions = normalizePct(numberFrom(summary, [
    "ownershipPercent",
    "institutionalOwnershipPercentage",
    "percentOfSharesOutstanding",
    "percentage",
    "ownershipPercentage",
    "institutionalOwnership",
    "pct_institutions",
  ]));

  if (topHolders.length === 0 && pctInstitutions == null) return null;

  return {
    pct_insider: null,
    pct_institutions: pctInstitutions,
    top_holders: topHolders,
    source: "fmp",
    raw: combineRaw({
      symbolOwnership: symbolOwnershipRaw,
      legacySymbolOwnership: legacySymbolOwnershipRaw,
      holders: holdersRaw,
      summary: summaryRaw,
    }),
  };
}

function parseFactPeriod(row: Record<string, unknown>, valueKeys: string[]): EdgarFactPeriod | null {
  const value = numberFrom(row, valueKeys);
  if (value == null) return null;
  const period =
    stringFrom(row, ["date", "calendarDate", "periodDate", "fiscalDateEnding"]) ??
    [
      stringFrom(row, ["calendarYear", "fiscalYear", "year"]),
      stringFrom(row, ["period", "quarter"]),
    ].filter(Boolean).join("-");
  return {
    period: period || "unknown",
    value,
    form: "FMP-Q",
  };
}

export async function fetchFmpQuarterlyFacts(symbol: string): Promise<FmpQuarterlyFacts | null> {
  const upper = symbol.toUpperCase();
  const raw = await fetchJson(stableUrl("income-statement", {
    symbol: upper,
    period: "quarter",
    limit: 6,
  }));
  const rows = records(raw);
  if (!rows.length) return null;

  const revenue = rows
    .map(row => parseFactPeriod(row, ["revenue", "reportedRevenue"]))
    .filter((item): item is EdgarFactPeriod => item != null);
  const netIncome = rows
    .map(row => parseFactPeriod(row, ["netIncome", "net_income", "netIncomeLoss"]))
    .filter((item): item is EdgarFactPeriod => item != null);
  const grossProfit = rows
    .map(row => parseFactPeriod(row, ["grossProfit", "gross_profit"]))
    .filter((item): item is EdgarFactPeriod => item != null);

  if (!revenue.length && !netIncome.length && !grossProfit.length) return null;

  return {
    cik: "",
    revenue,
    net_income: netIncome,
    gross_profit: grossProfit,
    source: "fmp",
    raw,
  };
}
