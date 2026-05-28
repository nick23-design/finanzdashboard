import type {
  AnalystData,
  EdgarFactPeriod,
  EdgarFacts,
  InstitutionalData,
  InstitutionalHolder,
} from "@/lib/finance-client";
import type { FmpAnalystConsensus, FmpInstitutionalOwnership, FmpQuarterlyFacts } from "@/lib/fmp-client";
import type { Database, Json } from "@/types/database";
import type { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;
type AnalystConsensusInsert = Database["public"]["Tables"]["analyst_consensus"]["Insert"];
type InstitutionalOwnershipInsert = Database["public"]["Tables"]["institutional_ownership"]["Insert"];
type FundamentalFactsInsert = Database["public"]["Tables"]["fundamental_facts"]["Insert"];
type ProviderFieldStatusInsert = Database["public"]["Tables"]["provider_field_status"]["Insert"];

const ANALYST_CACHE_DAYS = 7;
const OWNERSHIP_CACHE_DAYS = 120;
const FUNDAMENTAL_CACHE_DAYS = 30;

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseFactPeriods(value: Json): EdgarFactPeriod[] {
  if (!Array.isArray(value)) return [];
  const rows = value.filter(isRecord) as Array<Record<string, unknown>>;
  return rows.map(item => ({
    period: String(item.period ?? "unknown"),
    value: Number(item.value ?? 0),
    form: String(item.form ?? "CACHE"),
  })).filter(item => Number.isFinite(item.value));
}

function parseTopHolders(value: Json): InstitutionalHolder[] {
  if (!Array.isArray(value)) return [];
  const rows = value.filter(isRecord) as Array<Record<string, unknown>>;
  return rows.map(item => ({
    holder: String(item.holder ?? ""),
    pct_held: item.pct_held == null ? null : Number(item.pct_held),
    shares: item.shares == null ? null : Number(item.shares),
  })).filter(item => item.holder);
}

export async function fetchCachedAnalystData(
  client: ServiceClient,
  symbol: string,
): Promise<AnalystData | null> {
  const { data, error } = await client
    .from("analyst_consensus")
    .select("provider, mean_target, high_target, low_target, rating_count, strong_buy, buy, hold, sell, strong_sell")
    .eq("symbol", symbol.toUpperCase())
    .gte("fetched_at", cutoffIso(ANALYST_CACHE_DAYS))
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    mean_target: data.mean_target,
    high_target: data.high_target,
    low_target: data.low_target,
    rating_count: data.rating_count,
    strong_buy: data.strong_buy ?? 0,
    buy: data.buy ?? 0,
    hold: data.hold ?? 0,
    sell: data.sell ?? 0,
    strong_sell: data.strong_sell ?? 0,
    source: `${data.provider}_cache`,
  };
}

export async function fetchCachedInstitutionalData(
  client: ServiceClient,
  symbol: string,
): Promise<InstitutionalData | null> {
  const { data, error } = await client
    .from("institutional_ownership")
    .select("provider, pct_insider, pct_institutions, top_holders")
    .eq("symbol", symbol.toUpperCase())
    .gte("fetched_at", cutoffIso(OWNERSHIP_CACHE_DAYS))
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const topHolders = parseTopHolders(data.top_holders);
  if (data.pct_institutions == null && data.pct_insider == null && topHolders.length === 0) {
    return null;
  }

  return {
    pct_insider: data.pct_insider,
    pct_institutions: data.pct_institutions,
    top_holders: topHolders,
    source: `${data.provider}_cache`,
  };
}

export async function fetchCachedFundamentalFacts(
  client: ServiceClient,
  symbol: string,
): Promise<EdgarFacts | null> {
  const { data, error } = await client
    .from("fundamental_facts")
    .select("provider, cik, revenue, net_income, gross_profit")
    .eq("symbol", symbol.toUpperCase())
    .gte("fetched_at", cutoffIso(FUNDAMENTAL_CACHE_DAYS))
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const facts: EdgarFacts = {
    cik: data.cik ?? "",
    revenue: parseFactPeriods(data.revenue),
    net_income: parseFactPeriods(data.net_income),
    gross_profit: parseFactPeriods(data.gross_profit),
    source: `${data.provider}_cache`,
  };

  if (!facts.revenue.length && !facts.net_income.length && !facts.gross_profit.length) {
    return null;
  }
  return facts;
}

export async function loadCachedResearchData(client: ServiceClient, symbol: string) {
  const [analystData, institutional, fundamentalFacts] = await Promise.all([
    fetchCachedAnalystData(client, symbol),
    fetchCachedInstitutionalData(client, symbol),
    fetchCachedFundamentalFacts(client, symbol),
  ]);

  return { analystData, institutional, fundamentalFacts };
}

export async function saveFmpAnalystConsensus(
  client: ServiceClient,
  symbol: string,
  data: FmpAnalystConsensus,
): Promise<void> {
  const payload: AnalystConsensusInsert = {
    symbol: symbol.toUpperCase(),
    provider: "fmp",
    mean_target: data.mean_target,
    high_target: data.high_target,
    low_target: data.low_target,
    rating_count: data.rating_count ?? null,
    strong_buy: data.strong_buy,
    buy: data.buy,
    hold: data.hold,
    sell: data.sell,
    strong_sell: data.strong_sell,
    raw: asJson(data.raw),
  };
  const { error } = await client.from("analyst_consensus").insert(payload);
  if (error) throw new Error(error.message);
}

export async function saveFmpInstitutionalOwnership(
  client: ServiceClient,
  symbol: string,
  data: FmpInstitutionalOwnership,
): Promise<void> {
  const payload: InstitutionalOwnershipInsert = {
    symbol: symbol.toUpperCase(),
    provider: "fmp",
    pct_insider: data.pct_insider,
    pct_institutions: data.pct_institutions,
    top_holders: asJson(data.top_holders),
    raw: asJson(data.raw),
  };
  const { error } = await client.from("institutional_ownership").insert(payload);
  if (error) throw new Error(error.message);
}

export async function saveFundamentalFacts(
  client: ServiceClient,
  symbol: string,
  provider: string,
  data: EdgarFacts | FmpQuarterlyFacts,
): Promise<void> {
  const payload: FundamentalFactsInsert = {
    symbol: symbol.toUpperCase(),
    provider,
    cik: data.cik || null,
    revenue: asJson(data.revenue),
    net_income: asJson(data.net_income),
    gross_profit: asJson(data.gross_profit),
    raw: asJson("raw" in data ? data.raw : data),
  };
  const { error } = await client.from("fundamental_facts").insert(payload);
  if (error) throw new Error(error.message);
}

export async function recordProviderFieldStatus(
  client: ServiceClient,
  rows: ProviderFieldStatusInsert[],
): Promise<void> {
  if (!rows.length) return;
  const { error } = await client.from("provider_field_status").insert(rows);
  if (error) throw new Error(error.message);
}
