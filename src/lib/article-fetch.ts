/**
 * Fetches a readable article excerpt via Jina AI Reader (https://r.jina.ai).
 * Falls back to og:description scraping when Jina fails or returns too little content.
 */
export async function fetchArticleDescription(
  url: string | null,
  options?: { maxLines?: number; maxChars?: number },
): Promise<string | null> {
  if (!url) return null;
  const maxLines = options?.maxLines ?? 4;
  const maxChars = options?.maxChars ?? 700;

  // --- Jina AI Reader (primary) ---
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const headers: Record<string, string> = {
      Accept: "text/plain",
      "X-Return-Format": "text",
    };
    if (process.env.JINA_API_KEY) headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;

    const res = await fetch(jinaUrl, { signal: AbortSignal.timeout(5_000), headers });
    if (res.ok) {
      const text = await res.text();
      // Jina returns markdown — take first meaningful block (skip navigation/boilerplate lines)
      const lines = text
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 40 && !l.startsWith("#") && !l.startsWith("![")); // skip headings + images
      const excerpt = lines.slice(0, maxLines).join(" ").replace(/\s+/g, " ").slice(0, maxChars).trim();
      if (excerpt.length > 80) return excerpt;
    }
  } catch { /* Jina unavailable — fall through */ }

  // --- og:description fallback ---
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2_500),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (html.length < 8_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (html.includes("</head>") || html.includes("<body")) break;
    }
    reader.cancel().catch(() => {});

    const og =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{15,400})["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']{15,400})["'][^>]+property=["']og:description["']/i)?.[1];
    if (og) return cleanDesc(og);

    const meta =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{15,400})["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']{15,400})["'][^>]+name=["']description["']/i)?.[1];
    if (meta) return cleanDesc(meta);
  } catch { /* ignore */ }

  return null;
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
