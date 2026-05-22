/**
 * Internal server-side client for the Finance API.
 * Swap FINANCE_API_URL to point to any other provider.
 */

const FINANCE_API_URL =
  process.env.FINANCE_API_URL || "http://localhost:8000";

export interface NewsItem {
  title: string;
  publisher: string;
  published_at: string | null;
}

export async function fetchAssetData(symbol: string) {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}`, {
    next: { revalidate: 0 }, // caching handled at DB layer
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchNews(symbol: string): Promise<NewsItem[]> {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/news`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchPriceHistory(
  symbol: string,
  period: string = "6mo"
) {
  const res = await fetch(
    `${FINANCE_API_URL}/assets/${symbol}/history?period=${period}`,
    { next: { revalidate: 0 } }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
