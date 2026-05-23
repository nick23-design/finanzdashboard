import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RSS_SOURCES = [
  {
    url: "https://news.google.com/rss/search?q=stock+analyst+upgrade+buy+recommendation&hl=en-US&gl=US&ceid=US:en",
    label: "Google News US (analyst upgrades)",
  },
  {
    url: "https://news.google.com/rss/search?q=stock+earnings+beat+guidance+raised&hl=en-US&gl=US&ceid=US:en",
    label: "Google News US (earnings beats)",
  },
  {
    url: "https://news.google.com/rss/search?q=stock+breakout+all-time-high+momentum&hl=en-US&gl=US&ceid=US:en",
    label: "Google News US (momentum)",
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

  const supabase = createServiceClient();
  const rows = picks.map(p => ({
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

  return NextResponse.json({ picks: picks.length, symbols: picks.map(p => p.symbol) });
}
