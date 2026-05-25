import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import Anthropic from "@anthropic-ai/sdk";

// Static peer map for common stocks — avoids AI call for frequent lookups
const PEER_MAP: Record<string, string[]> = {
  // US Tech
  AAPL:  ["MSFT", "GOOGL", "SAMSUNG"],
  MSFT:  ["AAPL", "GOOGL", "AMZN"],
  GOOGL: ["META", "MSFT", "AMZN"],
  GOOG:  ["META", "MSFT", "AMZN"],
  META:  ["GOOGL", "SNAP", "PINS"],
  AMZN:  ["MSFT", "GOOGL", "WMT"],
  NVDA:  ["AMD", "INTC", "QCOM"],
  AMD:   ["NVDA", "INTC", "QCOM"],
  INTC:  ["NVDA", "AMD", "QCOM"],
  TSLA:  ["GM", "F", "RIVN"],
  NFLX:  ["DIS", "WBD", "PARA"],
  CRM:   ["ORCL", "SAP", "NOW"],
  ORCL:  ["MSFT", "SAP", "CRM"],
  NOW:   ["CRM", "ORCL", "WDAY"],
  SHOP:  ["AMZN", "WMT", "ETSY"],
  PYPL:  ["V", "MA", "SQ"],
  SQ:    ["PYPL", "V", "MA"],
  V:     ["MA", "PYPL", "AXP"],
  MA:    ["V", "PYPL", "AXP"],
  JPM:   ["BAC", "WFC", "GS"],
  BAC:   ["JPM", "WFC", "C"],
  GS:    ["JPM", "MS", "BAC"],
  // US Other
  WMT:   ["AMZN", "TGT", "COST"],
  TGT:   ["WMT", "AMZN", "COST"],
  UNH:   ["CVS", "CI", "HUM"],
  JNJ:   ["PFE", "ABT", "MRK"],
  PFE:   ["JNJ", "MRK", "ABBV"],
  // German / European
  SAP:   ["ORCL", "CRM", "MSFT"],
  SIE:   ["ABB", "HON", "ETN"],
  ALV:   ["AXA", "MUV2", "Z"],
  BMW:   ["MBG", "VOW3", "TSLA"],
  MBG:   ["BMW", "VOW3", "TSLA"],
  VOW3:  ["BMW", "MBG", "STLA"],
  // ETFs — show similar ETFs
  SPY:   ["QQQ", "IWM", "VTI"],
  QQQ:   ["SPY", "VGT", "XLK"],
  VTI:   ["SPY", "IVV", "SCHB"],
};

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
