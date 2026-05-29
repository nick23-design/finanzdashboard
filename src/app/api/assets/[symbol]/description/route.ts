import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAssetData } from "@/lib/finance-client";

// German company descriptions are translated once from the English yfinance
// business summary and persisted in `company_descriptions` (keyed by symbol),
// so repeated views never re-spend tokens. A manual refresh re-translates and
// bumps updated_at.
const TRANSLATION_MODEL = "claude-haiku-4-5-20251001";

type DescriptionResult = {
  de: string;
  source: "translated" | "original" | "none";
  updatedAt: string | null;
};

async function getStoredDescription(symbol: string): Promise<DescriptionResult | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("company_descriptions")
      .select("description_de, source, updated_at")
      .eq("symbol", symbol)
      .single();
    const row = data as { description_de: string; source: string; updated_at: string } | null;
    if (row?.description_de) {
      return {
        de: row.description_de,
        source: row.source === "original" ? "original" : "translated",
        updatedAt: row.updated_at,
      };
    }
  } catch {
    // table missing or no row — fall through to translation
  }
  return null;
}

async function storeDescription(symbol: string, de: string, source: "translated" | "original"): Promise<string> {
  const updatedAt = new Date().toISOString();
  try {
    const service = createServiceClient();
    await service
      .from("company_descriptions")
      .upsert({ symbol, description_de: de, source, updated_at: updatedAt }, { onConflict: "symbol" });
  } catch {
    // Persistence is best-effort; the translation is still returned to the client.
  }
  return updatedAt;
}

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
  request: NextRequest,
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

  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "true";

  // Serve the persisted translation unless a refresh was explicitly requested.
  if (!forceRefresh) {
    const stored = await getStoredDescription(symbol);
    if (stored) return NextResponse.json(stored);
  }

  const english = await getEnglishDescription(symbol);
  if (!english) {
    return NextResponse.json({ de: "", source: "none", updatedAt: null } satisfies DescriptionResult);
  }

  let de: string;
  let source: "translated" | "original";
  try {
    const translated = await translateToGerman(english);
    de = translated || english;
    source = translated ? "translated" : "original";
  } catch {
    // If translation fails, return the English text rather than nothing.
    de = english;
    source = "original";
  }

  const updatedAt = await storeDescription(symbol, de, source);
  return NextResponse.json({ de, source, updatedAt } satisfies DescriptionResult);
}
