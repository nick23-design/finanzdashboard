/**
 * Fetches og:description / meta description from an article URL.
 * Reads only the first 8 KB of the response to capture the <head> section,
 * then aborts — avoids downloading full article bodies.
 */
export async function fetchArticleDescription(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2_500),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    const MAX_BYTES = 8_000;

    while (html.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (html.includes("</head>") || html.includes("<body")) break;
    }
    reader.cancel().catch(() => {});

    // og:description (two attribute orderings)
    const og =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{15,400})["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']{15,400})["'][^>]+property=["']og:description["']/i)?.[1];
    if (og) return cleanDesc(og);

    // meta name=description
    const meta =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{15,400})["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']{15,400})["'][^>]+name=["']description["']/i)?.[1];
    if (meta) return cleanDesc(meta);

    return null;
  } catch {
    return null;
  }
}

function cleanDesc(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Enriches a list of articles with descriptions in parallel.
 * Articles without a URL or where fetching fails keep description: null.
 */
export async function enrichWithDescriptions<T extends { url: string | null }>(
  items: T[],
): Promise<(T & { description: string | null })[]> {
  const descriptions = await Promise.all(items.map(item => fetchArticleDescription(item.url)));
  return items.map((item, i) => ({ ...item, description: descriptions[i] }));
}
