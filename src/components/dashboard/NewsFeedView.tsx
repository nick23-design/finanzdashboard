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

export function NewsFeedView() {
  const [news, setNews] = useState<FeedNewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/news/feed")
      .then(r => r.json())
      .then(data => setNews(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-32 rounded-lg animate-pulse" style={{ background: "var(--card-border)" }} />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">News</h2>

      {news.length === 0 ? (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <p className="text-3xl mb-2">📰</p>
          <p className="text-sm font-medium text-white mb-1">Keine Nachrichten</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Füge Aktien zur Watchlist hinzu um News zu sehen.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {news.map((item, i) => (
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
                  <p className="text-sm font-medium text-white leading-snug">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
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
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
