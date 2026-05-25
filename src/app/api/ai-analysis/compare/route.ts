import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import type { AssetSnapshot, AnalysisScore } from "@/types/database";

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

  // Frontend can pass asset data directly (avoids Supabase snapshot dependency)
  const frontendA: Partial<AssetSnapshot> | null = body.dataA ?? null;
  const frontendB: Partial<AssetSnapshot> | null = body.dataB ?? null;

  const [dbSnapshotA, dbSnapshotB, scoreA, scoreB] = await Promise.all([
    getCachedSnapshot(symbolA),
    getCachedSnapshot(symbolB),
    getCachedScore(symbolA),
    getCachedScore(symbolB),
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

  const prompt = `Du bist Kai, ein Vergleichs-Analyst. Vergleiche diese zwei Aktien für einen wachstumsorientierten Investor und gib eine klare Empfehlung.

=== ${symbolA} ===
${formatSnapshot(snapshotA, scoreA)}

=== ${symbolB} ===
${formatSnapshot(snapshotB, scoreB)}

Antworte ausschließlich mit validem JSON:
{
  "winner": "${symbolA}" oder "${symbolB}" oder null (wenn sehr ausgeglichen),
  "summary": "2-3 Sätze Gesamtbild des Vergleichs",
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
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: "Du bist Kai, ein präziser Aktienvergleichs-Analyst. Antworte ausschließlich mit validem JSON.",
      messages: [{ role: "user", content: prompt }],
    });

    const raw = extractText(response.content);
    const result = parseJSON<Omit<CompareResult, "symbolA" | "symbolB" | "analyzed_at">>(raw);

    return NextResponse.json({
      symbolA,
      symbolB,
      ...result,
      analyzed_at: new Date().toISOString(),
    } satisfies CompareResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
