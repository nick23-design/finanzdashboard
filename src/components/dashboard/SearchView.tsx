"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { searchStocks, STOCKS, type StockEntry } from "@/lib/stocks-list";

const REGION_LABEL: Record<StockEntry["region"], string> = {
  US: "🇺🇸",
  DE: "🇩🇪",
  EU: "🇪🇺",
  CH: "🇨🇭",
  ETF: "📦",
};

interface SearchResult {
  price: number | null;
  currency: string | null;
  name: string;
}

export function SearchView() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<StockEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searched, setSearched] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Suggestions aktualisieren bei Eingabe
  useEffect(() => {
    const hits = searchStocks(query);
    setSuggestions(hits);
    setShowSuggestions(query.length >= 1 && hits.length > 0);
  }, [query]);

  // Dropdown schließen bei Klick außerhalb
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function fetchStock(symbol: string, name?: string) {
    setError(null);
    setResult(null);
    setSearched(symbol);
    setShowSuggestions(false);

    startTransition(async () => {
      const res = await fetch(`/api/assets/${symbol}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Ticker nicht gefunden");
        return;
      }

      setResult({
        price: data.price,
        currency: data.currency,
        name: data.name || name || symbol,
      });
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const symbol = query.trim().toUpperCase();
    if (!symbol) return;
    fetchStock(symbol);
  }

  function handleSuggestionClick(stock: StockEntry) {
    setQuery(stock.symbol);
    fetchStock(stock.symbol, stock.name);
  }

  async function addToWatchlist() {
    if (!searched || !result) return;
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: searched, name: result.name }),
    });
    if (res.ok) {
      setError(null);
      // Kurzes visuelles Feedback
      setResult((prev) => prev ? { ...prev, added: true } as typeof prev & { added: boolean } : prev);
    } else {
      const d = await res.json();
      setError(d.error ?? "Fehler beim Hinzufügen");
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Aktie suchen</h2>

      {/* Suchfeld mit Dropdown */}
      <div className="relative">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              placeholder="Name oder Ticker (z.B. Apple, AAPL, SAP...)"
              maxLength={50}
              autoComplete="off"
              className="w-full rounded-xl px-4 py-3 text-white text-sm border outline-none"
              style={{ background: "var(--card)", borderColor: "var(--card-border)" }}
            />

            {/* Autocomplete-Dropdown */}
            {showSuggestions && (
              <div
                ref={dropdownRef}
                className="absolute top-full left-0 right-0 mt-1 rounded-xl border overflow-hidden z-50 shadow-xl"
                style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
                {suggestions.map((stock) => (
                  <button
                    key={stock.symbol}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSuggestionClick(stock);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                      hover:bg-[var(--background)] border-b last:border-b-0"
                    style={{ borderColor: "var(--card-border)" }}>
                    <span className="text-base">{REGION_LABEL[stock.region]}</span>
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-white text-sm">{stock.symbol}</span>
                      <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                        {stock.name}
                      </p>
                    </div>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: "var(--background)", color: "var(--muted)" }}>
                      {stock.region}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isPending || !query.trim()}
            className="rounded-xl px-4 py-3 font-semibold text-white text-sm disabled:opacity-50 flex-shrink-0"
            style={{ background: "var(--primary)" }}>
            {isPending ? "…" : "Suchen"}
          </button>
        </form>
      </div>

      {/* Schnellauswahl nach Region */}
      <div className="space-y-2">
        {(["US", "DE", "ETF"] as const).map((region) => (
          <div key={region}>
            <p className="text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
              {REGION_LABEL[region]} {region === "ETF" ? "ETFs" : region === "DE" ? "Deutschland" : "USA"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STOCKS.filter((s) => s.region === region)
                .slice(0, region === "ETF" ? 6 : 8)
                .map((s) => (
                  <button
                    key={s.symbol}
                    onClick={() => { setQuery(s.symbol); handleSuggestionClick(s); }}
                    className="rounded-full px-3 py-1 text-xs font-medium border transition-all"
                    style={{
                      background: "var(--card)",
                      borderColor: "var(--card-border)",
                      color: "var(--muted)",
                    }}>
                    {s.symbol}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Ergebnis-Karte */}
      {searched && !isPending && (
        <div
          className="rounded-2xl border p-4"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          {error ? (
            <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
          ) : result ? (
            <div className="space-y-3">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="text-xl font-bold text-white">{searched}</p>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{result.name}</p>
                </div>
                <p className="text-xl font-bold text-white flex-shrink-0">
                  {result.price != null
                    ? `${result.price.toFixed(2)} ${result.currency ?? ""}`
                    : "—"}
                </p>
              </div>

              <div className="flex gap-2">
                <Link
                  href={`/dashboard/asset/${searched}`}
                  className="flex-1 rounded-xl py-2.5 text-center text-sm font-semibold text-white"
                  style={{ background: "var(--primary)" }}>
                  Vollständige Analyse
                </Link>
                <button
                  onClick={addToWatchlist}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold border transition-colors"
                  style={{
                    borderColor: "var(--card-border)",
                    color: "var(--muted)",
                  }}>
                  + Watchlist
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
