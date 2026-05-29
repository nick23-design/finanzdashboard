import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAssetDataQuick, fetchEdgarFacts } from "@/lib/finance-client";
import type { EdgarFacts } from "@/lib/finance-client";
import { expandSymbolsWithPeers, normalizeTickerSymbol } from "@/lib/peer-utils";
import {
  fetchFmpAnalystConsensus,
  fetchFmpInstitutionalOwnership,
  fetchFmpQuarterlyFacts,
} from "@/lib/fmp-client";
import {
  recordProviderFieldStatus,
  saveFmpAnalystConsensus,
  saveFmpInstitutionalOwnership,
  saveFundamentalFacts,
} from "@/lib/research-cache";
import type { Database, Json } from "@/types/database";

export const maxDuration = 300;

type ProviderRunInsert = Database["public"]["Tables"]["provider_runs"]["Insert"];
type ProviderRunUpdate = Database["public"]["Tables"]["provider_runs"]["Update"];
type ProviderFieldStatusInsert = Database["public"]["Tables"]["provider_field_status"]["Insert"];
type AssetSnapshotInsert = Database["public"]["Tables"]["asset_snapshots"]["Insert"];

const DEFAULT_LIMIT = 25;
const FALLBACK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AVGO", "AMZN", "GOOGL", "META"];

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function hasFacts(facts: EdgarFacts | null): boolean {
  return Boolean(
    facts &&
    (facts.revenue.length > 0 || facts.net_income.length > 0 || facts.gross_profit.length > 0),
  );
}

async function saveAssetSnapshot(
  client: ReturnType<typeof createServiceClient>,
  raw: Awaited<ReturnType<typeof fetchAssetDataQuick>>,
): Promise<void> {
  const payload: AssetSnapshotInsert = {
    symbol: raw.symbol,
    price: raw.price,
    currency: raw.currency,
    isin: raw.isin ?? null,
    description: raw.description ?? null,
    pe_ratio: raw.pe_ratio,
    market_cap: raw.market_cap,
    debt_to_equity: raw.debt_to_equity,
    revenue_growth: raw.revenue_growth,
    free_cashflow: raw.free_cashflow,
    rsi: raw.rsi,
    moving_average_50: raw.moving_average_50,
    moving_average_200: raw.moving_average_200,
  };
  const { error } = await client.from("asset_snapshots").insert(payload);
  if (error) throw new Error(error.message);
}

function hasYahooFallback(facts: EdgarFacts | null): boolean {
  if (!facts) return false;
  return [
    ...facts.revenue,
    ...facts.net_income,
    ...facts.gross_profit,
  ].some(item => String(item.form ?? "").startsWith("YF"));
}

function settledError(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === "fulfilled") return null;
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

async function collectSymbols(
  client: ReturnType<typeof createServiceClient>,
  request: NextRequest,
): Promise<string[]> {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.round(limitRaw))) : DEFAULT_LIMIT;
  const includePeers = url.searchParams.get("includePeers") !== "false";
  const explicit = url.searchParams.get("symbols");
  if (explicit) {
    const seedSymbols = [...new Set(explicit.split(",").map(normalizeTickerSymbol).filter((s): s is string => s != null))];
    return includePeers ? expandSymbolsWithPeers(seedSymbols, limit) : seedSymbols.slice(0, limit);
  }

  const [watchlistResult, portfolioResult, recentAnalysisResult] = await Promise.all([
    client.from("watchlist_items").select("symbol").limit(200),
    client.from("portfolio_positions").select("symbol").limit(200),
    client.from("ai_analyses").select("symbol").order("analyzed_at", { ascending: false }).limit(50),
  ]);

  const symbols = new Set<string>();
  for (const source of [watchlistResult.data, portfolioResult.data, recentAnalysisResult.data]) {
    for (const row of source ?? []) {
      const symbol = normalizeTickerSymbol(row.symbol);
      if (symbol) symbols.add(symbol);
    }
  }
  if (symbols.size === 0) {
    FALLBACK_SYMBOLS.forEach(symbol => symbols.add(symbol));
  }
  const seedSymbols = [...symbols];
  return includePeers ? expandSymbolsWithPeers(seedSymbols, limit) : seedSymbols.slice(0, limit);
}

async function refreshSymbol(
  client: ReturnType<typeof createServiceClient>,
  symbol: string,
): Promise<{ symbol: string; ok: string[]; missing: string[]; errors: Record<string, string> }> {
  const ok: string[] = [];
  const missing: string[] = [];
  const errors: Record<string, string> = {};
  const statusRows: ProviderFieldStatusInsert[] = [];

  const pushStatus = (
    field: string,
    status: ProviderFieldStatusInsert["status"],
    detail?: string,
  ) => {
    statusRows.push({
      symbol,
      provider: field === "asset_snapshot"
        ? "finance_api"
        : field === "quarterly_facts"
          ? "finance_api/fmp"
          : "fmp",
      field,
      status,
      detail: detail ? detail.slice(0, 500) : null,
    });
  };

  const [assetResult, analystResult, institutionalResult, fmpFactsResult, financeFactsResult] = await Promise.allSettled([
    fetchAssetDataQuick(symbol),
    fetchFmpAnalystConsensus(symbol),
    fetchFmpInstitutionalOwnership(symbol),
    fetchFmpQuarterlyFacts(symbol),
    fetchEdgarFacts(symbol),
  ]);

  if (assetResult.status === "fulfilled" && assetResult.value) {
    await saveAssetSnapshot(client, assetResult.value);
    ok.push("asset_snapshot");
    pushStatus("asset_snapshot", "ok", "Finance API asset snapshot cached for analysis/peer context");
  } else {
    const error = settledError(assetResult);
    if (error) errors.asset_snapshot = error;
    missing.push("asset_snapshot");
    pushStatus("asset_snapshot", error ? "error" : "missing", error ?? "Finance API returned no asset snapshot");
  }

  if (analystResult.status === "fulfilled" && analystResult.value) {
    await saveFmpAnalystConsensus(client, symbol, analystResult.value);
    ok.push("analyst_consensus");
    pushStatus("analyst_consensus", "ok", "FMP price target consensus cached");
  } else {
    const error = settledError(analystResult);
    if (error) errors.analyst_consensus = error;
    missing.push("analyst_consensus");
    pushStatus("analyst_consensus", error ? "error" : "missing", error ?? "FMP returned no analyst consensus");
  }

  if (institutionalResult.status === "fulfilled" && institutionalResult.value) {
    await saveFmpInstitutionalOwnership(client, symbol, institutionalResult.value);
    ok.push("institutional_ownership");
    pushStatus("institutional_ownership", "ok", "FMP institutional ownership cached");
  } else {
    const error = settledError(institutionalResult);
    if (error) errors.institutional_ownership = error;
    missing.push("institutional_ownership");
    pushStatus("institutional_ownership", error ? "error" : "missing", error ?? "FMP returned no institutional ownership");
  }

  const financeFacts = financeFactsResult.status === "fulfilled" ? financeFactsResult.value : null;
  const fmpFacts = fmpFactsResult.status === "fulfilled" ? fmpFactsResult.value : null;
  const bestFacts =
    hasFacts(financeFacts) && !hasYahooFallback(financeFacts)
      ? { provider: "sec_finance_api", facts: financeFacts as EdgarFacts }
      : hasFacts(fmpFacts)
        ? { provider: "fmp", facts: fmpFacts as EdgarFacts }
        : hasFacts(financeFacts)
          ? { provider: "finance_api_yahoo_fallback", facts: financeFacts as EdgarFacts }
          : null;

  if (bestFacts) {
    await saveFundamentalFacts(client, symbol, bestFacts.provider, bestFacts.facts);
    ok.push("quarterly_facts");
    pushStatus("quarterly_facts", "ok", `Cached via ${bestFacts.provider}`);
  } else {
    const fmpError = settledError(fmpFactsResult);
    const financeError = settledError(financeFactsResult);
    const detail = [fmpError ? `fmp: ${fmpError}` : null, financeError ? `finance_api: ${financeError}` : null]
      .filter(Boolean)
      .join(" | ");
    if (detail) errors.quarterly_facts = detail;
    missing.push("quarterly_facts");
    pushStatus("quarterly_facts", detail ? "error" : "missing", detail || "No quarterly facts returned");
  }

  await recordProviderFieldStatus(client, statusRows);
  return { symbol, ok, missing, errors };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const client = createServiceClient();
  const symbols = await collectSymbols(client, request);
  const runId = crypto.randomUUID();

  const runPayload: ProviderRunInsert = {
    id: runId,
    provider: "fmp",
    job_type: "refresh_research_data",
    status: "running",
    symbols: asJson(symbols),
  };
  await client.from("provider_runs").insert(runPayload);

  const results: Array<Awaited<ReturnType<typeof refreshSymbol>>> = [];
  let fatalError: string | null = null;

  try {
    for (const symbol of symbols) {
      results.push(await refreshSymbol(client, symbol));
    }
  } catch (err) {
    fatalError = err instanceof Error ? err.message : String(err);
  }

  const finished = new Date().toISOString();
  const durationMs = Date.now() - started;
  const failedSymbols = results.filter(item => item.missing.length > 0 || Object.keys(item.errors).length > 0).length;
  const status: ProviderRunUpdate["status"] = fatalError
    ? "error"
    : failedSymbols > 0
      ? "partial"
      : "ok";

  const updatePayload: ProviderRunUpdate = {
    status,
    finished_at: finished,
    duration_ms: durationMs,
    details: asJson({ results }),
    error: fatalError,
  };
  await client.from("provider_runs").update(updatePayload).eq("id", runId);

  return NextResponse.json({
    ok: status !== "error",
    status,
    symbols: symbols.length,
    failedSymbols,
    durationMs,
    results,
    error: fatalError,
  }, { status: fatalError ? 500 : 200 });
}
