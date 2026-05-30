/**
 * Zentrale EUR/USD-Kursermittlung für alle Server-Routen.
 *
 * Quellen-Kaskade (von genau → robust):
 *   1. finance_api  – yfinance EURUSD=X (Intraday-Marktkurs, wie finanzen.net)
 *   2. ecb          – frankfurter.dev = EZB-Referenzkurs (täglich, ohne API-Key)
 *   3. cache        – letzter erfolgreich geholter Kurs (max. 24 h alt)
 *   4. fallback     – fixe Konstante, nur als allerletzte Reserve
 *
 * So rutscht nie wieder ein veralteter Festkurs (~8 % Fehler) durch, nur weil
 * der Render-Backend gerade einen Cold-Start hat.
 */

import { fetchAssetData } from "@/lib/finance-client";

export type FxSource = "finance_api" | "ecb" | "cache" | "fallback";

export interface FxResult {
  /** 1 EUR = `eurUsd` USD */
  eurUsd: number;
  source: FxSource;
  /** ISO-Zeitstempel, auf den sich der Kurs bezieht */
  asOf: string;
}

// Letzte Reserve. Bewusst nah am aktuellen Marktkurs gehalten, damit der Fehler
// im (sehr seltenen) Totalausfall beider Live-Quellen begrenzt bleibt.
const EUR_USD_FALLBACK = 1.16;

const FRESH_TTL_MS = 30 * 60 * 1000; // 30 min: normaler Cache
const STALE_MAX_MS = 24 * 60 * 60 * 1000; // 24 h: „besser alt als konstant"
const ECB_TIMEOUT_MS = 6_000;

let fresh: { value: FxResult; expiresAt: number } | null = null;
let lastGood: { value: FxResult; storedAt: number } | null = null;

function isValidRate(n: unknown): n is number {
  // EUR/USD bewegt sich historisch komfortabel innerhalb 0,5–2,0.
  return typeof n === "number" && Number.isFinite(n) && n > 0.5 && n < 2;
}

async function fromFinanceApi(): Promise<FxResult | null> {
  try {
    const fx = await fetchAssetData("EURUSD=X");
    if (isValidRate(fx?.price)) {
      return {
        eurUsd: fx.price,
        source: "finance_api",
        asOf: fx.fetched_at ?? new Date().toISOString(),
      };
    }
  } catch {
    // Nächste Quelle versuchen.
  }
  return null;
}

async function fromEcb(): Promise<FxResult | null> {
  // frankfurter.dev liefert EZB-Referenzkurse, ohne API-Key, schnell & stabil.
  try {
    const res = await fetch(
      "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD",
      { signal: AbortSignal.timeout(ECB_TIMEOUT_MS), next: { revalidate: 0 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.rates?.USD;
    if (isValidRate(rate)) {
      // EZB fixiert ~16:00 MEZ; Datum reicht als Bezugspunkt.
      const asOf = data?.date
        ? new Date(`${data.date}T15:00:00Z`).toISOString()
        : new Date().toISOString();
      return { eurUsd: rate, source: "ecb", asOf };
    }
  } catch {
    // Auf Cache/Fallback zurückfallen.
  }
  return null;
}

/**
 * Aktuellen EUR/USD-Kurs ermitteln. Greift auf einen 30-min-Cache zurück und
 * durchläuft sonst die Quellen-Kaskade.
 */
export async function getEurUsd(): Promise<FxResult> {
  if (fresh && fresh.expiresAt > Date.now()) return fresh.value;

  const live = (await fromFinanceApi()) ?? (await fromEcb());
  if (live) {
    fresh = { value: live, expiresAt: Date.now() + FRESH_TTL_MS };
    lastGood = { value: live, storedAt: Date.now() };
    return live;
  }

  // Beide Live-Quellen aus: letzten echten Kurs wiederverwenden, solange frisch.
  if (lastGood && Date.now() - lastGood.storedAt < STALE_MAX_MS) {
    return { ...lastGood.value, source: "cache" };
  }

  return {
    eurUsd: EUR_USD_FALLBACK,
    source: "fallback",
    asOf: new Date().toISOString(),
  };
}

/** Betrag zwischen USD und EUR umrechnen. `eurUsd` = 1 EUR in USD. */
export function convertUsdEur(
  value: number,
  from: "USD" | "EUR",
  to: "USD" | "EUR",
  eurUsd: number
): number {
  if (from === to) return value;
  if (from === "USD" && to === "EUR") return value / eurUsd;
  if (from === "EUR" && to === "USD") return value * eurUsd;
  return value;
}
