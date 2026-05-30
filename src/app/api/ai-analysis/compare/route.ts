import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { KAI_SYSTEM_PROMPT } from "@/lib/ai-analysis/agent-prompts";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { fetchGoogleNews } from "@/lib/finance-client";
import { enrichWithDescriptions } from "@/lib/article-fetch";
import { PEER_MAP } from "@/lib/peer-map";
import type { AssetSnapshot, AnalysisScore } from "@/types/database";
import type { GoogleNewsItem } from "@/lib/finance-client";

type NewsItemWithDesc = GoogleNewsItem & { description: string | null };

// --- In-memory cache (2 h TTL, survives across requests on warm Vercel instances) ---
const _cache = new Map<string, { result: CompareResult; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

function cacheKey(a: string, b: string): string {
  return [a, b].sort().join("_");
}

function getCache(symbolA: string, symbolB: string): CompareResult | null {
  const entry = _cache.get(cacheKey(symbolA, symbolB));
  if (!entry || entry.expiresAt < Date.now()) {
    _cache.delete(cacheKey(symbolA, symbolB));
    return null;
  }
  return entry.result;
}

function setCache(result: CompareResult): void {
  _cache.set(cacheKey(result.symbolA, result.symbolB), {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export interface CompareResult {
  symbolA: string;
  symbolB: string;
  winner: string | null;
  summary: string;
  recommendation: string;
  a_strengths: string[];
  b_strengths: string[];
  a_weaknesses: string[];
  b_weaknesses: string[];
  verdict: string;
  analyzed_at: string;
}

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function parseJSON<T>(raw: string): T {
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON found");
  return JSON.parse(stripped.slice(start, end + 1)) as T;
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("");
}

function fmtBig(n: number | null): string {
  if (n == null) return "N/A";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)} T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} Mrd.`;
  return `${(n / 1e6).toFixed(2)} Mio.`;
}

function formatSnapshot(s: AssetSnapshot, score: AnalysisScore | null): string {
  return [
    `Symbol: ${s.symbol}`,
    `Preis: ${s.price?.toFixed(2) ?? "N/A"} ${s.currency ?? ""}`,
    `KGV: ${s.pe_ratio?.toFixed(1) ?? "N/A"}`,
    `Marktkapitalisierung: ${fmtBig(s.market_cap)}`,
    `Umsatzwachstum: ${s.revenue_growth != null ? (s.revenue_growth * 100).toFixed(1) + "%" : "N/A"}`,
    `Free Cashflow: ${fmtBig(s.free_cashflow)}`,
    `Debt/Equity: ${s.debt_to_equity?.toFixed(2) ?? "N/A"}`,
    `RSI (14): ${s.rsi?.toFixed(1) ?? "N/A"}`,
    `50-Tage-MA: ${s.moving_average_50?.toFixed(2) ?? "N/A"}`,
    `200-Tage-MA: ${s.moving_average_200?.toFixed(2) ?? "N/A"}`,
    score ? `Analyse-Score: ${score.total_score}/100 (${score.signal}) | Fundamental: ${score.fundamental_score} | Technisch: ${score.technical_score} | Risiko: ${score.risk_score}` : "Analyse-Score: N/A",
  ].join("\n");
}

async function getCachedSnapshot(symbol: string): Promise<AssetSnapshot | null> {
  const supabase = await createClient();
  // No time cutoff — any stored snapshot is sufficient for AI comparison
  const { data } = await supabase
    .from("asset_snapshots")
    .select("*")
    .eq("symbol", symbol)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .single();
  return (data as AssetSnapshot | null) ?? null;
}

async function getCachedScore(symbol: string): Promise<AnalysisScore | null> {
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("analysis_scores")
    .select("*")
    .eq("symbol", symbol)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return (data as AnalysisScore | null) ?? null;
}

async function getPeerAverages(symbol: string): Promise<string> {
  const peers = PEER_MAP[symbol];
  if (!peers?.length) return "";

  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("asset_snapshots")
    .select("symbol, pe_ratio, revenue_growth, debt_to_equity")
    .in("symbol", peers)
    .gte("fetched_at", cutoff)
    .order("fetched_at", { ascending: false });

  if (!data?.length) return "";

  const seen = new Set<string>();
  const rows = (data as { symbol: string; pe_ratio: number | null; revenue_growth: number | null; debt_to_equity: number | null }[])
    .filter(r => { if (seen.has(r.symbol)) return false; seen.add(r.symbol); return true; });

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const peVals   = rows.map(r => r.pe_ratio).filter((v): v is number => v != null);
  const grVals   = rows.map(r => r.revenue_growth).filter((v): v is number => v != null);
  const deVals   = rows.map(r => r.debt_to_equity).filter((v): v is number => v != null);
  const peAvg    = avg(peVals);
  const grAvg    = avg(grVals);
  const deAvg    = avg(deVals);

  const parts: string[] = [`Peers (${rows.map(r => r.symbol).join(", ")})`];
  if (peAvg != null) parts.push(`Ø KGV: ${peAvg.toFixed(1)}`);
  if (grAvg != null) parts.push(`Ø Wachstum: ${(grAvg * 100).toFixed(1)}%`);
  if (deAvg != null) parts.push(`Ø D/E: ${deAvg.toFixed(2)}`);
  return parts.length > 1 ? parts.join(" | ") : "";
}

function formatNews(symbol: string, news: NewsItemWithDesc[]): string {
  if (!news.length) return "";
  return `AKTUELLE NEWS ${symbol} (${news.length} Artikel):\n` +
    news.slice(0, 5).map(n => {
      const desc = n.description ? `\n     → ${n.description}` : "";
      return `  - [${n.source}] ${n.title}${desc}`;
    }).join("\n");
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const rl = rateLimit({ key: `compare:${user.id}`, limit: 10, windowSecs: 600 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte warte kurz." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsedA = tickerSchema.safeParse(body.symbolA);
  const parsedB = tickerSchema.safeParse(body.symbolB);
  if (!parsedA.success || !parsedB.success) {
    return NextResponse.json({ error: "Ungültige Ticker-Symbole" }, { status: 400 });
  }
  const symbolA = parsedA.data;
  const symbolB = parsedB.data;

  if (symbolA === symbolB) {
    return NextResponse.json({ error: "Bitte zwei verschiedene Aktien wählen" }, { status: 400 });
  }

  // Serve from cache if available (2 h TTL)
  const cached = getCache(symbolA, symbolB);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  // Frontend can pass asset data directly (avoids Supabase snapshot dependency)
  const frontendA: Partial<AssetSnapshot> | null = body.dataA ?? null;
  const frontendB: Partial<AssetSnapshot> | null = body.dataB ?? null;

  const [dbSnapshotA, dbSnapshotB, scoreA, scoreB, rawNewsA, rawNewsB, peerA, peerB] = await Promise.all([
    getCachedSnapshot(symbolA),
    getCachedSnapshot(symbolB),
    getCachedScore(symbolA),
    getCachedScore(symbolB),
    fetchGoogleNews(symbolA).catch(() => [] as GoogleNewsItem[]),
    fetchGoogleNews(symbolB).catch(() => [] as GoogleNewsItem[]),
    getPeerAverages(symbolA).catch(() => ""),
    getPeerAverages(symbolB).catch(() => ""),
  ]);

  // Enrich both news lists with Jina article content in parallel
  const [newsA, newsB] = await Promise.all([
    enrichWithDescriptions(rawNewsA),
    enrichWithDescriptions(rawNewsB),
  ]);

  // Use DB snapshot if available, fall back to frontend-provided data
  const snapshotA = dbSnapshotA ?? (frontendA ? { ...frontendA, id: "", symbol: symbolA, fetched_at: new Date().toISOString() } as AssetSnapshot : null);
  const snapshotB = dbSnapshotB ?? (frontendB ? { ...frontendB, id: "", symbol: symbolB, fetched_at: new Date().toISOString() } as AssetSnapshot : null);

  if (!snapshotA || !snapshotB) {
    return NextResponse.json(
      { error: "Für einen Vergleich müssen beide Aktien zuerst geladen werden." },
      { status: 422 }
    );
  }

  const newsSectionA = formatNews(symbolA, newsA);
  const newsSectionB = formatNews(symbolB, newsB);

  const prompt = `Du bist Kai, ein Vergleichs-Analyst. Vergleiche diese zwei Aktien für einen wachstumsorientierten Investor und gib eine klare, begründete Empfehlung. Berücksichtige Kennzahlen, Branchen-Kontext UND aktuelle Nachrichtenlage.

=== ${symbolA} ===
${formatSnapshot(snapshotA, scoreA)}
${peerA ? `\nBRANCHEN-KONTEXT ${symbolA}: ${peerA}` : ""}
${newsSectionA ? `\n${newsSectionA}` : ""}

=== ${symbolB} ===
${formatSnapshot(snapshotB, scoreB)}
${peerB ? `\nBRANCHEN-KONTEXT ${symbolB}: ${peerB}` : ""}
${newsSectionB ? `\n${newsSectionB}` : ""}

Antworte ausschließlich mit validem JSON:
{
  "winner": "${symbolA}" oder "${symbolB}" oder null (wenn sehr ausgeglichen),
  "summary": "2-3 Sätze Gesamtbild des Vergleichs inkl. Sentiment und Branchen-Einordnung",
  "recommendation": "Klare Handlungsempfehlung (1 Satz)",
  "a_strengths": ["Stärke 1", "Stärke 2", "Stärke 3"],
  "b_strengths": ["Stärke 1", "Stärke 2", "Stärke 3"],
  "a_weaknesses": ["Schwäche 1", "Schwäche 2"],
  "b_weaknesses": ["Schwäche 1", "Schwäche 2"],
  "verdict": "Abschließendes Urteil in 1-2 Sätzen mit konkreter Begründung"
}`;

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      system: KAI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = extractText(response.content);
    const result = parseJSON<Omit<CompareResult, "symbolA" | "symbolB" | "analyzed_at">>(raw);

    const compareResult: CompareResult = {
      symbolA,
      symbolB,
      ...result,
      analyzed_at: new Date().toISOString(),
    };
    setCache(compareResult);
    return NextResponse.json(compareResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
