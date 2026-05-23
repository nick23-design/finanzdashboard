"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { FeedNewsItem } from "@/app/api/news/feed/route";
import { AgentAvatar } from "@/components/ui/AgentAvatar";

const IMPORTANCE_STYLE = {
  hoch:    { label: "Wichtig", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  mittel:  { label: "Mittel",  color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  niedrig: { label: "Gering",  color: "#64748b", bg: "rgba(100,116,139,0.12)" },
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  return `vor ${Math.floor(hours / 24)} Tagen`;
}

export function AssetNewsCard({ symbol }: { symbol: string }) {
  const [news, setNews] = useState<FeedNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/news/${symbol}`);
      if (res.ok) setNews(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { load(); }, [symbol]);

  return (
    <div
      className="rounded-2xl border p-4"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AgentAvatar agent="lisa" size="xs" />
          <h3 className="font-semibold text-white">Aktuelle News</h3>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          title="Aktualisieren"
          className="p-1.5 rounded-lg disabled:opacity-40"
          style={{ color: "var(--muted)", background: "var(--card-border)" }}>
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--card-border)" }} />
          ))}
        </div>
      ) : news.length === 0 ? (
        <p className="text-xs text-center py-4" style={{ color: "var(--muted)" }}>
          Keine aktuellen News gefunden.
        </p>
      ) : (
        <div className="space-y-2">
          {news.map((item, i) => {
            const imp = IMPORTANCE_STYLE[item.importance];
            const showTranslation = item.title_de && item.title_de !== item.title;
            return (
              <div key={i} className="space-y-0.5">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-white leading-snug hover:underline block">
                    {showTranslation ? item.title_de : item.title}
                  </a>
                ) : (
                  <p className="text-xs font-medium text-white leading-snug">
                    {showTranslation ? item.title_de : item.title}
                  </p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ background: imp.bg, color: imp.color }}>
                    {imp.label}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--muted)" }}>{item.source}</span>
                  {item.published && (
                    <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                      · {timeAgo(item.published)}
                    </span>
                  )}
                </div>
                {i < news.length - 1 && (
                  <div className="pt-1.5 border-b" style={{ borderColor: "var(--card-border)" }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
