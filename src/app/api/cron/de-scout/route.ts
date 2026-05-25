import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

async function checkSymbol(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { price?: number | null };
    return (typeof data.price === "number" && data.price > 0) ? data.price : null;
  } catch {
    return null;
  }
}

/** Returns the validated symbol (may add .DE suffix) or null if invalid. */
async function validateTicker(symbol: string): Promise<string | null> {
  const price = await checkSymbol(symbol);
  if (price !== null) return symbol;
  // For DE stocks without exchange suffix, try .DE (Deutsche Börse)
  if (!symbol.includes(".")) {
    const dePrice = await checkSymbol(`${symbol}.DE`);
    if (dePrice !== null) return `${symbol}.DE`;
  }
  return null;
}

const RSS_SOURCES = [
  {
    url: "https://news.google.com/rss/search?q=Aktie+Kaufen+Empfehlung+Analyst&hl=de&gl=DE&ceid=DE:de",
    label: "Google News DE (Analyst-Empfehlungen)",
  },
  {
    url: "https://news.google.com/rss/search?q=Aktie+Kurs+Prognose+Kursziel&hl=de&gl=DE&ceid=DE:de",
    label: "Google News DE (Kursziele)",
  },
  {
    url: "https://news.google.com/rss/search?q=DAX+MDAX+Aktie+Chancen+stark&hl=de&gl=DE&ceid=DE:de",
    label: "Google News DE (DAX/MDAX)",
  },
];

interface NewsItem {
  title: string;
  source: string;
}

interface ScoutPick {
  symbol: string;
  name: string;
  recommendation: string;
  conviction: number;
  rationale: string;
  sources: string[];
}

async function fetchFeed(url: string, label: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const text = await res.text();
    const titleRe = /<title>([\s\S]*?)<\/title>/g;
    const items: NewsItem[] = [];
    let m: RegExpExecArray | null;
    while ((m = titleRe.exec(text)) !== null && items.length < 8) {
      const t = m[1].replace(/<[^>]+>/g, "").trim();
      if (t && !t.toLowerCase().includes("google news")) {
        items.push({ title: t, source: label });
      }
    }
    return items;
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allNews = (
    await Promise.all(RSS_SOURCES.map(s => fetchFeed(s.url, s.label)))
  ).flat();

  if (!allNews.length) {
    return NextResponse.json({ picks: 0, reason: "no news fetched" });
  }

  const newsText = allNews
    .map(n => `[${n.source}] ${n.title}`)
    .join("\n");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `Du bist DE-Scout, ein DACH- und Europa-Markt Analyst. Analysiere aktuelle deutschsprachige Finanznachrichten und identifiziere 2-4 vielversprechende Aktien aus dem deutschen oder europäischen Markt. Bevorzuge Aktien mit bekanntem Ticker-Symbol (z.B. SAP, BMW, BAYN). Antworte ausschließlich als JSON-Array.`,
    messages: [{
      role: "user",
      content: `Aktuelle deutschsprachige Finanznachrichten:\n\n${newsText}\n\nIdentifiziere 2-4 interessante DACH/Europa-Aktien. Nur Aktien mit erkennbarem Ticker. Format:\n[{"symbol":"SAP","name":"SAP SE","recommendation":"Kaufen","conviction":1-10,"rationale":"Kurze Begründung auf Deutsch","sources":["Quelle"]}]`,
    }],
  });

  let picks: ScoutPick[] = [];
  try {
    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) picks = JSON.parse(match[0]) as ScoutPick[];
  } catch {
    return NextResponse.json({ picks: 0, reason: "parse error" });
  }

  if (!picks.length) return NextResponse.json({ picks: 0, reason: "no picks" });

  // Validate each ticker; .DE suffix is tried automatically for bare symbols
  const validated = await Promise.all(
    picks.map(async p => {
      const validSymbol = await validateTicker(p.symbol);
      return validSymbol ? { ...p, symbol: validSymbol } : null;
    })
  );
  const validPicks = validated.filter((p): p is ScoutPick => p !== null);
  const filtered = picks.length - validPicks.length;

  if (!validPicks.length) {
    return NextResponse.json({ picks: 0, reason: "all symbols invalid", filtered });
  }

  const supabase = createServiceClient();
  const rows = validPicks.map(p => ({
    symbol: p.symbol,
    name: p.name,
    recommendation: p.recommendation,
    conviction: p.conviction,
    rationale: p.rationale,
    sources: p.sources,
    agent: "DE-Scout",
    created_at: new Date().toISOString(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("nh_select_daily").insert(rows);

  return NextResponse.json({ picks: validPicks.length, symbols: validPicks.map(p => p.symbol), filtered });
}
