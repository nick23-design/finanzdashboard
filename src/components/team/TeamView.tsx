"use client";

import { useEffect, useState } from "react";

interface AgentStatus {
  anthropic: "online" | "offline" | "checking";
  finance_api: "online" | "offline" | "checking";
}

interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  modelLabel: string;
  color: string;
  initials: string;
  description: string;
  tasks: string[];
  requiresFinanceApi: boolean;
}

const AGENTS: Agent[] = [
  {
    id: "oscar",
    name: "Oscar",
    role: "Leitender Investment-Stratege",
    model: "claude-opus-4-7",
    modelLabel: "Claude Opus 4.7",
    color: "#f59e0b",
    initials: "O",
    description:
      "Oscar ist der erfahrenste Analyst im Team. Er fasst alle Einzelanalysen zusammen und trifft die finale Investmentempfehlung. Als einziger nutzt er adaptives Denken — er überlegt, bevor er antwortet.",
    tasks: [
      "Finale Kauf/Verkauf-Empfehlung (Kaufen bis Verkaufen)",
      "Überzeugungswert 1–10",
      "Bull-Case und Bear-Case Argumente",
      "Wachstumsausblick",
    ],
    requiresFinanceApi: false,
  },
  {
    id: "felix",
    name: "Felix",
    role: "Fundamental-Analyst",
    model: "claude-haiku-4-5",
    modelLabel: "Claude Haiku 4.5",
    color: "#3b82f6",
    initials: "F",
    description:
      "Felix analysiert die Finanzkennzahlen einer Aktie. Er liest Geschäftsberichte aus der SEC EDGAR-Datenbank und bewertet ob ein Unternehmen fundamental gesund ist.",
    tasks: [
      "KGV, Free Cashflow, Verschuldungsgrad",
      "Umsatzwachstum und Profitabilität",
      "SEC EDGAR Quartalsdaten (Umsatz, Gewinn)",
      "Wachstumsbewertung 1–10",
    ],
    requiresFinanceApi: true,
  },
  {
    id: "nina",
    name: "Nina",
    role: "Sentiment-Analystin",
    model: "claude-haiku-4-5",
    modelLabel: "Claude Haiku 4.5",
    color: "#8b5cf6",
    initials: "N",
    description:
      "Nina liest täglich aktuelle Schlagzeilen aus Google News und bewertet die Nachrichtenstimmung rund um eine Aktie. Sie erkennt ob die Marktstimmung positiv, neutral oder negativ ist.",
    tasks: [
      "Google News RSS-Feed Analyse",
      "Stimmungsbewertung (bullish/neutral/bearish)",
      "Wichtigste Nachrichtenthemen",
      "Zusammenfassung der Nachrichtenlage",
    ],
    requiresFinanceApi: true,
  },
  {
    id: "marco",
    name: "Marco",
    role: "Markt-Intelligence-Spezialist",
    model: "claude-haiku-4-5",
    modelLabel: "Claude Haiku 4.5",
    color: "#f97316",
    initials: "M",
    description:
      "Marco beobachtet was kluge Geldgeber tun — nicht was sie sagen. Er analysiert Insider-Transaktionen aus SEC Form 4-Meldungen, institutionelle Positionen und Google Trends-Daten.",
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
    name: "Vera",
    role: "Fakten-Prüferin",
    model: "claude-haiku-4-5",
    modelLabel: "Claude Haiku 4.5",
    color: "#ef4444",
    initials: "V",
    description:
      "Vera ist die letzte Instanz vor der Ausgabe. Sie prüft Oscars Analyse kritisch gegen die verfügbaren Rohdaten — und korrigiert Aussagen die nicht durch echte Daten belegt sind.",
    tasks: [
      "Kreuzprüfung gegen Analysten-Kursziele",
      "Prüfung auf nicht belegte Behauptungen",
      "Anpassung des Überzeugungswerts bei Fehlern",
      "Halluzinationsprävention",
    ],
    requiresFinanceApi: true,
  },
  {
    id: "finn",
    name: "Finn",
    role: "Entdeckungs-Agent",
    model: "claude-haiku-4-5",
    modelLabel: "Claude Haiku 4.5",
    color: "#10b981",
    initials: "F",
    description:
      "Finn scannt täglich Yahoo Finance Trending Tickers und kombiniert sie mit den Watchlist-Aktien des Nutzers. Er bewertet alle Kandidaten anhand ihrer Analyse-Scores und kürt täglich den Hot Pick — die vielversprechendste Aktie des Tages.",
    tasks: [
      "Yahoo Finance Trending Tickers auswerten",
      "Score-basierte Kandidatenauswahl",
      "Tagesaktueller Hot Pick mit Begründung",
      "Entdeckung außerhalb der eigenen Watchlist",
    ],
    requiresFinanceApi: true,
  },
  {
    id: "lena",
    name: "Lena",
    role: "News-Kuratorin",
    model: "claude-haiku-4-5",
    modelLabel: "Claude Haiku 4.5",
    color: "#06b6d4",
    initials: "L",
    description:
      "Lena kuratiert täglich den Nachrichten-Feed. Sie liest alle Schlagzeilen deiner Watchlist-Aktien, bewertet ihre Bedeutung für Investoren und übersetzt sie automatisch ins Deutsche.",
    tasks: [
      "Relevanz-Klassifizierung (Wichtig / Mittel / Gering)",
      "Automatische Übersetzung ins Deutsche",
      "Sortierung nach Investoren-Relevanz",
      "Batch-Verarbeitung aller Watchlist-News",
    ],
    requiresFinanceApi: true,
  },
];

function AgentAvatar({ agent }: { agent: Agent }) {
  return (
    <div
      className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
      style={{ background: agent.color + "22", border: `2px solid ${agent.color}`, color: agent.color }}>
      {agent.initials}
    </div>
  );
}

function StatusDot({ status }: { status: "online" | "offline" | "checking" }) {
  if (status === "checking") {
    return (
      <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "#ca8a04" }} />
    );
  }
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ background: status === "online" ? "#22c55e" : "#ef4444" }}
    />
  );
}

function getAgentStatus(
  agent: Agent,
  status: AgentStatus,
): "online" | "offline" | "checking" {
  if (status.anthropic === "checking") return "checking";
  if (status.anthropic === "offline") return "offline";
  if (agent.requiresFinanceApi && status.finance_api === "offline") return "offline";
  return "online";
}

export function TeamView() {
  const [status, setStatus] = useState<AgentStatus>({
    anthropic: "checking",
    finance_api: "checking",
  });

  useEffect(() => {
    fetch("/api/team/status")
      .then(r => r.json())
      .then(data =>
        setStatus({
          anthropic: data.anthropic,
          finance_api: data.finance_api,
        })
      )
      .catch(() =>
        setStatus({ anthropic: "offline", finance_api: "offline" })
      );
  }, []);

  const allOnline =
    status.anthropic === "online" && status.finance_api === "online";
  const checking =
    status.anthropic === "checking" || status.finance_api === "checking";

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">KI-Team</h2>

      {/* System Status */}
      <div
        className="rounded-2xl border p-4"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--muted)" }}>
          System-Status
        </p>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white">Anthropic API</span>
            <div className="flex items-center gap-2">
              <StatusDot status={status.anthropic} />
              <span className="text-xs capitalize" style={{ color: "var(--muted)" }}>
                {status.anthropic === "checking" ? "Prüfe…" : status.anthropic === "online" ? "Online" : "Offline"}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-white">Finance API (Render)</span>
            <div className="flex items-center gap-2">
              <StatusDot status={status.finance_api} />
              <span className="text-xs capitalize" style={{ color: "var(--muted)" }}>
                {status.finance_api === "checking" ? "Prüfe…" : status.finance_api === "online" ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </div>

        <div
          className="mt-3 rounded-xl px-3 py-2 text-xs font-medium flex items-center gap-2"
          style={{
            background: checking
              ? "rgba(202,138,4,0.1)"
              : allOnline
              ? "rgba(34,197,94,0.1)"
              : "rgba(239,68,68,0.1)",
            color: checking ? "#ca8a04" : allOnline ? "#22c55e" : "#ef4444",
          }}>
          <StatusDot status={checking ? "checking" : allOnline ? "online" : "offline"} />
          {checking
            ? "Systeme werden geprüft…"
            : allOnline
            ? "Alle KI-Mitarbeiter einsatzbereit"
            : "Ein oder mehrere Systeme nicht erreichbar"}
        </div>
      </div>

      {/* Agent Cards */}
      {AGENTS.map(agent => {
        const agentStatus = getAgentStatus(agent, status);
        return (
          <div
            key={agent.id}
            className="rounded-2xl border p-4 space-y-3"
            style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
            {/* Header */}
            <div className="flex items-start gap-3">
              <AgentAvatar agent={agent} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-white">{agent.name}</h3>
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={agentStatus} />
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {agentStatus === "checking" ? "Prüfe…" : agentStatus === "online" ? "Online" : "Offline"}
                    </span>
                  </div>
                </div>
                <p className="text-xs mt-0.5 font-medium" style={{ color: agent.color }}>
                  {agent.role}
                </p>
                <span
                  className="inline-block text-xs px-2 py-0.5 rounded-full mt-1 font-medium"
                  style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
                  {agent.modelLabel}
                </span>
              </div>
            </div>

            {/* Description */}
            <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              {agent.description}
            </p>

            {/* Tasks */}
            <div>
              <p className="text-xs font-semibold text-white mb-1.5">Aufgaben</p>
              <ul className="space-y-1">
                {agent.tasks.map((task, i) => (
                  <li key={i} className="text-xs flex gap-1.5" style={{ color: "var(--muted)" }}>
                    <span style={{ color: agent.color }}>›</span>
                    {task}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}

      <p className="text-xs text-center pb-2" style={{ color: "var(--muted)" }}>
        Alle Analysen dienen ausschließlich zu Research-Zwecken.
      </p>
    </div>
  );
}
