import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import Anthropic from "@anthropic-ai/sdk";
import { PEER_MAP } from "@/lib/peer-map";


function parseJSON<T>(raw: string): T {
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found");
  return JSON.parse(stripped.slice(start, end + 1)) as T;
}

async function getPeersFromAI(symbol: string): Promise<string[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    system: "You are a financial data assistant. Respond only with a valid JSON array of ticker symbols, nothing else.",
    messages: [{
      role: "user",
      content: `Name exactly 3 direct stock market competitors of ${symbol}. Return only a JSON array of their ticker symbols as traded on major exchanges, e.g. ["MSFT","GOOGL","META"]. No explanation.`,
    }],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map(b => b.text).join("");

  const peers = parseJSON<string[]>(text);
  return peers
    .map(s => s.toUpperCase().trim())
    .filter(s => s !== symbol && /^[A-Z0-9.]{1,10}$/.test(s))
    .slice(0, 3);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const { symbol: rawSymbol } = await params;
  const parsed = tickerSchema.safeParse(rawSymbol);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Symbol" }, { status: 400 });
  }
  const symbol = parsed.data;

  // Try static map first
  const staticPeers = PEER_MAP[symbol];
  if (staticPeers) {
    return NextResponse.json(staticPeers);
  }

  // Fall back to AI
  try {
    const peers = await getPeersFromAI(symbol);
    return NextResponse.json(peers);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
