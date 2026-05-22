"use client";

import { useEffect, useState } from "react";
import type { FeedNewsItem } from "@/app/api/news/feed/route";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  return `vor ${Math.floor(hours / 24)} Tagen`;
}

const IMPORTANCE_STYLE = {
  hoch:    { label: "Wichtig",  color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  mittel:  { label: "Mittel",   color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  niedrig: { label: "Gering",   color: "#64748b", bg: "rgba(100,116,139,0.12)" },
};

export function NewsFeedView() {
  const [news, setNews] = useState<FeedNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"alle" | "hoch" | "mittel" | "niedrig">("alle");

  useEffect(() => {
    fetch("/api/news/feed")
      .then(r => r.json())
      .then(data => setNews(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === "alle" ? news : news.filter(n => n.importance === filter);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-32 rounded-lg animate-pulse" style={{ background: "var(--card-border)" }} />
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Lena klassifiziert und übersetzt die Artikel…
        </p>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">News</h2>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {news.length} Artikel
        </span>
      </div>

      {/* Filter */}
      {news.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["alle", "hoch", "mittel", "niedrig"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-opacity"
              style={{
                background: filter === f
                  ? f === "alle" ? "var(--primary)" : IMPORTANCE_STYLE[f]?.bg
                  : "var(--card-border)",
                color: filter === f
                  ? f === "alle" ? "#000" : IMPORTANCE_STYLE[f]?.color
                  : "var(--muted)",
                opacity: filter === f ? 1 : 0.7,
              }}>
              {f === "alle" ? "Alle" : IMPORTANCE_STYLE[f].label}
              {f !== "alle" && (
                <span className="ml-1">
                  ({news.filter(n => n.importance === f).length})
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-3xl mb-2">📰</p>
          <p className="text-sm font-medium text-white mb-1">Keine Nachrichten</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {news.length === 0
              ? "Füge Aktien zur Watchlist hinzu um News zu sehen."
              : "Keine Artikel in dieser Kategorie."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item, i) => {
            const imp = IMPORTANCE_STYLE[item.importance];
            const showTranslation = item.title_de && item.title_de !== item.title;
            return (
              <div
                key={i}
                className="rounded-2xl border p-4"
                style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
                <div className="flex items-start gap-3">
                  <span
                    className="text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0 mt-0.5"
                    style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
                    {item.symbol}
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* German title (main) */}
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-white leading-snug hover:underline block">
                        {showTranslation ? item.title_de : item.title}
                      </a>
                    ) : (
                      <p className="text-sm font-medium text-white leading-snug">
                        {showTranslation ? item.title_de : item.title}
                      </p>
                    )}

                    {/* Original title */}
                    {showTranslation && (
                      <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--muted)" }}>
                        {item.title}
                      </p>
                    )}

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: imp.bg, color: imp.color }}>
                        {imp.label}
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        {item.source}
                      </span>
                      {item.published && (
                        <>
                          <span style={{ color: "var(--card-border)" }}>·</span>
                          <span className="text-xs" style={{ color: "var(--muted)" }}>
                            {timeAgo(item.published)}
                          </span>
                        </>
                      )}
                      {item.url && (
                        <>
                          <span style={{ color: "var(--card-border)" }}>·</span>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs hover:underline"
                            style={{ color: "var(--primary)" }}>
                            Artikel lesen →
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
