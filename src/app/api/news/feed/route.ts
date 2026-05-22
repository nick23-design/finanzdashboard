import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { fetchGoogleNews } from "@/lib/finance-client";

export interface FeedNewsItem {
  symbol: string;
  title: string;
  source: string;
  published: string | null;
}

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const supabase = await createClient();
  const { data: items } = await supabase
    .from("watchlist_items")
    .select("symbol")
    .eq("user_id", user.id)
    .limit(8);

  if (!items?.length) return NextResponse.json([]);

  const results = await Promise.all(
    items.map(async ({ symbol }) => {
      const news = await fetchGoogleNews(symbol).catch(() => []);
      return news.slice(0, 5).map(n => ({
        symbol,
        title: n.title,
        source: n.source,
        published: n.published,
      }));
    })
  );

  const feed: FeedNewsItem[] = results
    .flat()
    .sort((a, b) => {
      if (!a.published && !b.published) return 0;
      if (!a.published) return 1;
      if (!b.published) return -1;
      return new Date(b.published).getTime() - new Date(a.published).getTime();
    });

  return NextResponse.json(feed);
}
