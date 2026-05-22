import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { fetchGoogleNews } from "@/lib/finance-client";

export interface FeedNewsItem {
  symbol: string;
  title: string;
  title_de: string;
  source: string;
  published: string | null;
  url: string | null;
  importance: "hoch" | "mittel" | "niedrig";
}

interface LenaResult {
  items: { index: number; importance: "hoch" | "mittel" | "niedrig"; title_de: string }[];
}

async function runLenaAgent(items: { title: string; symbol: string }[]): Promise<LenaResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const list = items.map((it, i) => `${i}. [${it.symbol}] ${it.title}`).join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system:
      "Du bist eine Finanz-Nachrichtenredakteurin. Antworte ausschließlich mit validem JSON.",
    messages: [
      {
        role: "user",
        content: `Klassifiziere und übersetze diese Finanznachrichten für Aktieninvestoren.

Relevanz-Regeln:
- "hoch": direkte Unternehmensnews (Quartalszahlen, Produkte, Übernahmen, CEO-Wechsel, Regulierung)
- "mittel": Analysten-Ratings, Sektor- oder Wettbewerbsnews
- "niedrig": allgemeine Markt- oder Wirtschaftsnews

Schlagzeilen:
${list}

JSON-Format:
{"items":[{"index":0,"importance":"hoch"|"mittel"|"niedrig","title_de":"deutsche Übersetzung"},...]}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("");

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return { items: [] };
  return JSON.parse(text.slice(start, end + 1)) as LenaResult;
}

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const supabase = await createClient();
  const { data: watchlistItems } = await supabase
    .from("watchlist_items")
    .select("symbol")
    .eq("user_id", user.id)
    .limit(8);

  if (!watchlistItems?.length) return NextResponse.json([]);

  const results = await Promise.all(
    watchlistItems.map(async ({ symbol }) => {
      const news = await fetchGoogleNews(symbol).catch(() => []);
      return news.slice(0, 5).map(n => ({
        symbol,
        title: n.title,
        source: n.source,
        published: n.published,
        url: n.url,
      }));
    })
  );

  const raw = results.flat().sort((a, b) => {
    if (!a.published && !b.published) return 0;
    if (!a.published) return 1;
    if (!b.published) return -1;
    return new Date(b.published).getTime() - new Date(a.published).getTime();
  });

  if (!raw.length) return NextResponse.json([]);

  // Run Lena to classify + translate
  let enriched: FeedNewsItem[] = raw.map(item => ({
    ...item,
    title_de: item.title,
    importance: "mittel" as const,
  }));

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const lenaResult = await runLenaAgent(raw.map(r => ({ title: r.title, symbol: r.symbol })));
      lenaResult.items.forEach(({ index, importance, title_de }) => {
        if (enriched[index]) {
          enriched[index].importance = importance;
          enriched[index].title_de = title_de;
        }
      });
    } catch {
      // Lena unavailable — return with original titles
    }
  }

  // Sort: hoch first, then mittel, then niedrig
  const order = { hoch: 0, mittel: 1, niedrig: 2 };
  enriched.sort((a, b) => order[a.importance] - order[b.importance]);

  return NextResponse.json(enriched);
}
