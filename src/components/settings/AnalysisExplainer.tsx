"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ArrowRight, Calculator, Bot, ShieldCheck, Eye } from "lucide-react";
import { AgentAvatar, type AgentId } from "@/components/ui/AgentAvatar";

/**
 * Nutzerorientierte Kurzbeschreibung der KI-Aktienanalyse auf der „Mehr"-Seite.
 * Bewusst kompakt — die vollständige technische Doku liegt unter /dashboard/agents.
 */

// ── Stufe 1: deterministische Bewertungs-Engine (reine Finanzmathematik) ──────
const QUANT_STEPS: { title: string; desc: string }[] = [
  { title: "Unternehmenstyp-Erkennung", desc: "Jede Aktie wird einem Typ und Sektor-Template zugeordnet — das steuert, welche Bewertungsmethode passt." },
  { title: "DCF-Bewertung in Szenarien", desc: "Discounted-Cashflow mit sektorspezifischen Annahmen (WACC, Terminal Growth, Margen) als Bear-/Base-/Bull-Fall." },
  { title: "Reverse-DCF", desc: "Rechnet zurück, welches Wachstum der aktuelle Kurs bereits einpreist — ein Plausibilitätscheck." },
  { title: "Alpha-Faktor-Modell", desc: "Bündelt Qualität, Burggraben (Moat), Kapitalallokation, relative Bewertung, Schätzungs-Revisionen, Momentum und Risiko zu einem Alpha-Score." },
  { title: "Spezialmodelle je Branche", desc: "Eigene Modelle für REITs (AFFO/NAV), Banken, Halbleiter-Zyklus, Software (Rule of 40), Plattformen (SOTP), Rohstoff/Energie u. a." },
  { title: "Divergenz-Analyse", desc: "Vergleicht das eigene Modell mit dem Analystenkonsens und macht die Differenz sichtbar." },
];

// ── Stufe 2: KI-Agenten-Pipeline ──────────────────────────────────────────────
interface PipelineStep {
  agent: AgentId;
  role: string;
  what: string;
}

const PIPELINE: PipelineStep[] = [
  { agent: "diana", role: "Datenqualität", what: "Prüft regelbasiert, wie vollständig die Rohdaten sind, und begrenzt die Überzeugung bei Lücken." },
  { agent: "felix", role: "Fundamental", what: "Bewertet Wachstum, Profitabilität und Bewertung — inklusive Vergleich mit Branchen-Peers." },
  { agent: "nina",  role: "Nachrichten", what: "Liest aktuelle Schlagzeilen und bestimmt Stimmung und Kernthemen." },
  { agent: "marco", role: "Markt-Signale", what: "Wertet Insider-Käufe, institutionelle Bewegungen und Suchtrends aus (v. a. US-Aktien)." },
  { agent: "opus",  role: "Synthese", what: "Führt Engine-Ergebnisse, Agenten-Bausteine und News zu Empfehlung, Überzeugung und Kurszielen zusammen." },
  { agent: "vera",  role: "Fakten-Check", what: "Prüft die fertige Analyse gegen Live-Marktdaten, korrigiert Fehler und speist Erkenntnisse als künftige Guardrails zurück." },
];

// ── Was der Nutzer im Ergebnis sieht ──────────────────────────────────────────
const FEATURES: { title: string; desc: string }[] = [
  { title: "Empfehlung & Überzeugung", desc: "Kaufen bis Verkaufen, plus Überzeugungsgrad 1–10." },
  { title: "Bewertungsspanne", desc: "Bear-/Base-/Bull-Szenario aus der DCF-/Modell-Engine — umschaltbar USD/EUR." },
  { title: "Analystenkonsens & Divergenz", desc: "Eigenes Modell gegen den Markt — mit prozentualer Abweichung." },
  { title: "Kursziele", desc: "Einstieg, Kursziel und Stop-Loss als Orientierungsmarken." },
  { title: "Bull- & Bear-Case", desc: "Die stärksten Argumente für und gegen die Aktie." },
  { title: "Fundamental & Markt-Signale", desc: "Rating mit Stärken/Risiken, dazu Insider, Institutionen und Trends." },
  { title: "Nachrichtenstimmung", desc: "Positiv / neutral / negativ mit den wichtigsten Themen." },
  { title: "Fakten-Check & Score-Verlauf", desc: "Vera-Status und die Entwicklung früherer Analysen." },
];

function SectionHeader({ Icon, color, label }: { Icon: typeof Calculator; color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={12} style={{ color }} />
      <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color }}>{label}</p>
    </div>
  );
}

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
            Quantitative Bewertungs-Engine, KI-Agenten und automatische Guardrails
          </p>
        </div>
        {open
          ? <ChevronUp size={16} style={{ color: "var(--muted)" }} className="flex-shrink-0" />
          : <ChevronDown size={16} style={{ color: "var(--muted)" }} className="flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t px-4 pb-4 pt-3 space-y-5" style={{ borderColor: "var(--card-border)" }}>

          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Eine Analyse kombiniert drei Ebenen: zuerst eine <span className="text-white font-medium">quantitative
            Bewertungs-Engine</span> aus echten Finanzmodellen, dann <span className="text-white font-medium">KI-Agenten</span>,
            die qualitative Bausteine liefern und alles zusammenführen, und am Ende eine
            <span className="text-white font-medium"> regelbasierte Qualitätssicherung</span>, die das Ergebnis prüft und korrigiert.
          </p>

          {/* Stufe 1 — Quantitative Engine */}
          <div className="space-y-2">
            <SectionHeader Icon={Calculator} color="#22c55e" label="1 · Quantitative Bewertung (ohne KI)" />
            <div className="grid gap-1.5">
              {QUANT_STEPS.map(s => (
                <div key={s.title} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: "#22c55e" }} />
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                    <span className="font-semibold text-white">{s.title}</span> — {s.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Stufe 2 — KI-Agenten */}
          <div className="space-y-2">
            <SectionHeader Icon={Bot} color="#a78bfa" label="2 · KI-Agenten-Pipeline" />
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

          {/* Stufe 3 — Guardrails */}
          <div className="space-y-2">
            <SectionHeader Icon={ShieldCheck} color="#f59e0b" label="3 · Guardrails (Qualitätssicherung)" />
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
              Über 40 regelbasierte Guardrails prüfen das KI-Ergebnis in mehreren Phasen — vollständig
              deterministisch, ohne weiteres Modell. Sie verhindern z. B. eine starke Kaufempfehlung ohne
              Modell-Stütze, Scheinpräzision bei breiter Bewertungsspanne oder ein Branchen-fremdes
              Bewertungsmodell, und deckeln die Überzeugung bei dünner Datenlage.
            </p>
          </div>

          {/* Was du siehst */}
          <div className="space-y-2">
            <SectionHeader Icon={Eye} color="#38bdf8" label="Was du im Ergebnis siehst" />
            <div className="grid gap-1.5">
              {FEATURES.map(f => (
                <div key={f.title} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: "#38bdf8" }} />
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
            Hinweis: Die KI-Analyse ist eine Research-Unterstützung, keine Anlageberatung.
            Ergebnisse werden 6 Stunden zwischengespeichert.
          </p>
        </div>
      )}
    </div>
  );
}
