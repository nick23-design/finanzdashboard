/**
 * Internal server-side client for the Finance API.
 * Swap FINANCE_API_URL to point to any other provider.
 */

const FINANCE_API_URL =
  process.env.FINANCE_API_URL || "http://localhost:8000";

// Timeouts: Primärer Fetch hat Retry-Logik (s.u.), daher pro Versuch kürzer.
const PRIMARY_ATTEMPT_MS  = 20_000;  // pro Versuch; 2 Versuche → max ~42s
const QUICK_ASSET_TIMEOUT_MS = 8_000;
const IMPORTANT_TIMEOUT_MS = 15_000;
const SECONDARY_TIMEOUT_MS = 12_000;
const EDGAR_TIMEOUT_MS = 25_000;
const INSIDER_TIMEOUT_MS = 18_000;

function apiSignal(ms: number) {
  return AbortSignal.timeout(ms);
}

export interface NewsItem {
  title: string;
  publisher: string;
  published_at: string | null;
}

export interface GoogleNewsItem {
  title: string;
  source: string;
  published: string | null;
  url: string | null;
}

export interface EdgarFactPeriod {
  period: string;
  value: number;
  form: string;
}

export interface EdgarFacts {
  cik: string;
  revenue: EdgarFactPeriod[];
  net_income: EdgarFactPeriod[];
  gross_profit: EdgarFactPeriod[];
  source?: string;
}

export interface MarketIndex {
  symbol: string;
  name: string;
  price: number | null;
  change_pct: number | null;
}

export async function fetchMarketIndices(): Promise<MarketIndex[]> {
  try {
    const res = await fetch(`${FINANCE_API_URL}/market/indices`, {
      next: { revalidate: 0 },
      signal: apiSignal(SECONDARY_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

/**
 * Marktdaten für ein Symbol laden.
 * Bis zu 2 Versuche mit je 20s Timeout — fängt Cold-Starts und kurze
 * Aussetzer der Finance-API ab. Wirft erst nach dem letzten Versuch.
 */
export async function fetchAssetData(symbol: string) {
  const MAX_ATTEMPTS = 2;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}`, {
        next: { revalidate: 0 },
        signal: apiSignal(PRIMARY_ATTEMPT_MS),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      return res.json();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        // kurze Pause vor Retry (hilft bei Cold-Starts)
        await new Promise(r => setTimeout(r, 2_000));
      }
    }
  }
  throw lastError;
}

/**
 * Schneller Einzelabruf für Cron-/Peer-Prewarming.
 * Kein Retry, damit ein schwacher Peer-Ticker nicht den ganzen Cron blockiert.
 */
export async function fetchAssetDataQuick(symbol: string) {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}`, {
    next: { revalidate: 0 },
    signal: apiSignal(QUICK_ASSET_TIMEOUT_MS),
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
    signal: apiSignal(SECONDARY_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  return res.json();
}

export interface InsiderTrade {
  date: string;
  name: string;
  title: string;
  transaction_type: "buy" | "sell";
  shares: number | null;
  price: number | null;
  value: number | null;
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface InstitutionalHolder {
  holder: string;
  pct_held: number | null;
  shares: number | null;
}

export interface InstitutionalData {
  pct_insider: number | null;
  pct_institutions: number | null;
  top_holders: InstitutionalHolder[];
  source?: string;
}

export async function fetchInsiderTrades(symbol: string): Promise<InsiderTrade[]> {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/insider-trades`, {
    next: { revalidate: 0 },
    signal: apiSignal(INSIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchTrends(symbol: string): Promise<TrendPoint[]> {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/trends`, {
    next: { revalidate: 0 },
    signal: apiSignal(SECONDARY_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchInstitutional(symbol: string): Promise<InstitutionalData | null> {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/institutional`, {
    next: { revalidate: 0 },
    signal: apiSignal(SECONDARY_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchGoogleNews(symbol: string): Promise<GoogleNewsItem[]> {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/google-news`, {
    next: { revalidate: 0 },
    signal: apiSignal(IMPORTANT_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchEdgarFacts(symbol: string): Promise<EdgarFacts | null> {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/edgar-facts`, {
    next: { revalidate: 0 },
    signal: apiSignal(EDGAR_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface AnalystData {
  mean_target: number | null;
  high_target: number | null;
  low_target: number | null;
  rating_count?: number | null;
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
  source?: string;
}

export interface EarningsCalendar {
  next_earnings_date: string | null;
  eps_estimate: number | null;
  revenue_estimate: number | null;
}

export async function fetchEarningsCalendar(symbol: string): Promise<EarningsCalendar | null> {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/calendar`, {
    next: { revalidate: 0 },
    signal: apiSignal(SECONDARY_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchAnalystData(symbol: string): Promise<AnalystData | null> {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/analyst-data`, {
    next: { revalidate: 0 },
    signal: apiSignal(IMPORTANT_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchPriceHistory(
  symbol: string,
  period: string = "6mo"
) {
  const res = await fetch(
    `${FINANCE_API_URL}/assets/${symbol}/history?period=${period}`,
    { next: { revalidate: 0 }, signal: apiSignal(PRIMARY_ATTEMPT_MS) }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
