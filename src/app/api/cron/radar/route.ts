import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { enrichWithDescriptions } from "@/lib/article-fetch";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Types ---

interface TrendingTicker {
  symbol: string;
  name?: string;
  change_pct?: number;
}

interface NewsItem {
  symbol: string;
  title: string;
  url: string;
  source: string;
  feedPosition: number;
}

interface ScoredItem extends NewsItem {
  description: string | null;
  score: number;
  topic: "earnings" | "analyst" | "other";
}

interface RadarSignal {
  symbol: string;
  signal_type: string;
  description: string;
  confidence: number;
  source: string;
}

// --- Fetch trending tickers ---

async function fetchTrending(): Promise<TrendingTicker[]> {
  try {
    const res = await fetch(`${FINANCE_API_URL}/trending`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { tickers?: TrendingTicker[] };
    return data.tickers ?? [];
  } catch {
    return [];
  }
}

// --- Fetch NH score ---

async function fetchScore(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "https://nexthorizon-ai.com"}/api/analyze/${symbol}`,
      { method: "POST", signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { total_score?: number };
    return data.total_score ?? null;
  } catch {
    return null;
  }
}

// --- Fetch news items (title + url + source) ---

async function fetchNewsItems(symbol: string): Promise<NewsItem[]> {
  try {
    const encoded = encodeURIComponent(`${symbol} stock`);
    const rss = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(rss, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const text = await res.text();

    const items: NewsItem[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;

    while ((m = itemRe.exec(text)) !== null && items.length < 8) {
      const block = m[1];
      const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]
        ?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() ?? "";
      const url = block.match(/<link>(https?:\/\/[^<]+)<\/link>/)?.[1]?.trim() ?? "";
      const source = block.match(/<source[^>]*>([^<]+)<\/source>/)?.[1]?.trim() ?? "";

      if (title && url && !title.toLowerCase().includes("google news")) {
        items.push({ symbol, title, url, source, feedPosition: items.length });
      }
    }

    return items;
  } catch {
    return [];
  }
}

// --- Ranking ---

const PREMIUM_SOURCES = [
  "reuters", "associated press", "bloomberg", "cnbc", "financial times",
  "wall street journal", "wsj", "yahoo finance", "marketwatch", "ft.com", "ap news",
];
const MATERIAL_RE = /earnings|guidance|revenue|acquisition|fda|lawsuit|downgrade|upgrade|regulation|partnership|merger|buyback|dividend|forecast|outlook|beat|miss|q[1-4]\s/i;
const CLICKBAIT_RE = /should you buy|motley fool|millionaire.maker|ai stock to buy|passive income|forever stock|top stock to|best stock/i;

function scoreItem(item: ScoredItem): number {
  let s = 0;
  if (item.description && item.description.length > 80) s += 3;
  const srcLower = item.source.toLowerCase();
  if (PREMIUM_SOURCES.some(p => srcLower.includes(p))) s += 3;
  if (item.title.toLowerCase().includes(item.symbol.toLowerCase())) s += 2;
  const combined = `${item.title} ${item.description ?? ""}`;
  if (MATERIAL_RE.test(combined)) s += 2;
  if (item.feedPosition === 0) s += 1;  // freshest in feed
  if (CLICKBAIT_RE.test(item.title)) s -= 2;
  if (!item.title || !item.url) s -= 3;
  return s;
}

function classifyTopic(title: string, description: string | null): "earnings" | "analyst" | "other" {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  if (/earnings|revenue|guidance|profit|eps|quarterly|results|beat|miss/.test(text)) return "earnings";
  if (/analyst|upgrade|downgrade|price target|rating/.test(text)) return "analyst";
  return "other";
}

function selectTop3WithDiversity(items: ScoredItem[]): ScoredItem[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const selected: ScoredItem[] = [];
  const seenTopics = new Set<string>();

  // First pass: one per topic (diversity)
  for (const item of sorted) {
    if (selected.length >= 3) break;
    if (!seenTopics.has(item.topic)) {
      selected.push(item);
      seenTopics.add(item.topic);
    }
  }

  // Second pass: fill remaining slots by score
  for (const item of sorted) {
    if (selected.length >= 3) break;
    if (!selected.includes(item)) selected.push(item);
  }

  return selected;
}

// --- Main handler ---

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // 1. Fetch top 10 trending tickers
  const trending = await fetchTrending();
  if (!trending.length) {
    return NextResponse.json({ signals: 0, reason: "no trending tickers" });
  }
  const candidates = trending.slice(0, 10);

  // 2. Fetch scores + news items for all candidates in parallel
  const candidateData = await Promise.all(
    candidates.map(async (t) => {
      const [score, newsItems] = await Promise.all([
        fetchScore(t.symbol),
        fetchNewsItems(t.symbol),
      ]);
      return { ...t, score, newsItems };
    })
  );

  // 3. Collect all items (up to 80), dedupe URLs for Jina fetching
  const allItems: NewsItem[] = candidateData.flatMap(c => c.newsItems);
  const uniqueUrlItems = [...new Map(allItems.map(i => [i.url, i])).values()];

  // 4. Jina-enrich unique URLs only (each article fetched once regardless of how many symbols reference it)
  const enriched = await enrichWithDescriptions(uniqueUrlItems);
  const descByUrl = new Map(enriched.map(e => [e.url, e.description]));

  // 5. Map descriptions back to ALL items (preserves cross-ticker references), score + classify
  const scoredItems: ScoredItem[] = allItems.map(item => {
    const description = descByUrl.get(item.url) ?? null;
    const topic = classifyTopic(item.title, description);
    const scored: ScoredItem = { ...item, description, score: 0, topic };
    scored.score = scoreItem(scored);
    return scored;
  });

  // 6. Group by symbol
  const bySymbol = new Map<string, ScoredItem[]>();
  for (const item of scoredItems) {
    const arr = bySymbol.get(item.symbol) ?? [];
    arr.push(item);
    bySymbol.set(item.symbol, arr);
  }

  // 7. Build enriched context for Sonnet (Top 3 per symbol with diversity)
  const context = candidateData.map(c => {
    const top3 = selectTop3WithDiversity(bySymbol.get(c.symbol) ?? []);
    const newsLines = top3.length
      ? top3.map((n, i) => {
          const excerpt = n.description ? `\n     → ${n.description}` : "";
          return `  ${i + 1}. [${n.source || "News"}] ${n.title}${excerpt}`;
        }).join("\n")
      : "  (keine News)";
    return `${c.symbol}${c.name ? ` (${c.name})` : ""}: Score ${c.score ?? "?"}/100, Kursveränderung ${c.change_pct?.toFixed(1) ?? "?"}%\n${newsLines}`;
  }).join("\n\n");

  // 8. Sonnet evaluates signals
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `Du bist Radar, ein autonomer Markt-Scanner. Analysiere die folgenden Trending-Aktien mit ihren News-Auszügen und identifiziere die 3-5 interessantesten Signale für Investoren. Unterscheide klar zwischen substanziellem Trend (Earnings, Guidance, M&A, Regulierung) und reinem Hype (Social Media, Clickbait, generische Artikel). Antworte ausschließlich als JSON-Array.`,
    messages: [{
      role: "user",
      content: `Aktuelle Trending-Aktien mit News-Auszügen:\n\n${context}\n\nIdentifiziere 3-5 substanzielle Signale. Format:\n[{"symbol":"AAPL","signal_type":"momentum|breakout|sentiment|value|risk","description":"Kurze Begründung auf Deutsch","confidence":1-10}]`,
    }],
  });

  let signals: RadarSignal[] = [];
  try {
    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as Omit<RadarSignal, "source">[];
      signals = parsed.map(s => ({ ...s, source: "radar-cron" }));
    }
  } catch {
    return NextResponse.json({ signals: 0, reason: "parse error" });
  }

  if (!signals.length) return NextResponse.json({ signals: 0, reason: "no signals" });

  // 9. Save to Supabase
  await (supabase as any).from("radar_signals").insert(
    signals.map(s => ({
      symbol: s.symbol,
      signal_type: s.signal_type,
      description: s.description,
      confidence: s.confidence,
      source: s.source,
      found_at: new Date().toISOString(),
      used_in_select: false,
    }))
  );

  return NextResponse.json({ signals: signals.length, symbols: signals.map(s => s.symbol) });
}
