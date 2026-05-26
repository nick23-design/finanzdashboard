"use client";

import { useEffect, useState } from "react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import type { AgentId } from "@/components/ui/AgentAvatar";
import { AccuracyCard } from "@/components/ui/AccuracyCard";

type ServiceStatus = "online" | "warming" | "offline" | "checking";

interface AgentStatus {
  anthropic: ServiceStatus;
  finance_api: ServiceStatus;
}

interface Agent {
  id: string;
  avatarId: AgentId;
  name: string;
  role: string;
  model: string;
  modelLabel: string;
  color: string;
  description: string;
  tasks: string[];
  requiresFinanceApi: boolean;
  isOrchestrator?: boolean;
}

interface Category {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  agents: Agent[];
}

const CATEGORIES: Category[] = [
  {
    id: "ki-analyse",
    title: "KI-Analyse",
    subtitle: "Auf Abruf · tiefgehende Aktienanalyse",
    color: "#f59e0b",
    agents: [
      {
        id: "opus",
        avatarId: "opus",
        name: "Opus",
        role: "Orchestrator & Stratege",
        model: "claude-opus-4-7",
        modelLabel: "Claude Opus 4.7",
        color: "#f59e0b",
        description:
          "Opus koordiniert alle Analyse-Agenten und trifft die finale Investmentempfehlung. Er entscheidet selbst welche Analysen er anfordert, kann bei unzureichenden Ergebnissen nachfragen und nutzt als einziger adaptives Denken.",
        tasks: [
          "Koordiniert Felix, Nina und Marco als Orchestrator",
          "Kann Agenten mehrfach mit spezifischem Fokus aufrufen",
          "Research-Einschätzung (Kaufen–Verkaufen) mit Überzeugungswert 1–10",
          "Bull-Case, Bear-Case und Kursziele",
        ],
        requiresFinanceApi: false,
        isOrchestrator: true,
      },
      {
        id: "diana",
        avatarId: "diana",
        name: "Diana",
        role: "Datenqualitäts-Modul",
        model: "rule-based",
        modelLabel: "Regelbasiert",
        color: "#06b6d4",
        description:
          "Diana prüft vor jeder Analyse die Vollständigkeit der verfügbaren Kennzahlen. Sie berechnet einen Datenbasis-Score (0–100) und gibt einen maximalen Conviction-Cap an Opus weiter — damit lückenhafte Daten nicht zu überkonfidenten Empfehlungen führen.",
        tasks: [
          "Datenbasis-Score (0–100) regelbasiert berechnen",
          "Fehlende Kennzahlen identifizieren (KGV, FCF, Marktkapitalisierung etc.)",
          "Conviction-Cap für Opus setzen (4–10)",
          "Datenbasis-Warnung in der Analyse-UI anzeigen",
        ],
        requiresFinanceApi: true,
      },
      {
        id: "felix",
        avatarId: "felix",
        name: "Felix",
        role: "Fundamental-Analyst",
        model: "claude-haiku-4-5",
        modelLabel: "Claude Haiku 4.5",
        color: "#3b82f6",
        description:
          "Felix analysiert Finanzkennzahlen und liest Geschäftsberichte aus der SEC EDGAR-Datenbank. Er bewertet ob ein Unternehmen fundamental gesund ist.",
        tasks: [
          "KGV, Free Cashflow, Verschuldungsgrad",
          "Umsatzwachstum und Profitabilität",
          "SEC EDGAR Quartalsdaten",
          "Wachstumsbewertung 1–10",
        ],
        requiresFinanceApi: true,
      },
      {
        id: "nina",
        avatarId: "nina",
        name: "Nina",
        role: "Sentiment-Analystin",
        model: "claude-haiku-4-5",
        modelLabel: "Claude Haiku 4.5",
        color: "#8b5cf6",
        description:
          "Nina bewertet angereicherte Nachrichtenartikel (Titel + Excerpts aus Jina AI) und bestimmt die Marktstimmung. Hochwertige Quellen (Reuters, Bloomberg, FT u.a.) werden stärker gewichtet.",
        tasks: [
          "Stimmungsbewertung (bullish/neutral/bearish)",
          "Gewichtung nach Quellenqualität",
          "Wichtigste Nachrichtenthemen",
          "Zusammenfassung der Nachrichtenlage",
        ],
        requiresFinanceApi: true,
      },
      {
        id: "marco",
        avatarId: "marco",
        name: "Marco",
        role: "Markt-Intelligence",
        model: "claude-haiku-4-5",
        modelLabel: "Claude Haiku 4.5",
        color: "#f97316",
        description:
          "Marco beobachtet was kluge Geldgeber tun. Er analysiert Insider-Transaktionen aus SEC Form 4-Meldungen, institutionelle Positionen und Google Trends.",
        tasks: [
          "SEC Form 4 Insider-Käufe und -Verkäufe",
          "Institutionelle Halter und deren Anteil",
          "Google Trends Suchinteresse",
          "Markt-Signal Bewertung",
        ],
        requiresFinanceApi: true,
      },
      {
        id: "vera",
        avatarId: "vera",
        name: "Vera",
        role: "Fakten-Prüferin",
        model: "claude-haiku-4-5",
        modelLabel: "Claude Haiku 4.5",
        color: "#ef4444",
        description:
          "Vera prüft die fertige Analyse nachgelagert gegen authoritative Finance-API-Daten, Analysten-Konsens und vorhandene News-Excerpts. Der Fact-Check blockiert die Hauptanalyse nicht; Korrekturen oder Timeouts sind im Analyse-Protokoll sichtbar.",
        tasks: [
          "Authoritative Kennzahlen (Kurs, MAs, RSI, KGV etc.) als Referenz",
          "Altersbasierte Artikel-Freshness-Regeln (Preise <2d, Quartale <14d)",
          "Nachgelagerter Schnellcheck mit bereits angereicherten News-Excerpts",
          "Conviction-Anpassung bei belegten Fehlern (max. −3)",
        ],
        requiresFinanceApi: true,
      },
      {
        id: "kai",
        avatarId: "kai",
        name: "Kai",
        role: "Vergleichs-Analyst",
        model: "claude-opus-4-7",
        modelLabel: "Claude Opus 4.7",
        color: "#6366f1",
        description:
          "Kai vergleicht zwei Aktien mit Adaptive Thinking. Er bezieht Fundamentaldaten, Peer-Kontext und News-Excerpts beider Titel ein, benennt Stärken und Schwächen und liefert ein begründetes Verdict.",
        tasks: [
          "Direktvergleich zweier Aktien mit Adaptive Thinking",
          "Fundamentaldaten, Peer-Kontext und News-Excerpts",
          "Stärken, Schwächen und Verdict",
          "Research-Einschätzung — keine Handelsempfehlung",
        ],
        requiresFinanceApi: false,
      },
    ],
  },
  {
    id: "nh-select",
    title: "NH Select",
    subtitle: "Täglich 08:30 · autonome Aktienempfehlung",
    color: "#6366f1",
    agents: [
      {
        id: "radar",
        avatarId: "radar",
        name: "Radar",
        role: "Trend-Scanner",
        model: "claude-sonnet-4-6",
        modelLabel: "Claude Sonnet 4.6",
        color: "#22c55e",
        description:
          "Radar scannt täglich um 08:00 Uhr Yahoo Finance Trending Tickers, bewertet sie anhand Scores und News — und speichert die interessantesten Signale für den Synthesizer.",
        tasks: [
          "Täglicher automatischer Markt-Scan",
          "Yahoo Finance Trending Tickers auswerten",
          "Score- und News-basierte Signalidentifikation",
          "Signale an Synthesizer übergeben",
        ],
        requiresFinanceApi: true,
      },
      {
        id: "us-scout",
        avatarId: "us-scout",
        name: "US-Scout",
        role: "US-Markt Analyst",
        model: "claude-haiku-4-5",
        modelLabel: "Claude Haiku 4.5",
        color: "#3b82f6",
        description:
          "Der US-Scout durchsucht täglich US-amerikanische Finanznachrichten und Investment-Newsletter. Er identifiziert vielversprechende US-Aktien und übergibt sie dem Synthesizer.",
        tasks: [
          "US-Finanznews und Newsletter auswerten",
          "Analyst-Upgrades und Earnings-Beats erkennen",
          "Vielversprechende US-Aktien identifizieren",
          "Kandidaten an den Synthesizer übergeben",
        ],
        requiresFinanceApi: false,
      },
      {
        id: "de-scout",
        avatarId: "de-scout",
        name: "DE-Scout",
        role: "DACH-Markt Analyst",
        model: "claude-haiku-4-5",
        modelLabel: "Claude Haiku 4.5",
        color: "#6ECF97",
        description:
          "Der DE-Scout analysiert deutschsprachige Finanzmedien und Börsenberichte. Er sucht täglich nach Chancen im deutschen und europäischen Markt.",
        tasks: [
          "Deutsche Finanzmedien und Börsenberichte lesen",
          "DACH- und Europa-Aktien identifizieren",
          "Quellen auf Deutsch dokumentieren",
          "Kandidaten an den Synthesizer übergeben",
        ],
        requiresFinanceApi: false,
      },
      {
        id: "podcast-scout",
        avatarId: "podcast-scout",
        name: "Podcast-Scout",
        role: "Podcast Analyst",
        model: "claude-haiku-4-5",
        modelLabel: "Claude Haiku 4.5",
        color: "#8b5cf6",
        description:
          "Der Podcast-Scout liest täglich Shownotes und RSS-Feeds von Investment-Podcasts wie 'Alles auf Aktien' und 'Motley Fool'. Er extrahiert genannte Aktienempfehlungen.",
        tasks: [
          "RSS-Feeds von Investment-Podcasts lesen",
          "Genannte Aktien und Thesen festhalten",
          "Episode-Zusammenfassungen erstellen",
          "Podcast-Insights an Synthesizer weitergeben",
        ],
        requiresFinanceApi: false,
      },
      {
        id: "synthesizer",
        avatarId: "synthesizer",
        name: "Synthesizer",
        role: "Chef-Analyst · betrieben von Opus",
        model: "claude-opus-4-7",
        modelLabel: "Claude Opus 4.7",
        color: "#6366f1",
        description:
          "Der Synthesizer ist das Herzstück von NH Select. Täglich um 10:30 Uhr wertet Opus alle Scout- und Radar-Ergebnisse aus und kürt die eine vielversprechendste Aktie des Tages.",
        tasks: [
          "Scout- und Radar-Ergebnisse zusammenführen",
          "Score-basierte Kandidatenbewertung",
          "Täglich eine NH-Select-Empfehlung erstellen",
          "Begründung und Quellen dokumentieren",
        ],
        requiresFinanceApi: false,
        isOrchestrator: true,
      },
    ],
  },
  {
    id: "daily-services",
    title: "Daily Services",
    subtitle: "Laufend · Entdeckung & News",
    color: "#06b6d4",
    agents: [
      {
        id: "finn",
        avatarId: "finn",
        name: "Finn",
        role: "Morning Briefing Agent",
        model: "claude-haiku-4-5",
        modelLabel: "Claude Haiku 4.5",
        color: "#f59e0b",
        description:
          "Finn erstellt täglich das persönliche Morgen-Briefing. Er bewertet Marktindizes, priorisiert Watchlist-Bewegungen nach Tagesperformance und wählt die Idee des Tages anhand eines mehrstufigen Scoring-Verfahrens (RSI, News, Earnings). Ein integrierter Validierungs-Layer prüft Richtungsangaben und filtert Anlagesprache heraus.",
        tasks: [
          "Marktüberblick mit vorberechneten Index-Richtungen",
          "Watchlist-Priorisierung nach Tagesbewegung",
          "Mehrstufiges Idee-des-Tages-Scoring",
          "Validierung und Sanitizing des generierten Texts",
        ],
        requiresFinanceApi: true,
      },
      {
        id: "lisa",
        avatarId: "lisa",
        name: "Lisa",
        role: "News-Kuratorin",
        model: "claude-haiku-4-5",
        modelLabel: "Claude Haiku 4.5",
        color: "#06b6d4",
        description:
          "Lisa kuratiert den Nachrichten-Feed. Sie bewertet Titel und Artikel-Excerpts aller Watchlist-News, klassifiziert die Investoren-Relevanz und übersetzt automatisch ins Deutsche.",
        tasks: [
          "Relevanz-Klassifizierung (Wichtig / Mittel / Gering)",
          "Automatische Übersetzung ins Deutsche",
          "Sortierung nach Investoren-Relevanz",
          "Batch-Verarbeitung aller Watchlist-News",
        ],
        requiresFinanceApi: true,
      },
    ],
  },
];

function StatusDot({ status }: { status: ServiceStatus }) {
  if (status === "checking") {
    return <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#ca8a04" }} />;
  }
  const color = status === "online" ? "#22c55e" : status === "warming" ? "#f59e0b" : "#ef4444";
  return <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />;
}

function getAgentStatus(agent: Agent, status: AgentStatus): ServiceStatus {
  if (status.anthropic === "checking") return "checking";
  if (status.anthropic === "offline") return "offline";
  if (agent.requiresFinanceApi && status.finance_api !== "online") return status.finance_api;
  return "online";
}

function AgentDetailPanel({ agent, agentStatus }: { agent: Agent; agentStatus: ServiceStatus }) {
  return (
    <div
      className="rounded-xl p-3 space-y-2.5 mt-2"
      style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${agent.color}30` }}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-bold text-white">{agent.name}</p>
            {agent.isOrchestrator && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{ background: agent.color + "25", color: agent.color }}>
                Orchestrator
              </span>
            )}
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: agent.color }}>{agent.role}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusDot status={agentStatus} />
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
            {agent.modelLabel}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {agent.description}
      </p>

      {/* Tasks */}
      <div>
        <p className="text-[10px] font-semibold text-white mb-1">Aufgaben</p>
        <ul className="space-y-0.5">
          {agent.tasks.map((task, i) => (
            <li key={i} className="text-[11px] flex gap-1.5" style={{ color: "var(--muted)" }}>
              <span style={{ color: agent.color }}>›</span>
              {task}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AgentTile({
  agent,
  agentStatus,
  selected,
  onClick,
}: {
  agent: Agent;
  agentStatus: ServiceStatus;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all flex-1 min-w-0"
      style={{
        background: selected ? agent.color + "18" : "transparent",
        border: `1.5px solid ${selected ? agent.color : "transparent"}`,
      }}>
      <div className="relative">
        <AgentAvatar agent={agent.avatarId} size="md" />
        <span
          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
          style={{
            background: agentStatus === "online" ? "#22c55e" : agentStatus === "checking" || agentStatus === "warming" ? "#f59e0b" : "#ef4444",
            border: "1.5px solid var(--card)",
          }}
        />
      </div>
      <p className="text-[10px] font-semibold text-white leading-tight text-center truncate w-full">
        {agent.name}
      </p>
      <p className="text-[9px] leading-tight text-center line-clamp-2 w-full" style={{ color: "var(--muted)" }}>
        {agent.role}
      </p>
    </button>
  );
}

function CategorySection({
  category,
  status,
}: {
  category: Category;
  status: AgentStatus;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedAgent = category.agents.find(a => a.id === selectedId) ?? null;

  function handleTile(agentId: string) {
    setSelectedId(prev => (prev === agentId ? null : agentId));
  }

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      {/* Category header */}
      <div
        className="px-4 py-3 flex items-center gap-3"
        style={{ borderBottom: `1px solid ${category.color}20`, background: category.color + "0a" }}>
        <div className="w-0.5 h-8 rounded-full flex-shrink-0" style={{ background: category.color }} />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-sm leading-tight">{category.title}</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>{category.subtitle}</p>
        </div>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: category.color + "20", color: category.color }}>
          {category.agents.length}
        </span>
      </div>

      {/* Agent tiles */}
      <div className="p-3">
        <div className="flex gap-1">
          {category.agents.map(agent => (
            <AgentTile
              key={agent.id}
              agent={agent}
              agentStatus={getAgentStatus(agent, status)}
              selected={selectedId === agent.id}
              onClick={() => handleTile(agent.id)}
            />
          ))}
        </div>

        {/* Detail panel */}
        {selectedAgent && (
          <AgentDetailPanel
            agent={selectedAgent}
            agentStatus={getAgentStatus(selectedAgent, status)}
          />
        )}
      </div>
    </div>
  );
}

function statusLabel(s: ServiceStatus): string {
  if (s === "checking") return "Prüfe…";
  if (s === "online") return "Online";
  if (s === "warming") return "Aufwärmt sich…";
  return "Offline";
}

export function TeamView() {
  const [status, setStatus] = useState<AgentStatus>({
    anthropic: "checking",
    finance_api: "checking",
  });

  useEffect(() => {
    function check() {
      fetch("/api/team/status")
        .then(r => r.json())
        .then(data => setStatus({ anthropic: data.anthropic, finance_api: data.finance_api }))
        .catch(() => setStatus({ anthropic: "offline", finance_api: "offline" }));
    }
    check();
  }, []);

  // Auto-retry every 20 s while Finance API is warming up
  useEffect(() => {
    if (status.finance_api !== "warming") return;
    const id = setTimeout(() => {
      fetch("/api/team/status")
        .then(r => r.json())
        .then(data => setStatus({ anthropic: data.anthropic, finance_api: data.finance_api }))
        .catch(() => {});
    }, 20_000);
    return () => clearTimeout(id);
  }, [status.finance_api]);

  const allOnline = status.anthropic === "online" && status.finance_api === "online";
  const warming = status.finance_api === "warming";
  const checking = status.anthropic === "checking" || status.finance_api === "checking";

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">KI-Team</h2>

      {/* System Status */}
      <div
        className="rounded-2xl border p-4"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--muted)" }}>
          System-Status
        </p>
        <div className="space-y-2">
          {[
            { label: "Anthropic API", key: "anthropic" as const },
            { label: "Finance API (Render)", key: "finance_api" as const },
          ].map(({ label, key }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm text-white">{label}</span>
              <div className="flex items-center gap-2">
                <StatusDot status={status[key]} />
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {statusLabel(status[key])}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div
          className="mt-3 rounded-xl px-3 py-2 text-xs font-medium flex items-center gap-2"
          style={{
            background: checking ? "rgba(202,138,4,0.1)" : allOnline ? "rgba(34,197,94,0.1)" : warming ? "rgba(245,158,11,0.1)" : "rgba(239,68,68,0.1)",
            color: checking ? "#ca8a04" : allOnline ? "#22c55e" : warming ? "#f59e0b" : "#ef4444",
          }}>
          <StatusDot status={checking ? "checking" : allOnline ? "online" : warming ? "warming" : "offline"} />
          {checking ? "Systeme werden geprüft…" : allOnline ? "Alle KI-Mitarbeiter einsatzbereit" : warming ? "Finance API startet — wird automatisch neu geprüft…" : "Ein oder mehrere Systeme nicht erreichbar"}
        </div>
      </div>

      {/* Trefferquote */}
      <AccuracyCard />

      {/* Categories */}
      {CATEGORIES.map(cat => (
        <CategorySection key={cat.id} category={cat} status={status} />
      ))}

      <p className="text-xs text-center pb-2" style={{ color: "var(--muted)" }}>
        Alle Analysen dienen ausschließlich zu Research-Zwecken.
      </p>
    </div>
  );
}
