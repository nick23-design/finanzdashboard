import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { fetchGoogleNews } from "@/lib/finance-client";
import { enrichWithDescriptions } from "@/lib/article-fetch";
import type { FeedNewsItem } from "@/app/api/news/feed/route";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const { symbol } = await params;
  const news = await fetchGoogleNews(symbol).catch(() => []);
  const rawNews = news.slice(0, 6);

  if (!rawNews.length) return NextResponse.json([]);

  // Enrich with article descriptions in parallel
  const rawWithDesc = await enrichWithDescriptions(rawNews);

  let enriched: FeedNewsItem[] = rawWithDesc.map(item => ({
    symbol,
    title: item.title,
    title_de: item.title,
    source: item.source,
    published: item.published,
    url: item.url,
    importance: "mittel" as const,
  }));

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const list = rawWithDesc.map((it, i) => {
        const desc = it.description ? `\n   → ${it.description}` : "";
        return `${i}. ${it.title}${desc}`;
      }).join("\n");
      const res = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        system: "Du bist eine Finanz-Nachrichtenredakteurin. Antworte ausschließlich mit validem JSON.",
        messages: [{
          role: "user",
          content: `Klassifiziere und übersetze diese Nachrichten über ${symbol} für Investoren.
Wo vorhanden, gibt es nach dem Titel einen kurzen Artikelauszug (→) für mehr Kontext.
Relevanz: "hoch"=direkte Unternehmensnews (Zahlen, Produkte, Übernahmen), "mittel"=Analysten/Sektor, "niedrig"=allgemein\n\n${list}\n\nJSON: {"items":[{"index":0,"importance":"hoch"|"mittel"|"niedrig","title_de":"deutsche Übersetzung"},...]}`,
        }],
      });
      const text = res.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map(b => b.text).join("");
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        const parsed = JSON.parse(text.slice(start, end + 1)) as {
          items: { index: number; importance: "hoch" | "mittel" | "niedrig"; title_de: string }[];
        };
        parsed.items?.forEach(({ index, importance, title_de }) => {
          if (enriched[index]) {
            enriched[index].importance = importance;
            enriched[index].title_de = title_de;
          }
        });
      }
    } catch { /* Lisa nicht verfügbar — Originaltitel behalten */ }
  }

  return NextResponse.json(enriched);
}
