import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Investment podcast RSS feeds (show notes contain episode descriptions + mentioned stocks)
const PODCAST_FEEDS = [
  {
    url: "https://feeds.megaphone.fm/foolmoney",
    label: "Motley Fool Money",
    lang: "en",
  },
  {
    url: "https://www.welt.de/feeds/podcast/alles-auf-aktien.xml",
    label: "Alles auf Aktien (WELT)",
    lang: "de",
  },
  {
    url: "https://news.google.com/rss/search?q=investment+podcast+Aktie+Empfehlung+%22Folge%22&hl=de&gl=DE&ceid=DE:de",
    label: "Google News (Investment Podcast DE)",
    lang: "de",
  },
  {
    url: "https://news.google.com/rss/search?q=podcast+stock+pick+buy+investment+episode&hl=en-US&gl=US&ceid=US:en",
    label: "Google News (Stock Podcast EN)",
    lang: "en",
  },
];

interface EpisodeItem {
  title: string;
  description: string;
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

async function fetchPodcastFeed(url: string, label: string): Promise<EpisodeItem[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const text = await res.text();

    const items: EpisodeItem[] = [];
    // Extract <item> blocks
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRe.exec(text)) !== null && items.length < 5) {
      const block = itemMatch[1];
      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(block);
      const descMatch = /<description>([\s\S]*?)<\/description>/.exec(block);

      const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() ?? "";
      const desc = descMatch?.[1]?.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").slice(0, 300).trim() ?? "";

      if (title) items.push({ title, description: desc, source: label });
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

  const allEpisodes = (
    await Promise.all(PODCAST_FEEDS.map(f => fetchPodcastFeed(f.url, f.label)))
  ).flat();

  if (!allEpisodes.length) {
    return NextResponse.json({ picks: 0, reason: "no episodes fetched" });
  }

  const episodeText = allEpisodes
    .map(e => `[${e.source}]\nTitel: ${e.title}\nBeschreibung: ${e.description}`)
    .join("\n\n");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `Du bist Podcast-Scout, ein Investment-Podcast Analyst. Analysiere aktuelle Investment-Podcast-Episoden und extrahiere konkret genannte Aktien-Empfehlungen. Nur Aktien die wirklich im Podcast-Kontext positiv erwähnt werden. Antworte ausschließlich als JSON-Array.`,
    messages: [{
      role: "user",
      content: `Aktuelle Investment-Podcast-Episoden:\n\n${episodeText}\n\nExtrahiere 1-3 konkret empfohlene Aktien. Nur wenn ein Ticker oder Unternehmensname klar erkennbar ist. Format:\n[{"symbol":"AAPL","name":"Apple Inc.","recommendation":"Kaufen","conviction":1-10,"rationale":"Podcast-Kontext auf Deutsch","sources":["Podcast-Name"]}]`,
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
    agent: "Podcast-Scout",
    created_at: new Date().toISOString(),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("nh_select_daily").insert(rows);

  return NextResponse.json({ picks: picks.length, symbols: picks.map(p => p.symbol) });
}
