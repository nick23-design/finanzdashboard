"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { formatRelativeTime } from "@/lib/time";
import type { NHAccuracyStats, NHPickResult } from "@/app/api/nh-select/accuracy/route";

// ── Stock Search ─────────────────────────────────────────────────────────────

interface StockSearchResult {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  EQUITY: "Aktie", ETF: "ETF", INDEX: "Index",
  CRYPTOCURRENCY: "Krypto", CURRENCY: "Währung", MUTUALFUND: "Fonds",
};
const EXCHANGE_LABEL: Record<string, string> = {
  NMS: "NASDAQ", NYQ: "NYSE", NGM: "NASDAQ", PCX: "NYSE Arca",
  GER: "XETRA", FRA: "Frankfurt", MCE: "Madrid", PAR: "Paris", AMS: "Amsterdam",
};

function SearchResults({ results, loading, query }: {
  results: StockSearchResult[];
  loading: boolean;
  query: string;
}) {
  if (loading && results.length === 0) {
    return (
      <div className="rounded-2xl border p-5 text-center"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-2"
          style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
        <p className="text-xs" style={{ color: "var(--muted)" }}>Suche läuft…</p>
      </div>
    );
  }
  if (!loading && results.length === 0 && query.trim()) {
    return (
      <div className="rounded-2xl border p-5 text-center"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <p className="text-sm font-medium text-white">Keine Ergebnisse</p>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          Versuche einen anderen Ticker oder Namen
        </p>
      </div>
    );
  }
  if (!results.length) return null;
  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <p className="text-[10px] px-4 pt-3 pb-2 font-semibold uppercase tracking-widest"
        style={{ color: "var(--muted)" }}>
        Suchergebnisse
      </p>
      {results.map((r, i) => (
        <Link key={i} href={`/dashboard/asset/${r.symbol}`}
          className="flex items-center justify-between gap-3 px-4 py-3 border-t"
          style={{ borderColor: "var(--card-border)" }}>
          <div className="min-w-0">
            <p className="font-bold text-white text-sm">{r.symbol}</p>
            <p className="text-xs truncate mt-0.5" style={{ color: "var(--muted)" }}>{r.name}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {r.exchange && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--card-border)", color: "var(--muted)" }}>
                {EXCHANGE_LABEL[r.exchange] ?? r.exchange}
              </span>
            )}
            {r.type && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
                {TYPE_LABEL[r.type] ?? r.type}
              </span>
            )}
            <span className="text-sm" style={{ color: "var(--muted)" }}>›</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

interface NHSelectEntry {
  symbol: string;
  name?: string;
  recommendation: string;
  conviction: number;
  rationale: string;
  sources: string[];
  agent: string;
  created_at: string;
}

interface HistoryData {
  history: NHSelectEntry[];
  scouts: NHSelectEntry[];
}

const REC_STYLE: Record<string, { bg: string; text: string }> = {
  "Kaufen":           { bg: "#16a34a", text: "#ffffff" },
  "Leicht kaufen":    { bg: "#4ade80", text: "#14532d" },
  "Halten":           { bg: "#ca8a04", text: "#ffffff" },
  "Leicht verkaufen": { bg: "#f97316", text: "#ffffff" },
  "Verkaufen":        { bg: "#dc2626", text: "#ffffff" },
};

function sourceLabel(s: unknown): string {
  if (typeof s === "string") return s;
  if (typeof s === "object" && s !== null) {
    const o = s as Record<string, unknown>;
    return String(o.name ?? o.title ?? o.url ?? o.agent ?? "Quelle");
  }
  return String(s);
}

const SCOUT_AVATAR: Record<string, "us-scout" | "de-scout" | "podcast-scout" | "synthesizer"> = {
  "US-Scout":      "us-scout",
  "DE-Scout":      "de-scout",
  "Podcast-Scout": "podcast-scout",
  "Synthesizer":   "synthesizer",
};

function ConvictionBar({ value }: { value: number | null | undefined }) {
  if (value == null || isNaN(value)) return null;
  const pct = Math.min(100, Math.max(0, (value / 10) * 100));
  const color = value >= 7 ? "#22c55e" : value >= 5 ? "#ca8a04" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full h-1.5 overflow-hidden" style={{ background: "var(--card-border)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{value}/10</span>
    </div>
  );
}

function TodayPick({ pick }: { pick: NHSelectEntry }) {
  const recStyle = REC_STYLE[pick.recommendation] ?? { bg: "#6b7280", text: "#fff" };
  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{
        background: "var(--card)",
        borderColor: "var(--primary)",
        boxShadow: "0 0 20px rgba(0,230,118,0.08)",
      }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AgentAvatar agent="synthesizer" size="sm" />
          <div>
            <p className="text-[10px] font-semibold" style={{ color: "var(--primary)" }}>
              NH SELECT · HEUTE
            </p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>
              {formatRelativeTime(pick.created_at)}
            </p>
          </div>
        </div>
        <span
          className="text-xs px-2.5 py-1 rounded-full font-bold"
          style={{ background: recStyle.bg, color: recStyle.text }}>
          {pick.recommendation}
        </span>
      </div>

      {/* Symbol */}
      <div>
        <p className="text-2xl font-bold text-white">{pick.symbol}</p>
        {pick.name && (
          <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>{pick.name}</p>
        )}
      </div>

      {/* Conviction */}
      <div>
        <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>Überzeugung</p>
        <ConvictionBar value={pick.conviction} />
      </div>

      {/* Rationale */}
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        {pick.rationale}
      </p>

      {/* Sources */}
      {pick.sources?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pick.sources.map((s, i) => (
            <span
              key={i}
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: "var(--card-border)", color: "var(--muted)" }}>
              {sourceLabel(s)}
            </span>
          ))}
        </div>
      )}

      {/* CTA */}
      <Link
        href={`/dashboard/asset/${pick.symbol}?from=nh-select`}
        className="block w-full text-center rounded-xl py-2.5 text-sm font-semibold"
        style={{ background: "var(--primary)", color: "#000" }}>
        Aktie analysieren →
      </Link>
    </div>
  );
}

function ScoutFindings({ scouts }: { scouts: NHSelectEntry[] }) {
  if (!scouts.length) return null;

  const byAgent: Record<string, NHSelectEntry[]> = {};
  for (const s of scouts) {
    if (!byAgent[s.agent]) byAgent[s.agent] = [];
    byAgent[s.agent].push(s);
  }

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
        Scout-Findings heute
      </p>

      {Object.entries(byAgent).map(([agent, picks]) => {
        const avatarId = SCOUT_AVATAR[agent];
        return (
          <div key={agent}>
            <div className="flex items-center gap-2 mb-2">
              {avatarId && <AgentAvatar agent={avatarId} size="xs" />}
              <p className="text-xs font-semibold text-white">{agent}</p>
            </div>
            <div className="space-y-1.5 ml-8">
              {picks.map((p, i) => {
                const recStyle = REC_STYLE[p.recommendation] ?? { bg: "#6b7280", text: "#fff" };
                return (
                  <Link
                    key={i}
                    href={`/dashboard/asset/${p.symbol}?from=nh-select`}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
                    style={{ background: "var(--background)" }}>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white">{p.symbol}</p>
                      {p.name && (
                        <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>{p.name}</p>
                      )}
                    </div>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                      style={{ background: recStyle.bg, color: recStyle.text }}>
                      {sourceLabel(p.recommendation)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HistoryList({ history }: { history: NHSelectEntry[] }) {
  if (!history.length) return null;

  const grouped: Record<string, NHSelectEntry[]> = {};
  for (const entry of history) {
    const dateKey = new Date(entry.created_at).toLocaleDateString("de-DE", {
      weekday: "short", day: "2-digit", month: "2-digit",
    });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(entry);
  }

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
        Letzte Picks
      </p>
      <div className="space-y-3">
        {Object.entries(grouped).map(([date, entries]) => (
          <div key={date}>
            <p className="text-[10px] font-medium mb-1.5" style={{ color: "var(--muted)" }}>{date}</p>
            {entries.map((entry, i) => {
              const recStyle = REC_STYLE[entry.recommendation] ?? { bg: "#6b7280", text: "#fff" };
              return (
                <Link
                  key={i}
                  href={`/dashboard/asset/${entry.symbol}?from=nh-select`}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 mb-1"
                  style={{ background: "var(--background)" }}>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">{entry.symbol}</p>
                    {entry.name && (
                      <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>{entry.name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right">
                      <ConvictionBar value={entry.conviction} />
                    </div>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: recStyle.bg, color: recStyle.text }}>
                      {entry.recommendation}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Trefferquote ────────────────────────────────────────────────────────────

const OUTCOME_STYLE = {
  correct:   { label: "Korrekt",     color: "#22c55e", icon: "✓" },
  neutral:   { label: "Neutral",     color: "#ca8a04", icon: "~" },
  incorrect: { label: "Falsch",      color: "#ef4444", icon: "✗" },
  pending:   { label: "Ausstehend",  color: "#6b7280", icon: "…" },
};

function TrefferquoteSection() {
  const [stats, setStats] = useState<NHAccuracyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/nh-select/accuracy")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d as NHAccuracyStats); })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border p-4 animate-pulse space-y-3"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="h-4 w-32 rounded" style={{ background: "var(--card-border)" }} />
        <div className="h-10 w-20 rounded" style={{ background: "var(--card-border)" }} />
      </div>
    );
  }

  const noData = !stats || stats.total_tracked === 0;

  return (
    <div className="rounded-2xl border p-4 space-y-4"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">Trefferquote</h3>
        <div className="flex items-center gap-2">
          {stats && stats.pending > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: "rgba(107,114,128,0.15)", color: "#6b7280" }}>
              {stats.pending} ausstehend
            </span>
          )}
          {stats && stats.evaluated > 0 && (
            <button className="text-xs" style={{ color: "var(--muted)" }}
              onClick={() => setExpanded(v => !v)}>
              {expanded ? "Weniger ▲" : "Alle Picks ▼"}
            </button>
          )}
        </div>
      </div>

      {noData ? (
        <div className="text-center py-4 space-y-1">
          <p className="text-2xl">📊</p>
          <p className="text-sm font-medium text-white">Noch keine Daten</p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Nach {7} Tagen werden Picks automatisch ausgewertet.<br />
            Picks werden ab heute mit Preis gespeichert.
          </p>
        </div>
      ) : (
        <>
          {/* Hauptzahl */}
          <div className="flex items-end gap-4">
            <div>
              <p className="text-4xl font-bold"
                style={{
                  color: stats!.accuracy_rate == null ? "var(--muted)"
                    : stats!.accuracy_rate >= 0.6 ? "#22c55e"
                    : stats!.accuracy_rate >= 0.4 ? "#ca8a04"
                    : "#ef4444",
                }}>
                {stats!.accuracy_rate != null
                  ? `${(stats!.accuracy_rate * 100).toFixed(0)}%`
                  : "—"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                Trefferquote ({stats!.correct + stats!.incorrect} bewertet)
              </p>
            </div>
            {stats!.avg_return != null && (
              <div className="pb-1">
                <p className="text-xl font-bold"
                  style={{ color: stats!.avg_return >= 0 ? "#22c55e" : "#ef4444" }}>
                  {stats!.avg_return >= 0 ? "+" : ""}{stats!.avg_return.toFixed(1)}%
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>Ø Rendite</p>
              </div>
            )}
          </div>

          {/* Balken */}
          {stats!.evaluated > 0 && (
            <div className="space-y-1.5">
              {(["correct", "neutral", "incorrect"] as const).map(k => {
                const count = stats![k];
                const pct = stats!.evaluated > 0 ? (count / stats!.evaluated) * 100 : 0;
                const s = OUTCOME_STYLE[k];
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span className="text-xs w-16 font-medium" style={{ color: s.color }}>
                      {s.icon} {s.label}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--card-border)" }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: s.color }} />
                    </div>
                    <span className="text-xs w-4 text-right font-medium text-white">{count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pick-Liste */}
          {expanded && stats!.picks.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: "var(--card-border)" }}>
              <p className="text-xs font-semibold text-white pt-2">Alle Picks</p>
              {stats!.picks.map((p: NHPickResult, i: number) => {
                const s = OUTCOME_STYLE[p.outcome];
                const recStyle = REC_STYLE[p.recommendation] ?? { bg: "#6b7280", text: "#fff" };
                const date = new Date(p.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
                return (
                  <Link
                    key={i}
                    href={`/dashboard/asset/${p.symbol}?from=nh-select`}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
                    style={{ background: "var(--background)" }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-white w-12 flex-shrink-0">{p.symbol}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                        style={{ background: recStyle.bg, color: recStyle.text }}>
                        {p.recommendation}
                      </span>
                      <span className="text-[10px] flex-shrink-0" style={{ color: "var(--muted)" }}>{date}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {p.return_pct != null && (
                        <span className="text-xs font-semibold"
                          style={{ color: p.return_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                          {p.return_pct >= 0 ? "+" : ""}{p.return_pct.toFixed(1)}%
                        </span>
                      )}
                      <span className="text-xs font-bold" style={{ color: s.color }}>{s.icon}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

async function subscribeToPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: VAPID_PUBLIC,
  });

  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
  return true;
}

async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}

function PushButton() {
  const [state, setState] = useState<"unknown" | "subscribed" | "denied" | "unsupported">("unknown");
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC) {
      setState("unsupported");
      return;
    }
    // Register SW
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    // Check current subscription state
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (sub) setState("subscribed");
      else if (Notification.permission === "denied") setState("denied");
      else setState("unknown");
    });
  }, []);

  if (state === "unsupported" || !VAPID_PUBLIC) return null;

  if (state === "subscribed") {
    return (
      <button
        onClick={async () => { await unsubscribeFromPush(); setState("unknown"); }}
        className="text-xs px-3 py-1.5 rounded-xl"
        style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>
        Benachrichtigungen aktiv ✓
      </button>
    );
  }

  if (state === "denied") {
    return (
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        Benachrichtigungen gesperrt
      </span>
    );
  }

  return (
    <button
      onClick={async () => {
        const ok = await subscribeToPush();
        setState(ok ? "subscribed" : Notification.permission === "denied" ? "denied" : "unknown");
      }}
      className="text-xs px-3 py-1.5 rounded-xl"
      style={{ background: "var(--card-border)", color: "var(--muted)" }}>
      Benachrichtigungen
    </button>
  );
}

export function NHSelectView() {
  const [today, setToday] = useState<NHSelectEntry | null | undefined>(undefined);
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function load() {
      const [todayRes, historyRes] = await Promise.all([
        fetch("/api/nh-select").then(r => r.json()).catch(() => null),
        fetch("/api/nh-select/history").then(r => r.json()).catch(() => ({ history: [], scouts: [] })),
      ]);
      setToday(todayRes);
      setData(historyRes as HistoryData);
      setLoading(false);
    }
    load();
  }, []);

  function handleSearch(q: string) {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) setSearchResults(await res.json());
        else setSearchResults([]);
      } catch {
        setSearchResults([]);
      }
      setSearchLoading(false);
    }, 350);
  }

  const isSearching = searchQuery.trim().length > 0;

  const pastHistory = (data?.history ?? []).filter(h =>
    !today || new Date(h.created_at).toDateString() !== new Date(today.created_at).toDateString()
  );

  return (
    <div className="space-y-4">
      {/* Search bar – always visible */}
      <div className="flex items-center gap-2 rounded-2xl border px-4 py-3"
        style={{
          background: "var(--card)",
          borderColor: isSearching ? "var(--primary)" : "var(--card-border)",
          transition: "border-color 0.2s",
        }}>
        <Search size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <input
          value={searchQuery}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Ticker oder Unternehmensname suchen…"
          className="flex-1 bg-transparent text-sm text-white outline-none"
          style={{ caretColor: "var(--primary)" }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        {searchLoading && (
          <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
            style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
        )}
        {searchQuery && !searchLoading && (
          <button onClick={() => handleSearch("")}
            className="text-sm flex-shrink-0"
            style={{ color: "var(--muted)" }}>✕</button>
        )}
      </div>

      {/* Search results */}
      {isSearching && (
        <SearchResults results={searchResults} loading={searchLoading} query={searchQuery} />
      )}

      {/* NH Select content – hidden while searching */}
      {!isSearching && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">NH Select</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                Täglich die eine vielversprechendste Aktie
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PushButton />
              <AgentAvatar agent="synthesizer" size="sm" />
            </div>
          </div>

          {loading && (
            <div className="rounded-2xl border p-8 text-center"
              style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-2"
                style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
              <p className="text-xs" style={{ color: "var(--muted)" }}>Lade NH Select…</p>
            </div>
          )}

          {!loading && !today && (
            <div className="rounded-2xl border p-6 text-center space-y-2"
              style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
              <p className="text-2xl">🕐</p>
              <p className="font-semibold text-white">Noch kein Pick heute</p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                Der Synthesizer läuft täglich um 10:30 Uhr (Mo–Fr).<br />
                Am Wochenende gibt es keinen neuen Pick.
              </p>
            </div>
          )}

          {!loading && today && <TodayPick pick={today} />}
          {!loading && data && <ScoutFindings scouts={data.scouts} />}
          {!loading && pastHistory.length > 0 && <HistoryList history={pastHistory} />}
          {!loading && <TrefferquoteSection />}

          <p className="text-xs text-center pb-2" style={{ color: "var(--muted)" }}>
            Ausschließlich zu Research-Zwecken · Keine Anlageberatung
          </p>
        </>
      )}
    </div>
  );
}
