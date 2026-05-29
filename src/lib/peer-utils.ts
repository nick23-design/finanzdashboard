import { PEER_MAP } from "@/lib/peer-map";

const SYMBOL_RE = /^[A-Z0-9.-]{1,12}$/;

export function normalizeTickerSymbol(symbol: string): string | null {
  const upper = symbol.trim().toUpperCase();
  return SYMBOL_RE.test(upper) ? upper : null;
}

export function getConfiguredPeers(symbol: string): string[] {
  const normalized = normalizeTickerSymbol(symbol);
  if (!normalized) return [];

  const baseSymbol = normalized.split(".")[0];
  const peers = PEER_MAP[normalized] ?? PEER_MAP[baseSymbol] ?? [];

  return [...new Set(
    peers
      .map(normalizeTickerSymbol)
      .filter((peer): peer is string => peer != null && peer !== normalized),
  )];
}

export function expandSymbolsWithPeers(
  symbols: string[],
  limit: number,
): string[] {
  const expanded = new Set<string>();

  for (const raw of symbols) {
    const symbol = normalizeTickerSymbol(raw);
    if (!symbol) continue;

    expanded.add(symbol);
    for (const peer of getConfiguredPeers(symbol)) {
      expanded.add(peer);
    }

    if (expanded.size >= limit) break;
  }

  return [...expanded].slice(0, limit);
}
