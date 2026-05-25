import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

async function validateTicker(symbol: string): Promise<boolean> {
  try {
    const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const data = await res.json() as { price?: number | null };
    return typeof data.price === "number" && data.price > 0;
  } catch {
    return false;
  }
}

const RSS_SOURCES = [
  // Google News (titles only — descriptions are HTML link lists)
  {
    url: "https://news.google.com/rss/search?q=stock+analyst+upgrade+buy+recommendation&hl=en-US&gl=US&ceid=US:en",
    label: "Google News US (analyst upgrades)",
    premium: false,
  },
  {
    url: "https://news.google.com/rss/search?q=stock+earnings+beat+guidance+raised&hl=en-US&gl=US&ceid=US:en",
    label: "Google News US (earnings beats)",
    premium: false,
  },
  {
    url: "https://news.google.com/rss/search?q=stock+breakout+all-time-high+momentum&hl=en-US&gl=US&ceid=US:en",
    label: "Google News US (momentum)",
    premium: false,
  },
  // Premium RSS — plain-text <description> with real content
  {
    url: "https://feeds.reuters.com/reuters/businessNews",
    label: "Reuters Business",
    premium: true,
  },
  {
    url: "https://feeds.apnews.com/apnews/business",
    label: "AP Business",
    premium: true,
  },
  {
    url: "https://feeds.marketwatch.com/marketwatch/topstories/",
    label: "MarketWatch",
    premium: true,
  },
];

interface NewsItem {
  title: string;
  source: string;
  description?: string;
}

interface ScoutPick {
  symbol: string;
  name: string;
  recommendation: string;
  conviction: number;
  rationale: string;
  sources: string[];
}

function isHtmlDescription(text: string): boolean {
  return text.includes("<") && text.includes(">");
}

async function fetchFeed(url: string, label: string, premium: boolean): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const text = await res.text();

    const items: NewsItem[] = [];
    // Extract <item> blocks to pair titles with descriptions
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;

    while ((m = itemRe.exec(text)) !== null && items.length < 8) {
      const block = m[1];
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      if (!titleMatch) continue;
      const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
      if (!title || title.toLowerCase().includes("google news")) continue;

      const item: NewsItem = { title, source: label };

      if (premium) {
        const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
        if (descMatch) {
          const raw = descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
          if (!isHtmlDescription(raw) && raw.length > 40) {
            item.description = raw.replace(/\s+/g, " ").slice(0, 500);
          }
        }
      }

      items.push(item);
    }

    // Fallback: extract titles without descriptions if item blocks not found
    if (!items.length) {
      const titleRe = /<title>([\s\S]*?)<\/title>/g;
      let t: RegExpExecArray | null;
      while ((t = titleRe.exec(text)) !== null && items.length < 8) {
        const title = t[1].replace(/<[^>]+>/g, "").trim();
        if (title && !title.toLowerCase().includes("google news")) {
          items.push({ title, source: label });
        }
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
    await Promise.all(RSS_SOURCES.map(s => fetchFeed(s.url, s.label, s.premium)))
  ).flat();

  if (!allNews.length) {
    return NextResponse.json({ picks: 0, reason: "no news fetched" });
  }

  const newsText = allNews
    .map(n => {
      const desc = n.description ? `\n   → ${n.description}` : "";
      return `[${n.source}] ${n.title}${desc}`;
    })
    .join("\n");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `Du bist US-Scout, ein US-Markt Analyst. Analysiere aktuelle US-Finanznachrichten und identifiziere 2-4 vielversprechende US-Aktien mit konkreten Ticker-Symbolen. Antworte ausschließlich als JSON-Array.`,
    messages: [{
      role: "user",
      content: `Aktuelle US-Finanznachrichten:\n\n${newsText}\n\nIdentifiziere 2-4 US-Aktien die heute besonders interessant sind. Nur Aktien mit klar erkennbarem Ticker. Format:\n[{"symbol":"AAPL","name":"Apple Inc.","recommendation":"Kaufen","conviction":1-10,"rationale":"Kurze Begründung auf Deutsch","sources":["Quelle"]}]`,
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

  // Validate each ticker against the Finance API to filter hallucinated symbols
  const validated = await Promise.all(
    picks.map(async p => ({ pick: p, valid: await validateTicker(p.symbol) }))
  );
  const validPicks = validated.filter(v => v.valid).map(v => v.pick);
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
    agent: "US-Scout",
    created_at: new Date().toISOString(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("nh_select_daily").insert(rows);

  return NextResponse.json({ picks: validPicks.length, symbols: validPicks.map(p => p.symbol), filtered });
}
