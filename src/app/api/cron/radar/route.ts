import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface TrendingTicker {
  symbol: string;
  name?: string;
  change_pct?: number;
}

interface RadarSignal {
  symbol: string;
  signal_type: string;
  description: string;
  confidence: number;
  source: string;
}

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

async function fetchNewsHeadlines(symbol: string): Promise<string[]> {
  try {
    const encoded = encodeURIComponent(`${symbol} stock`);
    const rss = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(rss, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const text = await res.text();
    const titleRe = /<title>([\s\S]*?)<\/title>/g;
    const titles: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = titleRe.exec(text)) !== null && titles.length < 5) {
      const t = m[1].replace(/<[^>]+>/g, "").trim();
      if (t && !t.toLowerCase().includes("google news")) titles.push(t);
    }
    return titles;
  } catch {
    return [];
  }
}

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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // 1. Fetch trending tickers
  const trending = await fetchTrending();
  if (!trending.length) {
    return NextResponse.json({ signals: 0, reason: "no trending tickers" });
  }

  // 2. Take top 10, fetch scores + news
  const candidates = trending.slice(0, 10);
  const enriched = await Promise.all(
    candidates.map(async (t) => {
      const [score, headlines] = await Promise.all([
        fetchScore(t.symbol),
        fetchNewsHeadlines(t.symbol),
      ]);
      return { ...t, score, headlines };
    })
  );

  // 3. Radar (Sonnet) identifies signals
  const context = enriched.map(c =>
    `${c.symbol}${c.name ? ` (${c.name})` : ""}: Score ${c.score ?? "?"}/100, Change ${c.change_pct?.toFixed(1) ?? "?"}%\nNews: ${c.headlines.join(" | ") || "keine"}`
  ).join("\n\n");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `Du bist Radar, ein autonomer Markt-Scanner. Analysiere die folgenden Trending-Aktien und identifiziere die 3-5 interessantesten Signale für Investoren. Antworte ausschließlich als JSON-Array.`,
    messages: [{
      role: "user",
      content: `Aktuelle Trending-Aktien:\n\n${context}\n\nIdentifiziere 3-5 Signale. Format:\n[{"symbol":"AAPL","signal_type":"momentum|breakout|sentiment|value|risk","description":"Kurze Begründung auf Deutsch","confidence":1-10}]`,
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

  // 4. Save to Supabase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
