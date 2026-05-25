"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import type { WatchlistItem } from "@/types/database";
import { WatchlistCard } from "./WatchlistCard";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { searchStocks, STOCKS, type StockEntry } from "@/lib/stocks-list";
import Link from "next/link";
import { Search, X, Plus, Globe, Bell } from "lucide-react";
import { HotPickCard } from "./HotPickCard";
import { MorningBriefingCard } from "./MorningBriefingCard";
import { MarketIndexBar } from "./MarketIndexBar";

const REGION_LABEL: Record<StockEntry["region"], string> = {
  US: "🇺🇸", DE: "🇩🇪", EU: "🇪🇺", CH: "🇨🇭", ETF: "📦",
};

interface LiveResult {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
}

interface WatchlistViewProps {
  initialItems: WatchlistItem[];
}

export function WatchlistView({ initialItems }: WatchlistViewProps) {
  const [items, setItems] = useState<WatchlistItem[]>(initialItems);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<StockEntry[]>([]);
  const [liveResults, setLiveResults] = useState<LiveResult[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchResult, setSearchResult] = useState<{ symbol: string; name: string; price: number | null; currency: string | null } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addedSymbol, setAddedSymbol] = useState<string | null>(null);
  const [triggeredCount, setTriggeredCount] = useState(0);
  type SortBy = "default" | "az" | "perf" | "score";
  const [sortBy, setSortBy] = useState<SortBy>("default");
  const [dataMap, setDataMap] = useState<Record<string, { score: number; changePct: number | null }>>({});

  function handleDataLoaded(symbol: string, score: number, changePct: number | null) {
    setDataMap(prev => ({ ...prev, [symbol]: { score, changePct } }));
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/alerts")
      .then(r => r.ok ? r.json() : [])
      .then((data: { triggered: boolean }[]) =>
        setTriggeredCount(data.filter(a => a.triggered).length)
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    const hits = searchStocks(query);
    setSuggestions(hits);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length >= 2) {
      setShowSuggestions(true);
      setLiveLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
          if (res.ok) {
            const data: LiveResult[] = await res.json();
            const staticSymbols = new Set(hits.map(h => h.symbol));
            setLiveResults(data.filter(r => !staticSymbols.has(r.symbol)));
          }
        } catch { /* ignore */ }
        setLiveLoading(false);
      }, 300);
    } else {
      setLiveResults([]);
      setLiveLoading(false);
      setShowSuggestions(query.length >= 1 && hits.length > 0);
    }

    if (!query) { setSearchResult(null); setSearchError(null); }
  }, [query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function fetchStock(symbol: string, name?: string) {
    setSearchError(null);
    setSearchResult(null);
    setShowSuggestions(false);
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/assets/${symbol}`);
      const data = await res.json();
      if (!res.ok) { setSearchError(data.error ?? "Nicht gefunden"); return; }
      setSearchResult({ symbol, name: data.name || name || symbol, price: data.price, currency: data.currency });
    } finally {
      setSearchLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = query.trim().toUpperCase();
    if (sym) fetchStock(sym);
  }

  async function addToWatchlist(symbol: string, name: string) {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, name }),
    });
    const data = await res.json();
    if (res.ok) {
      setItems(prev => [data as WatchlistItem, ...prev]);
      setAddedSymbol(symbol);
      setQuery("");
      setSearchResult(null);
      setTimeout(() => setAddedSymbol(null), 2000);
    } else {
      setSearchError(data.error ?? "Fehler");
    }
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
      if (res.ok) setItems(prev => prev.filter(i => i.id !== id));
    });
  }

  const alreadyInList = (symbol: string) => items.some(i => i.symbol === symbol);
  const hasDropdown = showSuggestions && (suggestions.length > 0 || liveResults.length > 0 || liveLoading);

  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === "az") return a.symbol.localeCompare(b.symbol);
    if (sortBy === "perf") {
      const pa = dataMap[a.symbol]?.changePct ?? -Infinity;
      const pb = dataMap[b.symbol]?.changePct ?? -Infinity;
      return pb - pa;
    }
    if (sortBy === "score") {
      const sa = dataMap[a.symbol]?.score ?? 0;
      const sb = dataMap[b.symbol]?.score ?? 0;
      return sb - sa;
    }
    return 0;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Watchlist</h2>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/alerts"
            className="relative flex items-center justify-center w-8 h-8 rounded-full transition-colors"
            style={{ background: "var(--card-border)", color: "var(--muted)" }}
            title="Alarm-Übersicht">
            <Bell size={15} />
            {triggeredCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                style={{ background: "#ef4444", borderColor: "var(--background)" }} />
            )}
          </Link>
          <span
            className="text-xs px-2 py-1 rounded-full font-medium"
            style={{ background: "var(--card-border)", color: "var(--muted)" }}>
            {items.length} Aktie{items.length !== 1 ? "n" : ""}
          </span>
        </div>
      </div>

      {/* Marktindizes */}
      <MarketIndexBar />

      {/* Morgen-Briefing */}
      <MorningBriefingCard />

      {/* Hot Pick */}
      <HotPickCard />

      {/* Search Bar */}
      <div className="relative">
        <form onSubmit={handleSubmit} className="relative">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--muted)" }}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value.toUpperCase())}
            onFocus={() => (suggestions.length > 0 || liveResults.length > 0) && setShowSuggestions(true)}
            placeholder="Aktie suchen oder Ticker eingeben…"
            maxLength={50}
            autoComplete="off"
            className="w-full rounded-xl pl-9 pr-10 py-3 text-white text-sm border outline-none"
            style={{ background: "var(--card)", borderColor: "var(--card-border)" }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setSearchResult(null); setSearchError(null); setLiveResults([]); }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--muted)" }}>
              <X size={14} />
            </button>
          )}
        </form>

        {/* Autocomplete Dropdown */}
        {hasDropdown && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-1 rounded-xl border overflow-hidden z-50 shadow-xl"
            style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

            {/* Static suggestions */}
            {suggestions.map(stock => (
              <button
                key={stock.symbol}
                type="button"
                onMouseDown={e => { e.preventDefault(); setQuery(stock.symbol); fetchStock(stock.symbol, stock.name); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left border-b last:border-b-0"
                style={{ borderColor: "var(--card-border)" }}>
                <span className="text-base w-5 text-center flex-shrink-0">{REGION_LABEL[stock.region]}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-white text-sm">{stock.symbol}</span>
                  <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{stock.name}</p>
                </div>
                <span
                  className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: "rgba(100,116,139,0.2)", color: "var(--muted)" }}>
                  {stock.region}
                </span>
              </button>
            ))}

            {/* Divider between static and live results */}
            {suggestions.length > 0 && (liveResults.length > 0 || liveLoading) && (
              <div className="px-4 py-1.5 flex items-center gap-2" style={{ borderColor: "var(--card-border)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Weltweite Ergebnisse</span>
                <div className="flex-1 h-px" style={{ background: "var(--card-border)" }} />
              </div>
            )}

            {/* Live results from Yahoo Finance */}
            {liveResults.map(result => (
              <button
                key={result.symbol}
                type="button"
                onMouseDown={e => { e.preventDefault(); setQuery(result.symbol); fetchStock(result.symbol, result.name); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left border-b last:border-b-0"
                style={{ borderColor: "var(--card-border)" }}>
                <Globe size={14} className="flex-shrink-0" style={{ color: "var(--muted)" }} />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-white text-sm">{result.symbol}</span>
                  <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{result.name}</p>
                </div>
                {result.exchange && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: "rgba(100,116,139,0.2)", color: "var(--muted)" }}>
                    {result.exchange}
                  </span>
                )}
              </button>
            ))}

            {/* Loading indicator */}
            {liveLoading && (
              <div className="px-4 py-2.5 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full border border-t-transparent animate-spin flex-shrink-0"
                  style={{ borderColor: "var(--muted)", borderTopColor: "transparent" }} />
                <span className="text-xs" style={{ color: "var(--muted)" }}>Suche weltweit…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search Result Preview */}
      {(searchLoading || searchResult || searchError) && (
        <div
          className="rounded-2xl border p-4"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          {searchLoading && <p className="text-sm" style={{ color: "var(--muted)" }}>Lade…</p>}
          {searchError && <p className="text-sm" style={{ color: "#ef4444" }}>{searchError}</p>}
          {searchResult && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-white">{searchResult.symbol}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{searchResult.name}</p>
                {searchResult.price != null && (
                  <p className="text-sm font-semibold text-white mt-1">
                    {searchResult.price.toFixed(2)} {searchResult.currency ?? ""}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Link
                  href={`/dashboard/asset/${searchResult.symbol}`}
                  className="text-xs px-3 py-2 rounded-xl font-semibold"
                  style={{ background: "var(--primary)", color: "#000" }}>
                  Details
                </Link>
                {!alreadyInList(searchResult.symbol) ? (
                  <button
                    onClick={() => addToWatchlist(searchResult!.symbol, searchResult!.name)}
                    className="text-xs px-3 py-2 rounded-xl font-semibold flex items-center gap-1 border"
                    style={{ borderColor: "var(--card-border)", color: "var(--muted)" }}>
                    <Plus size={12} /> Watchlist
                  </button>
                ) : (
                  <span
                    className="text-xs px-3 py-2 rounded-xl font-semibold"
                    style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
                    ✓ In Liste
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Added feedback */}
      {addedSymbol && (
        <div
          className="rounded-xl px-4 py-2.5 text-sm font-medium text-center"
          style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
          {addedSymbol} zur Watchlist hinzugefügt
        </div>
      )}

      {/* Quick chips */}
      {!query && (
        <div className="space-y-2">
          {(["US", "DE", "ETF"] as const).map(region => (
            <div key={region}>
              <p className="text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
                {REGION_LABEL[region]} {region === "ETF" ? "ETFs" : region === "DE" ? "Deutschland" : "USA"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STOCKS.filter(s => s.region === region).slice(0, region === "ETF" ? 6 : 8).map(s => (
                  <button
                    key={s.symbol}
                    onClick={() => { setQuery(s.symbol); fetchStock(s.symbol, s.name); }}
                    className="rounded-full px-3 py-1 text-xs font-medium border transition-all"
                    style={{
                      background: alreadyInList(s.symbol) ? "rgba(34,197,94,0.1)" : "var(--card)",
                      borderColor: alreadyInList(s.symbol) ? "#22c55e" : "var(--card-border)",
                      color: alreadyInList(s.symbol) ? "#22c55e" : "var(--muted)",
                    }}>
                    {s.symbol}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {isPending && <CardSkeleton />}

      {/* Sort chips */}
      {items.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>Sortierung:</span>
          {(["default", "az", "perf", "score"] as const).map((opt) => {
            const label = { default: "Standard", az: "A–Z", perf: "Performance", score: "Score" }[opt];
            return (
              <button key={opt} onClick={() => setSortBy(opt)}
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: sortBy === opt ? "var(--primary)" : "var(--card)",
                  color: sortBy === opt ? "#000" : "var(--muted)",
                  border: `1px solid ${sortBy === opt ? "transparent" : "var(--card-border)"}`,
                }}>
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Watchlist Items */}
      {items.length === 0 && !isPending ? (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-3xl mb-2">📋</p>
          <p className="text-white font-medium">Watchlist ist leer</p>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Suche oben nach einer Aktie um sie hinzuzufügen
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {sortedItems.map(item => (
            <WatchlistCard key={item.id} item={item} onRemove={handleRemove} onDataLoaded={handleDataLoaded} />
          ))}
        </div>
      )}
    </div>
  );
}
