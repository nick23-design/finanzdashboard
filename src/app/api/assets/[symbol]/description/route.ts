import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { fetchAssetData } from "@/lib/finance-client";

// German company descriptions are translated lazily (only when the user opens
// the info panel) from the English yfinance business summary, then cached
// in-process so repeated views of the same symbol do not re-spend tokens.
const TRANSLATION_MODEL = "claude-haiku-4-5-20251001";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type DescriptionResult = { de: string; source: "translated" | "original" | "none" };

const cache = new Map<string, { value: DescriptionResult; expiresAt: number }>();

async function getEnglishDescription(symbol: string): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("asset_snapshots")
      .select("description")
      .eq("symbol", symbol)
      .not("description", "is", null)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .single();
    const cachedDescription = (data as { description: string | null } | null)?.description;
    if (cachedDescription && cachedDescription.trim()) return cachedDescription;
  } catch {
    // fall through to live fetch
  }

  try {
    const raw = await fetchAssetData(symbol);
    const desc = typeof raw.description === "string" ? raw.description : null;
    return desc && desc.trim() ? desc : null;
  } catch {
    return null;
  }
}

async function translateToGerman(text: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30_000 });
  const response = await client.messages.create({
    model: TRANSLATION_MODEL,
    max_tokens: 700,
    system:
      "Du bist ein präziser Finanzübersetzer. Übersetze die englische Unternehmensbeschreibung in natürliches, sachliches Deutsch. " +
      "Behalte Eigennamen, Produktnamen und Markennamen bei. Gib ausschließlich den übersetzten Fließtext zurück, ohne Vorbemerkung, ohne Anführungszeichen.",
    messages: [{ role: "user", content: text }],
  });
  return response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const { symbol: rawSymbol } = await params;
  const parsed = tickerSchema.safeParse(rawSymbol);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Ticker-Symbol" }, { status: 400 });
  }
  const symbol = parsed.data;

  const hit = cache.get(symbol);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json(hit.value);
  }

  const english = await getEnglishDescription(symbol);
  if (!english) {
    const result: DescriptionResult = { de: "", source: "none" };
    cache.set(symbol, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(result);
  }

  let result: DescriptionResult;
  try {
    const de = await translateToGerman(english);
    result = de
      ? { de, source: "translated" }
      : { de: english, source: "original" };
  } catch {
    // If translation fails, return the English text rather than nothing.
    result = { de: english, source: "original" };
  }

  cache.set(symbol, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return NextResponse.json(result);
}
