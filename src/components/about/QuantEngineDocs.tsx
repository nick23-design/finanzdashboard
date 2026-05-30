"use client";

import { useState } from "react";
import {
  ChevronDown, ChevronUp, Database, CheckCircle, AlertTriangle,
  Route, Calculator, RotateCcw, Layers, Building2, GitCompareArrows, ShieldCheck,
  type LucideIcon,
} from "lucide-react";

/**
 * Technische Doku der deterministischen Bewertungs-Engine + Guardrails.
 * Ergänzt die KI-Agenten-Doku (AgentsView) um die Bausteine ohne LLM.
 */

interface EngineModule {
  id: string;
  name: string;
  category: string;
  color: string;
  Icon: LucideIcon;
  tagline: string;
  inputs: string[];
  outputs: string[];
  method: string[];
  strengths: string[];
  limitations: string[];
}

const ENGINE_MODULES: EngineModule[] = [
  {
    id: "router",
    name: "Unternehmenstyp-Router & Modellauswahl",
    category: "Klassifizierung",
    color: "#06b6d4",
    Icon: Route,
    tagline: "Ordnet jede Aktie einem Sektor-Template und Aktientyp zu und wählt daraus die passenden Bewertungsmodelle.",
    inputs: [
      "Asset-Snapshot (Sektor, Branche, Kennzahlen)",
      "Faktor-Scores aus dem Alpha-Modell (Qualität, Moat, Bewertung, Risiko, Revisionen)",
    ],
    outputs: [
      "Company-Type-Klassifizierung",
      "Aktientyp: quality_compounder, growth, value, deep_value, cyclical, turnaround, speculative, income, momentum, distressed (primär + sekundär, Konfidenz 1–5)",
      "Modell-Plan: primäre / sekundäre / diagnostische / Kontext-Modelle",
    ],
    method: [
      "14 Sektor-Templates (mega_cap_cloud_software, semiconductor, bank, reit, energy, …) liefern Default-Annahmen",
      "Stock-Classifier leitet den Aktientyp aus Faktor-Scores + Snapshot ab",
      "Model-Registry (~30 Modelle) bewertet die Eignung jedes Modells je Company-Type (good / partial / poor)",
      "Model-Selector erstellt daraus den Ausführungsplan mit Begründung und fehlenden Inputs",
    ],
    strengths: [
      "Passende Methode statt One-size-fits-all-DCF",
      "Transparente Begründung, warum ein Modell läuft oder nicht",
      "Erkennt früh, welche Daten für ein Modell fehlen",
    ],
    limitations: [
      "Klassifizierung ist heuristisch — Mischkonzerne können fehlerhaft geroutet werden",
      "Aktientyp hängt von der Qualität der Faktor-Scores ab",
    ],
  },
  {
    id: "dcf",
    name: "DCF-Bewertung (FCFF, Szenarien)",
    category: "Bewertung",
    color: "#22c55e",
    Icon: Calculator,
    tagline: "Discounted-Cashflow auf Free Cashflow to Firm — als Bear-, Base- und Bull-Szenario.",
    inputs: [
      "Umsatzbasis aus EDGAR-Quartalszahlen (oder aus Free Cashflow geschätzt, wenn EDGAR fehlt)",
      "Wachstumsraten, operative Margen, Steuersatz, Reinvestitionsquote",
      "WACC & Terminal Growth aus dem Sektor-Template",
      "Net Debt, Aktienanzahl",
    ],
    outputs: [
      "Enterprise Value & fairer Wert je Aktie",
      "Jahres-Forecasts (Umsatz, NOPAT, Free Cashflow, Barwert)",
      "Bear / Base / Bull als Bewertungsspanne",
    ],
    method: [
      "Sektor-Defaults (WACC 7–13 %, Terminal 1,5–3 %, Margen, Reinvestment) je nach Template",
      "Mehrjähriger Forecast wird auf den Barwert diskontiert + Terminal Value",
      "Drei Szenarien variieren Wachstum/Margen für die Spanne",
      "Reine Mathematik — keine LLM-Calls",
    ],
    strengths: [
      "Deterministisch und vollständig nachvollziehbar",
      "Sektorkalibrierte Annahmen statt pauschaler Werte",
      "Szenarien machen die Bandbreite der Bewertung sichtbar",
    ],
    limitations: [
      "Stark sensibel auf Annahmen (WACC, Terminal, Margen)",
      "Bei fehlendem EDGAR wird die Umsatzbasis aus dem FCF geschätzt — gröber",
      "Für Banken, Versicherer und REITs ungeeignet → dafür gibt es Spezialmodelle",
    ],
  },
  {
    id: "reverse-dcf",
    name: "Reverse-DCF",
    category: "Bewertung",
    color: "#22c55e",
    Icon: RotateCcw,
    tagline: "Rechnet zurück, welches Wachstum der aktuelle Kurs bereits einpreist.",
    inputs: [
      "Aktueller Kurs / Marktkapitalisierung",
      "Dieselbe DCF-Basis (Margen, WACC, Terminal, Net Debt)",
    ],
    outputs: [
      "Implizite Wachstumsrate, die den Kurs rechtfertigt",
      "Plausibilität: low / medium / high / very_high",
      "Interpretation + Grenzen",
    ],
    method: [
      "Binärsuche über die Wachstumsrate (Suchraum −20 % bis +80 %)",
      "Sucht die Rate, bei der der DCF-Fairvalue dem aktuellen Kurs entspricht",
      "Bewertet die gefundene Rate auf Realismus",
    ],
    strengths: [
      "Macht die im Kurs eingepreiste Markterwartung explizit",
      "Starker Plausibilitätscheck gegen zu optimistische DCFs",
    ],
    limitations: [
      "Erbt die Annahmen-Sensitivität des DCF",
      "Implizite Rate ist eine Vereinfachung (flaches Wachstum)",
    ],
  },
  {
    id: "alpha",
    name: "Alpha-Faktor-Modell",
    category: "Faktoren",
    color: "#6366f1",
    Icon: Layers,
    tagline: "Bündelt sieben Faktor-Scores zu einem Alpha-Score mit aktientyp-abhängigen Gewichten.",
    inputs: [
      "Asset-Snapshot, EDGAR-Facts, Analystendaten",
      "Sektor-Template + Datenqualität",
    ],
    outputs: [
      "Qualität, Burggraben/Moat (none → exceptional), Kapitalallokation, relative Bewertung, Revisions-Momentum, Preis-Momentum, Risiko (0–100 mit Komponenten Bewertung/Bilanz/Geschäft/Zyklik/Datenqualität)",
      "Alpha-Score + Grade (very_unattractive → very_attractive)",
      "Key Positive / Negative Drivers, Unsicherheits-Flags",
    ],
    method: [
      "Jeder Faktor wird deterministisch aus Kennzahlen berechnet (0–100)",
      "Gewichte richten sich nach dem Aktientyp (z. B. Qualität höher bei Compoundern, Bewertung höher bei Value)",
      "Aggregation zu einem Alpha-Score; Treiber werden extrahiert",
    ],
    strengths: [
      "Balanciertes Multi-Faktor-Bild statt einer einzelnen Kennzahl",
      "Dynamische Gewichte passen sich dem Charakter der Aktie an",
      "Liefert benannte Treiber statt nur Zahlen",
    ],
    limitations: [
      "Scores stammen aus begrenzten Snapshot-Daten",
      "Moat & Qualität sind Proxys aus Finanzstabilität, keine Geschäftsanalyse",
    ],
  },
  {
    id: "specialized",
    name: "Spezialmodelle je Branche",
    category: "Bewertung",
    color: "#22c55e",
    Icon: Building2,
    tagline: "Eigene Bewertungsmethoden, wenn ein FCFF-DCF dem Geschäftsmodell nicht gerecht wird.",
    inputs: [
      "Company-Type aus dem Router",
      "Branchenspezifische Kennzahlen (sofern verfügbar)",
    ],
    outputs: [
      "Implementiert: REIT (AFFO/NAV), Bank-Bewertung, Commodity/Energie-Midcycle, Plattform-SOTP, zyklische Hardware (normalisiert), Halbleiter-Zyklus, Software (Rule of 40), KI-Exposure-Score",
      "Registriert/geplant: Versicherung, Healthcare/Pharma, Utilities, Telecom u. a. (~30 Modelle insgesamt)",
    ],
    method: [
      "Der Modell-Plan aktiviert die zum Company-Type passenden Modelle",
      "Jedes Modell nutzt die methodisch korrekte Logik (z. B. AFFO/NAV statt FCFF für REITs)",
      "Ergebnisse fließen als zusätzlicher Bewertungskontext in die Synthese",
    ],
    strengths: [
      "Methodisch korrekt je Geschäftsmodell statt erzwungenem DCF",
      "Deckt Sektoren ab, für die Standard-DCF systematisch falsch liegt",
    ],
    limitations: [
      "Nicht alle Registry-Modelle sind bereits implementiert",
      "Brauchen oft Detaildaten (Segmente, Schätzungen), die nicht immer vorliegen",
    ],
  },
  {
    id: "divergence",
    name: "Divergenz & Plausibilität",
    category: "Abgleich",
    color: "#f59e0b",
    Icon: GitCompareArrows,
    tagline: "Stellt das eigene Modell dem Analystenkonsens gegenüber und prüft die Bewertung auf Plausibilität.",
    inputs: [
      "Eigene Bewertungsspanne (DCF/Spezialmodell)",
      "Analystenkonsens (Kursziel-Spanne, Buy/Hold/Sell)",
      "Aktueller Kurs",
    ],
    outputs: [
      "Divergenz-Status + prozentuale Abweichung (Base-Case vs. Konsens/Kurs)",
      "Upside Konsens vs. eigenes Modell",
      "Plausibilitäts-Einordnung mit Begründung",
    ],
    method: [
      "Vergleicht Base-Case-Fairvalue mit Konsens und Kurs",
      "Stuft die Abweichung ein (moderat … extrem) und fordert bei extremen Werten eine Erklärung",
      "Plausibilitätsmodul prüft DCF/Reverse-DCF auf Konsistenz",
    ],
    strengths: [
      "Macht Über-/Unterbewertung relativ zum Markt sichtbar",
      "Verhindert, dass eine einzelne Quelle die Bewertung dominiert",
    ],
    limitations: [
      "Analystenkonsens ist nicht für jede Aktie verfügbar",
      "Große Divergenzen brauchen qualitative Interpretation",
    ],
  },
];

const GUARDRAIL_PHASES: { phase: string; desc: string }[] = [
  { phase: "Phase 1 · Datenintegrität (G1–G6)", desc: "Analysten-Claims ohne Konsens, unverifizierte News-Kursziele, Konsens/Modell-Vermischung, schwache Datenbasis." },
  { phase: "Phase 2 · Research-Qualität (G7–G16)", desc: "Keine starke Empfehlung ohne Modell-Stütze, keine Scheinpräzision bei breiter Spanne, unklare Quelle für Zahlen, Empfehlung-/Conviction-Konsistenz." },
  { phase: "Phase 3 · Bewertung & Divergenz (V1–V14)", desc: "Fehlender Kurs, ungültige Szenario-Reihenfolge, konservatives Modell, extreme Divergenz, fehlende Bewertungsquellen." },
  { phase: "Phase 3.25 · Modell-Fit je Typ (C1–C5)", desc: "Quality-Compounder nicht automatisch verkaufen, Plattform-SOTP-Fit, zyklische Hardware/optimistischer DCF, Banken/REIT vs. generischer DCF." },
  { phase: "Phase 4 · Datenqualität (D3–D12)", desc: "Fehlende EDGAR-Daten deckeln Wachstums-Claims, fehlende Insider-Daten, veraltete Felder, Datenlücken als Anbieter-Limitierung kennzeichnen." },
];

function ListBlock({ Icon, color, label, items }: { Icon: LucideIcon; color: string; label: string; items: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={10} style={{ color }} />
        <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color }}>{label}</p>
      </div>
      <div className="space-y-1">
        {items.map((it, i) => (
          <p key={i} className="text-[10px] leading-relaxed flex gap-1" style={{ color: "var(--muted)" }}>
            <span style={{ color }}>·</span>{it}
          </p>
        ))}
      </div>
    </div>
  );
}

function EngineModuleCard({ mod }: { mod: EngineModule }) {
  const [open, setOpen] = useState(false);
  const { Icon } = mod;

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      <button onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3.5 flex items-center justify-between text-left gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
            style={{ background: mod.color + "20", border: `1.5px solid ${mod.color}` }}>
            <Icon size={16} style={{ color: mod.color }} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-white">{mod.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ background: mod.color + "22", color: mod.color }}>
                {mod.category}
              </span>
            </div>
            <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: "var(--muted)" }}>{mod.tagline}</p>
          </div>
        </div>
        {open
          ? <ChevronUp size={15} style={{ color: "var(--muted)" }} className="flex-shrink-0" />
          : <ChevronDown size={15} style={{ color: "var(--muted)" }} className="flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t space-y-4 px-4 pb-4 pt-3" style={{ borderColor: "var(--card-border)" }}>
          <div className="grid grid-cols-2 gap-2">
            <ListBlock Icon={Database} color="#818cf8" label="Eingabe" items={mod.inputs} />
            <ListBlock Icon={Database} color="#22c55e" label="Ausgabe" items={mod.outputs} />
          </div>

          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>Methodik</p>
            <div className="space-y-1">
              {mod.method.map((step, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-[9px] font-bold w-3.5 flex-shrink-0 mt-0.5" style={{ color: mod.color }}>{i + 1}.</span>
                  <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>{step}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
              <ListBlock Icon={CheckCircle} color="#22c55e" label="Stärken" items={mod.strengths} />
            </div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
              <ListBlock Icon={AlertTriangle} color="#f87171" label="Grenzen" items={mod.limitations} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GuardrailCard() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3.5 flex items-center justify-between text-left gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
            style={{ background: "#f59e0b20", border: "1.5px solid #f59e0b" }}>
            <ShieldCheck size={16} style={{ color: "#f59e0b" }} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-white">Guardrail-Engine</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ background: "#f59e0b22", color: "#f59e0b" }}>
                Regelbasiert
              </span>
            </div>
            <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: "var(--muted)" }}>
              Über 40 deterministische Regeln, die das KI-Ergebnis in mehreren Phasen prüfen und korrigieren.
            </p>
          </div>
        </div>
        {open
          ? <ChevronUp size={15} style={{ color: "var(--muted)" }} className="flex-shrink-0" />
          : <ChevronDown size={15} style={{ color: "var(--muted)" }} className="flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t space-y-4 px-4 pb-4 pt-3" style={{ borderColor: "var(--card-border)" }}>
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Die Guardrails laufen nach der Opus-Synthese — ohne weiteren LLM-Call. Sie patchen bei Bedarf
            Empfehlung, Conviction und Bewertungs-Konfidenz oder ergänzen Hinweise, in fester Reihenfolge mit
            klaren Abhängigkeiten zwischen den Phasen.
          </p>

          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>Phasen</p>
            <div className="space-y-2">
              {GUARDRAIL_PHASES.map(p => (
                <div key={p.phase} className="rounded-xl p-2.5" style={{ background: "var(--card-border)" }}>
                  <p className="text-[11px] font-semibold text-white">{p.phase}</p>
                  <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: "var(--muted)" }}>{p.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
              <ListBlock Icon={CheckCircle} color="#22c55e" label="Stärken" items={[
                "Deterministisch — kein zusätzlicher LLM-Call, keine Latenz, kein Zufall",
                "Fängt typische KI-Fehler systematisch ab (Überkonfidenz, Scheinpräzision, falsches Modell)",
                "Vera-Findings fließen als künftige Guardrails zurück",
              ]} />
            </div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
              <ListBlock Icon={AlertTriangle} color="#f87171" label="Grenzen" items={[
                "Regelbasiert — greift nur bei kodierten Mustern",
                "Kann in Grenzfällen zu konservativ wirken",
                "Reihenfolge-Abhängigkeiten erfordern sorgfältige Pflege",
              ]} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function QuantEngineDocs() {
  return (
    <div className="space-y-5">
      {/* Quantitative Engine */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
          Quantitative Bewertungs-Engine
        </p>
        <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--muted)" }}>
          Deterministische Finanzmodelle ohne LLM. Ihre Ergebnisse fließen als strukturierter Kontext in die Opus-Synthese.
        </p>
        <div className="space-y-2">
          {ENGINE_MODULES.map(mod => <EngineModuleCard key={mod.id} mod={mod} />)}
        </div>
      </div>

      {/* Guardrails */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
          Qualitätssicherung
        </p>
        <GuardrailCard />
      </div>
    </div>
  );
}
