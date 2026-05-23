"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import type { FeedNewsItem } from "@/app/api/news/feed/route";
import { AgentAvatar } from "@/components/ui/AgentAvatar";

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

interface PodcastSource {
  name: string;
  title: string;
  url?: string;
  summary: string;
}

export function NewsFeedView() {
  const [news, setNews] = useState<FeedNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<"alle" | "hoch" | "mittel" | "niedrig">("alle");
  const [podcasts, setPodcasts] = useState<PodcastSource[]>([]);
  const [podcastsOpen, setPodcastsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function loadNews(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/news/feed");
      if (res.ok) {
        setNews(await res.json());
        setLoadedAt(new Date());
      }
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    loadNews();
    fetch("/api/nh-select")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.sources) {
          const ps: PodcastSource[] = (data.sources as { agent: string; name: string; title: string; url?: string; summary: string }[])
            .filter(s => s.agent === "Podcast-Scout")
            .map(s => ({ name: s.name, title: s.title, url: s.url, summary: s.summary }));
          if (ps.length > 0) setPodcasts(ps);
        }
      })
      .catch(() => null);
  }, []);

  const standStr = loadedAt
    ? (() => {
        const diff = now - loadedAt.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "gerade eben";
        if (mins < 60) return `vor ${mins} Min.`;
        return `vor ${Math.floor(mins / 60)} Std.`;
      })()
    : null;

  const filtered = filter === "alle" ? news : news.filter(n => n.importance === filter);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-32 rounded-lg animate-pulse" style={{ background: "var(--card-border)" }} />
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Lisa klassifiziert und übersetzt die Artikel…
        </p>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AgentAvatar agent="lisa" size="sm" />
          <div>
            <h2 className="text-xl font-bold text-white leading-none">News</h2>
            {standStr && (
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                Stand: {standStr}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {news.length} Artikel
          </span>
          <button
            onClick={() => loadNews(true)}
            disabled={refreshing}
            title="Aktualisieren"
            className="p-1.5 rounded-lg disabled:opacity-40 transition-colors"
            style={{ color: "var(--muted)", background: "var(--card-border)" }}>
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Podcast Sources (from NH Select) */}
      {podcasts.length > 0 && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--card)", borderColor: "rgba(139,92,246,0.25)" }}>
          <button
            onClick={() => setPodcastsOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium"
            style={{ color: podcastsOpen ? "#a78bfa" : "var(--muted)" }}>
            <div className="flex items-center gap-2">
              <AgentAvatar agent="podcast-scout" size="xs" />
              <span>{podcasts.length} analysierte Podcast{podcasts.length !== 1 ? "s" : ""} (NH Select)</span>
            </div>
            <span>{podcastsOpen ? "▲" : "▼"}</span>
          </button>
          {podcastsOpen && (
            <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid rgba(139,92,246,0.15)" }}>
              {podcasts.map((p, i) => (
                <div
                  key={i}
                  className="rounded-xl p-3 space-y-1 mt-3"
                  style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.12)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">{p.name}</p>
                      <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--muted)" }}>{p.title}</p>
                    </div>
                    {p.url && (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 mt-0.5"
                        style={{ color: "#a78bfa" }}>
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                  <p
                    className="text-xs leading-relaxed pt-1"
                    style={{ color: "var(--muted)", borderTop: "1px solid rgba(139,92,246,0.1)" }}>
                    {p.summary}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

                    {showTranslation && (
                      <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--muted)" }}>
                        {item.title}
                      </p>
                    )}

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

      {/* Footer */}
      <div className="flex items-center justify-center gap-2 pb-2">
        <AgentAvatar agent="lisa" size="xs" showName />
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          · kuratiert von Lisa
          {standStr ? ` · ${standStr}` : ""}
        </span>
      </div>
    </div>
  );
}
