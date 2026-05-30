"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { AgentAvatar, type AgentId } from "@/components/ui/AgentAvatar";

/**
 * Nutzerorientierte Kurzbeschreibung der KI-Aktienanalyse auf der „Mehr"-Seite.
 * Bewusst kompakt — die vollständige technische Doku liegt unter /dashboard/agents.
 */

interface PipelineStep {
  agent: AgentId;
  role: string;
  what: string;
}

// Reihenfolge entspricht der echten Analyse-Pipeline (Schritt 0 → Nachgang).
const PIPELINE: PipelineStep[] = [
  { agent: "diana", role: "Datenqualität", what: "Prüft, wie vollständig die Rohdaten sind, und begrenzt die Überzeugung bei Lücken." },
  { agent: "felix", role: "Fundamental", what: "Bewertet Wachstum, Profitabilität und Bewertung — inklusive Vergleich mit Branchen-Peers." },
  { agent: "nina",  role: "Nachrichten", what: "Liest aktuelle Schlagzeilen und bestimmt Stimmung und Kernthemen." },
  { agent: "marco", role: "Markt-Signale", what: "Wertet Insider-Käufe, institutionelle Bewegungen und Suchtrends aus (v. a. US-Aktien)." },
  { agent: "opus",  role: "Synthese", what: "Fasst alle Signale zu Empfehlung, Überzeugung und Kurszielen zusammen." },
  { agent: "vera",  role: "Fakten-Check", what: "Prüft die fertige Analyse gegen Live-Marktdaten und korrigiert belegbare Fehler." },
];

// Was der Nutzer im Analyse-Ergebnis tatsächlich sieht.
const FEATURES: { title: string; desc: string }[] = [
  { title: "Empfehlung & Überzeugung", desc: "Kaufen bis Verkaufen, plus Überzeugungsgrad 1–10." },
  { title: "Bewertungsspanne", desc: "Bear-/Base-/Bull-Szenario — umschaltbar zwischen USD und EUR." },
  { title: "Kursziele", desc: "Einstieg, Kursziel und Stop-Loss als Orientierungsmarken." },
  { title: "Bull- & Bear-Case", desc: "Die stärksten Argumente für und gegen die Aktie." },
  { title: "Fundamental-Rating", desc: "Bewertung 1–10 mit konkreten Stärken und Risiken." },
  { title: "Nachrichtenstimmung", desc: "Positiv / neutral / negativ mit den wichtigsten Themen." },
  { title: "Markt-Signale", desc: "Insider, Institutionen und Suchtrends auf einen Blick." },
  { title: "Fakten-Check", desc: "Vera-Status zeigt, ob Aussagen gegen Live-Daten geprüft wurden." },
  { title: "Score-Verlauf", desc: "Entwicklung von Empfehlung und Überzeugung über frühere Analysen." },
  { title: "Vergleichbare Unternehmen", desc: "Peers zur schnellen Einordnung der Aktie." },
];

export function AnalysisExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3.5 flex items-center justify-between text-left gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white">So funktioniert die KI-Aktienanalyse</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(139,92,246,0.2)", color: "#a78bfa" }}>
              Beta
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            Sechs spezialisierte KI-Agenten in einer Pipeline
          </p>
        </div>
        {open
          ? <ChevronUp size={16} style={{ color: "var(--muted)" }} className="flex-shrink-0" />
          : <ChevronDown size={16} style={{ color: "var(--muted)" }} className="flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t px-4 pb-4 pt-3 space-y-4" style={{ borderColor: "var(--card-border)" }}>

          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Wenn du auf einer Aktie „KI-Analyse starten“ wählst, durchläuft sie nacheinander
            mehrere Agenten. Jeder steuert einen Baustein bei, den Opus am Ende zu einer
            Gesamtempfehlung zusammenführt und Vera anschließend faktencheckt.
          </p>

          {/* Pipeline */}
          <div className="space-y-2">
            <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Die Pipeline
            </p>
            <div className="space-y-2">
              {PIPELINE.map((step, i) => (
                <div key={step.agent} className="flex items-start gap-3">
                  <div className="flex flex-col items-center flex-shrink-0">
                    <AgentAvatar agent={step.agent} size="sm" />
                    {i < PIPELINE.length - 1 && (
                      <span className="w-px flex-1 mt-1" style={{ background: "var(--card-border)", minHeight: 8 }} />
                    )}
                  </div>
                  <div className="min-w-0 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-white capitalize">{step.agent}</span>
                      <span className="text-[10px]" style={{ color: "var(--muted)" }}>· {step.role}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: "var(--muted)" }}>
                      {step.what}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Was die Analyse zeigt */}
          <div className="space-y-2">
            <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Was die Analyse dir zeigt
            </p>
            <div className="grid gap-1.5">
              {FEATURES.map(f => (
                <div key={f.title} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: "var(--primary)" }} />
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                    <span className="font-semibold text-white">{f.title}</span> — {f.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <Link
            href="/dashboard/agents"
            className="flex items-center justify-between rounded-xl px-3 py-2.5"
            style={{ background: "var(--card-border)" }}>
            <span className="text-xs font-medium text-white">Technische Details zu allen Agenten</span>
            <ArrowRight size={14} style={{ color: "var(--primary)" }} />
          </Link>

          <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Hinweis: Die KI-Analyse ist eine research-Unterstützung, keine Anlageberatung.
            Ergebnisse werden 6 Stunden zwischengespeichert.
          </p>
        </div>
      )}
    </div>
  );
}
