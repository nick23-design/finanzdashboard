"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Zap, Clock, Database, AlertTriangle, CheckCircle } from "lucide-react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import type { AgentId } from "@/components/ui/AgentAvatar";

interface AgentDoc {
  id: AgentId;
  model: string;
  modelColor: string;
  trigger: string;
  cache: string;
  pipeline?: string;
  inputs: string[];
  outputs: string[];
  systemPrompt: string;
  workflow: string[];
  strengths: string[];
  weaknesses: string[];
  reliability: 1 | 2 | 3 | 4 | 5;
  reliabilityNote: string;
}

const AGENTS: AgentDoc[] = [
  {
    id: "lisa",
    model: "Claude Haiku",
    modelColor: "#06b6d4",
    trigger: "On-demand (beim Öffnen der News-Seite)",
    cache: "Keine — wird bei jedem Seitenaufruf neu generiert",
    inputs: [
      "Bis zu 5 Artikel-Titel pro Watchlist-Aktie (max. 8 Aktien)",
      "Quelle: Google News RSS",
    ],
    outputs: [
      "Wichtigkeits-Klassifizierung: hoch / mittel / niedrig",
      "Deutsche Übersetzung des Titels",
    ],
    systemPrompt: `"Du bist eine Finanz-Nachrichtenredakteurin. Antworte ausschließlich mit validem JSON."`,
    workflow: [
      "Google News RSS wird für jede Watchlist-Aktie abgerufen",
      "Bis zu 5 Titel pro Aktie werden gesammelt und nummeriert",
      "Alle Titel werden in einem einzigen API-Call an Haiku übergeben",
      "Haiku klassifiziert nach Relevanz und übersetzt ins Deutsche",
      "Ergebnis wird mit Originaldaten gemerged und sortiert angezeigt",
    ],
    strengths: [
      "Sehr schnell durch Single-Call für alle Artikel gleichzeitig",
      "Konsistente Wichtigkeits-Klassifizierung nach klaren Regeln",
      "Deutsche Übersetzungen qualitativ gut für bekannte Unternehmen",
    ],
    weaknesses: [
      "Liest nur den Titel, nicht den Artikeltext — Kontext fehlt",
      "Klassifizierung kann bei mehrdeutigen Titeln falsch sein",
      "Übersetzungen bei Eigennamen oder Fachjargon manchmal ungenau",
      "Bei sehr vielen Artikeln kann das Token-Limit erreicht werden",
    ],
    reliability: 4,
    reliabilityNote: "Sehr zuverlässig für Klassifizierung und Übersetzung — Hauptrisiko ist die Datenquelle (Google News RSS).",
  },
  {
    id: "felix",
    model: "Claude Haiku",
    modelColor: "#3b82f6",
    trigger: "Teil der Vollanalyse-Pipeline (on-demand)",
    cache: "6 Stunden (als Teil des Gesamtergebnisses)",
    pipeline: "Schritt 1 von 5 der Vollanalyse",
    inputs: [
      "Asset-Snapshot: Preis, KGV, Marktkapitalisierung, Umsatzwachstum, Free Cashflow, Debt/Equity, RSI, MA50, MA200",
      "SEC EDGAR Daten (falls US-Aktie): Quartalsumsätze, Nettogewinn, Bruttogewinn der letzten 6 Quartale",
    ],
    outputs: [
      "Wachstumsbewertung 1–10",
      "Key Positives (Array)",
      "Key Risks (Array)",
      "Bewertungskommentar (Text)",
    ],
    systemPrompt: `"Du bist ein wachstumsorientierter Aktienanalyst. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach."`,
    workflow: [
      "Snapshot-Daten und EDGAR-Quartalszahlen werden als strukturierter Text formatiert",
      "Felix bewertet Wachstum, Profitabilität und Bewertung",
      "Ergebnis fließt als Input in den Synthese-Agenten (Opus)",
    ],
    strengths: [
      "Strukturierte Ausgabe ist gut maschinenlesbar",
      "EDGAR-Daten geben historischen Kontext über mehrere Quartale",
      "Konsistente Bewertungssystematik",
    ],
    weaknesses: [
      "Kein Branchen-Vergleich — Bewertung ist absolut, nicht relativ",
      "EDGAR nur für US-Aktien verfügbar",
      "KGV-Interpretation ohne Wachstumskontext kann irreführen",
    ],
    reliability: 3,
    reliabilityNote: "Gut wenn alle Daten vorhanden. Bei fehlenden Kennzahlen (N/A) sinkt die Aussagekraft.",
  },
  {
    id: "nina",
    model: "Claude Haiku",
    modelColor: "#8b5cf6",
    trigger: "Teil der Vollanalyse-Pipeline (on-demand)",
    cache: "6 Stunden (als Teil des Gesamtergebnisses)",
    pipeline: "Schritt 2 von 5 der Vollanalyse",
    inputs: [
      "Bis zu 10 aktuelle Nachrichten-Schlagzeilen zur Aktie",
      "Quelle: Google News RSS",
    ],
    outputs: [
      "Sentiment: bullish / neutral / bearish",
      "Key Themes (Array)",
      "Sentiment Summary (Text)",
    ],
    systemPrompt: `"Du bist ein Finanz-Nachrichtenanalyst. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach."`,
    workflow: [
      "Google News RSS liefert aktuelle Schlagzeilen zur Aktie",
      "Nina analysiert Tonalität und Themen der Headlines",
      "Ergebnis fließt in den Synthese-Agenten",
    ],
    strengths: [
      "Schnelle Stimmungseinschätzung aus aktuellen News",
      "Themen-Extraktion hilft Hauptnarrative zu erkennen",
    ],
    weaknesses: [
      "Nur Titel-Analyse, kein Artikelinhalt",
      "Sensationelle oder reißerische Titel verzerren das Sentiment",
      "Keine Gewichtung nach Quellenqualität",
    ],
    reliability: 3,
    reliabilityNote: "Brauchbar als Indikator, nicht als Entscheidungsgrundlage. News-Sentiment kann sich täglich stark ändern.",
  },
  {
    id: "marco",
    model: "Claude Haiku",
    modelColor: "#f97316",
    trigger: "Teil der Vollanalyse-Pipeline (on-demand)",
    cache: "6 Stunden (als Teil des Gesamtergebnisses)",
    pipeline: "Schritt 3 von 5 der Vollanalyse",
    inputs: [
      "Insider-Transaktionen: Name, Titel, Kauf/Verkauf, Anzahl, Kurs, Datum (letzte 5)",
      "Institutionelle Daten: Insider-Anteil %, Institutionen-Anteil %, Top-5 Holder",
      "Google Trends: wöchentliche Suchwerte (0–100) der letzten 12 Monate",
    ],
    outputs: [
      "Insider-Signal: bullish / neutral / bearish",
      "Institutioneller Trend: accumulating / stable / reducing",
      "Trends-Momentum: rising / stable / declining",
      "Key Observations (Array)",
    ],
    systemPrompt: `"Du bist ein Marktanalyse-Experte. Bewerte Insider-Aktivität, institutionelle Positionierung und Suchtrends als Investmentsignale. Antworte ausschließlich mit validem JSON."`,
    workflow: [
      "Insider-Trades, institutionelle Daten und Google Trends werden parallel abgerufen",
      "Marco bewertet ob Insider kaufen oder verkaufen und ob Institutionen akkumulieren",
      "Trends-Momentum gibt Hinweis auf wachsendes oder sinkendes öffentliches Interesse",
      "Ergebnis fließt in den Synthese-Agenten",
    ],
    strengths: [
      "Insider-Daten sind eines der stärksten Signale überhaupt",
      "Google Trends gibt frühzeitig Hinweise auf Momentum-Shifts",
      "Institutionelle Positionierung zeigt Smart-Money-Flüsse",
    ],
    weaknesses: [
      "Insider-Daten nur für US-Aktien via SEC verfügbar",
      "Insider-Verkäufe können viele Gründe haben (Steuern, Diversifikation), nicht nur Pessimismus",
      "Google Trends misst öffentliches Interesse, nicht Investoren-Interesse",
    ],
    reliability: 3,
    reliabilityNote: "Starker Zusatz-Kontext, aber für Nicht-US-Aktien oft leer.",
  },
  {
    id: "vera",
    model: "Claude Haiku",
    modelColor: "#ef4444",
    trigger: "Teil der Vollanalyse-Pipeline (on-demand)",
    cache: "6 Stunden (als Teil des Gesamtergebnisses)",
    pipeline: "Schritt 5 von 5 — Fact-Check nach Opus-Synthese",
    inputs: [
      "Draft-Analyse von Opus (Empfehlung, Summary, Bull/Bear-Case, Wachstumsausblick)",
      "Analysten-Konsens (Kursziele, Buy/Hold/Sell-Verteilung)",
      "Aktuelle News-Schlagzeilen (bis zu 10)",
    ],
    outputs: [
      "Korrekturen (Array — leer wenn alles korrekt)",
      "Verifizierte Aussagen (Array)",
      "Conviction-Adjustment: −3 bis 0 (senkt Conviction wenn Fehler gefunden)",
    ],
    systemPrompt: `"Du bist ein kritischer Fact-Checker für Finanzanalysen. Antworte ausschließlich mit validem JSON."`,
    workflow: [
      "Opus liefert die fertige Analyse als Draft",
      "Vera prüft ob genannte Fakten durch Analysten-Daten oder News belegbar sind",
      "Bei nachweislichen Fehlern wird die Conviction gesenkt (max. −3 Punkte)",
      "Endgültige Analyse wird mit angepasster Conviction zurückgegeben",
    ],
    strengths: [
      "Reduziert Halluzinationen in der Opus-Analyse",
      "Transparentes System: Conviction sinkt nachvollziehbar bei Unsicherheiten",
      "Schützt vor erfundenen Firmennamen, Deals oder Zahlen",
    ],
    weaknesses: [
      "Kann nur prüfen was in den bereitgestellten Daten steht — keine externe Recherche",
      "Vera selbst kann Fehler machen bei der Beurteilung",
      "Conviction-Anpassung ist nur eine Näherung, kein präzises Maß",
    ],
    reliability: 4,
    reliabilityNote: "Sehr wirksam als Sicherheitsnetz. Reduziert messbar die Rate falscher konkreter Behauptungen.",
  },
  {
    id: "opus",
    model: "Claude Opus 4.7 + Adaptive Thinking",
    modelColor: "#6366f1",
    trigger: "Teil der Vollanalyse-Pipeline (on-demand, Schritt 4)",
    cache: "6 Stunden",
    pipeline: "Schritt 4 von 5 — Haupt-Synthese",
    inputs: [
      "Alle Snapshot-Kennzahlen (Preis, KGV, FCF, Wachstum, MA, RSI, …)",
      "Felix-Ergebnis: Wachstumsbewertung, Stärken, Risiken, Bewertungskommentar",
      "Nina-Ergebnis: Sentiment, Themen, Summary",
      "Marco-Ergebnis: Insider-Signal, institutioneller Trend, Trends-Momentum",
      "Analysten-Konsens: Kursziel-Spanne, Buy/Hold/Sell-Verteilung",
    ],
    outputs: [
      "Empfehlung: Kaufen / Leicht kaufen / Halten / Leicht verkaufen / Verkaufen",
      "Conviction: 1–10",
      "Summary (2–3 Sätze)",
      "Bull-Case (Array, 3 Punkte)",
      "Bear-Case (Array, 2 Punkte)",
      "Wachstumsausblick (Text)",
      "Kursziele: Entry, Target, Stop-Loss mit Begründung",
    ],
    systemPrompt: `"Du bist ein erfahrener Investment-Analyst spezialisiert auf Wachstumsaktien. Erstelle eine präzise, faktenbasierte Investmentempfehlung auf Deutsch. WICHTIG: Beziehe dich ausschließlich auf die bereitgestellten Daten. Erwähne keine Firmennamen, Deals, Produkte oder Ereignisse, die nicht explizit in den Daten enthalten sind."`,
    workflow: [
      "Erhält aggregierten Kontext aus Felix, Nina, Marco + Rohdaten",
      "Adaptive Thinking: Opus denkt intern (unsichtbar) bevor es antwortet",
      "Synthetisiert alle Signale zu einer konsistenten Gesamtempfehlung",
      "Berechnet konkrete Kursziele basierend auf MA50 und Analysten-Konsens",
      "Ergebnis geht an Vera zum Fact-Check",
    ],
    strengths: [
      "Stärkstes verfügbares Claude-Modell — beste Reasoning-Qualität",
      "Adaptive Thinking aktiviert bei komplexen Abwägungen",
      "Berücksichtigt alle vier Datenquellen (Felix, Nina, Marco, Rohdaten)",
      "Konkrete Kursziele mit Begründung sind praktisch verwertbar",
    ],
    weaknesses: [
      "Teuerster und langsamster Agent in der Pipeline",
      "Kein Internetzugang — kann nur bereitgestellte Daten nutzen",
      "Kursziele sind Modell-Schätzungen, keine professionellen Analystenpreise",
      "Kann bei unvollständigen Daten trotzdem plausibel klingende Antworten geben",
    ],
    reliability: 4,
    reliabilityNote: "Beste Reasoning-Qualität im System. Hauptrisiko: Vertraut zu stark auf Eingangsdaten — Garbage in, garbage out.",
  },
  {
    id: "kai",
    model: "Claude Haiku",
    modelColor: "#6366f1",
    trigger: "On-demand (beim Klick auf 'KI-Analyse' im Vergleich)",
    cache: "Keine — wird bei jedem Aufruf neu generiert",
    inputs: [
      "Snapshot-Daten beider Aktien: Preis, KGV, MarktKap, Wachstum, FCF, D/E, RSI, MAs",
      "NH Analyse-Score beider Aktien (falls vorhanden)",
      "Fallback: Frontend übergibt bereits geladene Daten direkt",
    ],
    outputs: [
      "Gewinner (Symbol oder null bei Gleichstand)",
      "Summary (2–3 Sätze Gesamtbild)",
      "Empfehlung (1 Satz)",
      "Stärken A + B (je 3 Punkte)",
      "Schwächen A + B (je 2 Punkte)",
      "Verdict (1–2 Sätze mit Begründung)",
    ],
    systemPrompt: `"Du bist Kai, ein präziser Aktienvergleichs-Analyst. Antworte ausschließlich mit validem JSON."`,
    workflow: [
      "Snapshot-Daten beider Aktien werden parallel aus Supabase geladen",
      "Falls kein DB-Snapshot vorhanden, nutzt Kai die bereits im Frontend geladenen Daten",
      "Beide Datensätze werden formatiert und in einem einzigen Prompt verglichen",
      "Kai gibt strukturierte Analyse mit klarem Gewinner zurück",
    ],
    strengths: [
      "Schnell durch einfachen Single-Call",
      "Strukturierter Vergleich mit klarem Gewinner leicht interpretierbar",
      "Fallback auf Frontend-Daten macht Kai robust",
    ],
    weaknesses: [
      "Haiku ist das schwächste Modell — weniger differenzierte Analyse als Opus",
      "Kein Branchen-Kontext — vergleicht absolute Zahlen ohne Peer-Benchmarks",
      "Kein Extended Thinking — Abwägungen können oberflächlich sein",
    ],
    reliability: 3,
    reliabilityNote: "Gut für schnelle Orientierung. Für tiefe Vergleiche ist die Vollanalyse beider Aktien via Vera aussagekräftiger.",
  },
  {
    id: "us-scout",
    model: "Claude Haiku",
    modelColor: "#3b82f6",
    trigger: "Täglich automatisch (Cron, Werktage)",
    cache: "Ergebnisse in Datenbank bis zum nächsten Tag",
    pipeline: "Schritt 1a der NH Select Pipeline",
    inputs: [
      "Google News RSS Feed 1: 'stock analyst upgrade buy recommendation'",
      "Google News RSS Feed 2: 'stock earnings beat guidance raised'",
      "Google News RSS Feed 3: 'stock breakout all-time-high momentum'",
      "Je bis zu 8 Artikel-Titel pro Feed",
    ],
    outputs: [
      "2–4 US-Aktien mit Symbol, Name, Empfehlung, Conviction 1–10, Begründung, Quellen",
    ],
    systemPrompt: `"Du bist US-Scout, ein US-Markt Analyst. Analysiere aktuelle US-Finanznachrichten und identifiziere 2-4 vielversprechende US-Aktien mit konkreten Ticker-Symbolen. Antworte ausschließlich als JSON-Array."`,
    workflow: [
      "Drei thematisch unterschiedliche Google News RSS-Feeds werden abgerufen",
      "Alle Titel werden zusammengeführt und nummeriert",
      "US-Scout extrahiert konkrete Ticker-Symbole aus den Nachrichten",
      "Ergebnisse werden in der Datenbank gespeichert für den Synthesizer",
    ],
    strengths: [
      "Breite Abdeckung durch drei verschiedene Themen-Feeds",
      "Sehr schnell — reine Titel-Analyse",
      "Findet aktuelle Momentum-Aktien aus dem Nachrichtenfluss",
    ],
    weaknesses: [
      "Halluziniert manchmal Ticker-Symbole die nicht existieren",
      "Keine Kursvalidierung — empfiehlt auch Aktien nach starkem Anstieg",
      "Nur US-Markt, nur englischsprachige Quellen",
    ],
    reliability: 2,
    reliabilityNote: "Liefert rohe Signale. Zuverlässigkeit steigt stark durch den nachgelagerten Synthesizer-Filter.",
  },
  {
    id: "de-scout",
    model: "Claude Haiku",
    modelColor: "#6ECF97",
    trigger: "Täglich automatisch (Cron, Werktage)",
    cache: "Ergebnisse in Datenbank bis zum nächsten Tag",
    pipeline: "Schritt 1b der NH Select Pipeline",
    inputs: [
      "Google News RSS Feeds mit Fokus auf DAX, deutsche und europäische Aktien",
      "Ähnliche Struktur wie US-Scout: Upgrades, Earnings, Momentum",
    ],
    outputs: [
      "2–4 DE/EU-Aktien mit Symbol, Name, Empfehlung, Conviction, Begründung",
    ],
    systemPrompt: `Analog zu US-Scout, mit Fokus auf deutsche und europäische Märkte.`,
    workflow: [
      "Gleicher Ablauf wie US-Scout, aber mit europäischen Suchbegriffen",
      "Ticker-Symbole für DE-Aktien enthalten oft '.DE'-Suffix (z.B. SAP.DE)",
    ],
    strengths: [
      "Einziger Agent der systematisch DAX/Euro-Stoxx abdeckt",
    ],
    weaknesses: [
      "Europäische Ticker-Symbole schwieriger zu extrahieren als US-Symbole",
      "Weniger Nachrichtenvolumen als US-Markt — manchmal weniger Ergebnisse",
      "Suffix-Varianten (.DE, .PA, .AS) führen manchmal zu falschen Symbolen",
    ],
    reliability: 2,
    reliabilityNote: "Etwas weniger zuverlässig als US-Scout durch komplexere Ticker-Syntax.",
  },
  {
    id: "podcast-scout",
    model: "Claude Haiku",
    modelColor: "#8b5cf6",
    trigger: "Täglich automatisch (Cron, Werktage)",
    cache: "Ergebnisse in Datenbank bis zum nächsten Tag",
    pipeline: "Schritt 1c der NH Select Pipeline",
    inputs: [
      "Inhalte aus Finanz-Podcasts (Titel, Episodenbeschreibungen, Transkript-Ausschnitte)",
      "Fokus auf bekannte Investment-Podcasts",
    ],
    outputs: [
      "Erwähnte Aktien mit Kontext, Conviction und Quellenangabe",
    ],
    systemPrompt: `Analysiert Podcast-Inhalte auf Aktien-Erwähnungen mit Investmentrelevanz.`,
    workflow: [
      "Podcast-Inhalte werden gesammelt und vorverarbeitet",
      "Podcast-Scout extrahiert konkret erwähnte Aktien mit Begründungskontext",
      "Erscheint als eigene Sektion in der News-Ansicht wenn Ergebnisse vorhanden",
    ],
    strengths: [
      "Erfasst Investmentideen aus qualitativen Quellen jenseits von Headlines",
      "Podcasts behandeln oft tiefere Thesen als Tagesnachrichten",
    ],
    weaknesses: [
      "Qualität stark abhängig von Podcast-Verfügbarkeit und -Inhalt",
      "Kann Meinungen als Fakten interpretieren",
    ],
    reliability: 2,
    reliabilityNote: "Ergänzung, kein Hauptsignal. Interessant für qualitative Impulse.",
  },
  {
    id: "synthesizer",
    model: "Claude Opus 4.7 + Extended Thinking",
    modelColor: "#6366f1",
    trigger: "Täglich automatisch (Cron, nach den Scouts)",
    cache: "Tagesaktuelle Empfehlung in Datenbank",
    pipeline: "Abschluss der NH Select Pipeline",
    inputs: [
      "Alle Scout-Ergebnisse der letzten 48h (US-Scout, DE-Scout, Podcast-Scout)",
      "Radar-Signale der letzten 48h (Trending-Aktien mit Confidence-Score)",
      "Aktuelles Datum und Wochentag",
    ],
    outputs: [
      "Die eine beste Aktie des Tages",
      "Empfehlung: Kaufen / Leicht kaufen / Halten",
      "Conviction: 1–10",
      "Begründung (2–3 Sätze)",
      "Quellen-Array",
    ],
    systemPrompt: `"Du bist Opus, der leitende Investment-Stratege von NextHorizon. Deine Aufgabe ist die tägliche NH-Select-Empfehlung: die eine vielversprechendste Aktie des Tages, basierend auf Radar-Signalen und Scout-Recherchen."`,
    workflow: [
      "Liest alle Scout-Ergebnisse und Radar-Signale der letzten 48h",
      "Extended Thinking: Opus denkt intern ausführlich bevor es entscheidet",
      "Wählt die eine Aktie mit dem stärksten Signal-Konsens",
      "Speichert Ergebnis + aktuellen Kurs für späteres Outcome-Tracking",
      "Sendet Web Push Notification an alle Abonnenten",
    ],
    strengths: [
      "Extended Thinking ermöglicht tiefe Abwägung zwischen konkurrierenden Signalen",
      "Stärkstes Modell im NH Select Prozess",
      "Signal-Konsens aus mehreren unabhängigen Scouts erhöht Zuverlässigkeit",
      "Outcome-Tracking ermöglicht Qualitätskontrolle über Zeit",
    ],
    weaknesses: [
      "Kennt keine aktuellen Kurse zum Entscheidungszeitpunkt",
      "Qualität hängt stark von Scout-Input-Qualität ab",
      "Kann an Tagen mit wenig Nachrichtenfluss schlechte Kandidaten haben",
    ],
    reliability: 3,
    reliabilityNote: "Bestes Signal im System, aber immer noch KI-generiert. Trefferquote wird aktiv gemessen.",
  },
  {
    id: "radar",
    model: "Claude Haiku",
    modelColor: "#22c55e",
    trigger: "Täglich automatisch (Cron, unabhängig von Scouts)",
    cache: "Signale bleiben 48h aktiv für den Synthesizer",
    inputs: [
      "Trending-Ticker vom Yahoo Finance Trending-Endpoint",
      "Google News RSS pro Trending-Ticker (bis zu 5 Schlagzeilen)",
      "NH Analyse-Score pro Ticker (wird live berechnet)",
    ],
    outputs: [
      "Radar-Signale: Symbol, Signal-Typ, Beschreibung, Confidence 1–10, Quelle",
    ],
    systemPrompt: `Autonomer Trend-Scanner: bewertet ob trending Aktien fundamentale oder technische Substanz haben.`,
    workflow: [
      "Ruft täglich trending Ticker von Yahoo Finance ab",
      "Für jeden Ticker: News abrufen + NH Score berechnen",
      "Bewertet ob Trending durch Substanz oder nur Hype getrieben",
      "Speichert Signale in radar_signals Tabelle für Synthesizer",
    ],
    strengths: [
      "Findet Aktien die gerade Momentum aufbauen bevor sie die Schlagzeilen dominieren",
      "Kombiniert Trend-Daten mit fundamentaler Bewertung",
    ],
    weaknesses: [
      "Yahoo Finance Trending kann durch Meme-Stocks oder Social Media verzerrt sein",
      "Score-Berechnung triggert zusätzliche API-Calls",
    ],
    reliability: 3,
    reliabilityNote: "Guter Frühindikator. Stärke liegt in der Kombination mit Scout-Signalen.",
  },
];

function ReliabilityDots({ value }: { value: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="w-2 h-2 rounded-full" style={{
          background: i <= value
            ? value >= 4 ? "#22c55e" : value >= 3 ? "#f59e0b" : "#ef4444"
            : "var(--card-border)"
        }} />
      ))}
      <span className="text-[10px] ml-1" style={{ color: "var(--muted)" }}>
        {value === 5 ? "Sehr hoch" : value === 4 ? "Hoch" : value === 3 ? "Mittel" : value === 2 ? "Niedrig" : "Sehr niedrig"}
      </span>
    </div>
  );
}

function AgentCard({ doc }: { doc: AgentDoc }) {
  const [open, setOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>

      {/* Header */}
      <button onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3.5 flex items-center justify-between text-left">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={doc.id} size="sm" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white capitalize">{doc.id === "us-scout" ? "US-Scout" : doc.id === "de-scout" ? "DE-Scout" : doc.id === "podcast-scout" ? "Podcast-Scout" : doc.id.charAt(0).toUpperCase() + doc.id.slice(1)}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ background: doc.modelColor + "22", color: doc.modelColor }}>
                {doc.model}
              </span>
            </div>
            {doc.pipeline && (
              <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>{doc.pipeline}</p>
            )}
          </div>
        </div>
        {open
          ? <ChevronUp size={15} style={{ color: "var(--muted)" }} />
          : <ChevronDown size={15} style={{ color: "var(--muted)" }} />}
      </button>

      {open && (
        <div className="border-t space-y-4 px-4 pb-4 pt-3" style={{ borderColor: "var(--card-border)" }}>

          {/* Meta row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl p-2.5 space-y-1" style={{ background: "var(--card-border)" }}>
              <div className="flex items-center gap-1.5">
                <Zap size={10} style={{ color: "var(--primary)" }} />
                <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--primary)" }}>Auslöser</p>
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>{doc.trigger}</p>
            </div>
            <div className="rounded-xl p-2.5 space-y-1" style={{ background: "var(--card-border)" }}>
              <div className="flex items-center gap-1.5">
                <Clock size={10} style={{ color: "#f59e0b" }} />
                <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#f59e0b" }}>Cache</p>
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>{doc.cache}</p>
            </div>
          </div>

          {/* Inputs / Outputs */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Database size={10} style={{ color: "#818cf8" }} />
                <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#818cf8" }}>Eingabe</p>
              </div>
              <div className="space-y-1">
                {doc.inputs.map((inp, i) => (
                  <p key={i} className="text-[10px] leading-relaxed flex gap-1" style={{ color: "var(--muted)" }}>
                    <span style={{ color: "#818cf8" }}>·</span>{inp}
                  </p>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Database size={10} style={{ color: "#22c55e" }} />
                <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#22c55e" }}>Ausgabe</p>
              </div>
              <div className="space-y-1">
                {doc.outputs.map((out, i) => (
                  <p key={i} className="text-[10px] leading-relaxed flex gap-1" style={{ color: "var(--muted)" }}>
                    <span style={{ color: "#22c55e" }}>·</span>{out}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {/* Workflow */}
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>Arbeitsablauf</p>
            <div className="space-y-1">
              {doc.workflow.map((step, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-[9px] font-bold w-3.5 flex-shrink-0 mt-0.5" style={{ color: "var(--primary)" }}>{i + 1}.</span>
                  <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>{step}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Strengths + Weaknesses */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
              <div className="flex items-center gap-1 mb-1.5">
                <CheckCircle size={10} style={{ color: "#22c55e" }} />
                <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#22c55e" }}>Stärken</p>
              </div>
              <div className="space-y-1">
                {doc.strengths.map((s, i) => (
                  <p key={i} className="text-[10px] leading-relaxed flex gap-1" style={{ color: "var(--muted)" }}>
                    <span style={{ color: "#22c55e" }}>·</span>{s}
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-xl p-2.5" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
              <div className="flex items-center gap-1 mb-1.5">
                <AlertTriangle size={10} style={{ color: "#f87171" }} />
                <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#f87171" }}>Schwächen</p>
              </div>
              <div className="space-y-1">
                {doc.weaknesses.map((w, i) => (
                  <p key={i} className="text-[10px] leading-relaxed flex gap-1" style={{ color: "var(--muted)" }}>
                    <span style={{ color: "#f87171" }}>·</span>{w}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {/* Reliability */}
          <div className="rounded-xl p-2.5" style={{ background: "var(--card-border)" }}>
            <p className="text-[9px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>Zuverlässigkeit</p>
            <ReliabilityDots value={doc.reliability} />
            <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: "var(--muted)" }}>{doc.reliabilityNote}</p>
          </div>

          {/* System Prompt */}
          <div>
            <button onClick={() => setPromptOpen(v => !v)}
              className="flex items-center gap-1.5 text-[10px] font-medium"
              style={{ color: "var(--muted)" }}>
              {promptOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              System-Prompt {promptOpen ? "ausblenden" : "anzeigen"}
            </button>
            {promptOpen && (
              <div className="mt-2 rounded-xl p-3 font-mono text-[10px] leading-relaxed"
                style={{ background: "rgba(0,0,0,0.3)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.2)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {doc.systemPrompt}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

export function AgentsView() {
  const pipelineAgents = AGENTS.filter(a => a.pipeline);
  const standaloneAgents = AGENTS.filter(a => !a.pipeline);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">KI-Agenten</h2>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
          Technische Dokumentation aller Agenten — Modelle, Prompts, Stärken und Grenzen.
        </p>
      </div>

      {/* Model legend */}
      <div className="rounded-2xl border p-3 flex flex-wrap gap-3"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        {[
          { label: "Claude Haiku", color: "#06b6d4", note: "Schnell, günstig, gut für strukturierte Tasks" },
          { label: "Claude Sonnet", color: "#6366f1", note: "Ausgewogen — Qualität & Geschwindigkeit" },
          { label: "Claude Opus", color: "#f59e0b", note: "Stärkstes Modell, langsamer, für komplexe Synthese" },
        ].map(m => (
          <div key={m.label} className="flex items-start gap-2">
            <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ background: m.color }} />
            <div>
              <p className="text-[10px] font-bold" style={{ color: m.color }}>{m.label}</p>
              <p className="text-[9px]" style={{ color: "var(--muted)" }}>{m.note}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline section */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
          Pipeline-Agenten
        </p>
        <div className="space-y-2">
          {pipelineAgents.map(doc => <AgentCard key={doc.id} doc={doc} />)}
        </div>
      </div>

      {/* Standalone */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
          Eigenständige Agenten
        </p>
        <div className="space-y-2">
          {standaloneAgents.map(doc => <AgentCard key={doc.id} doc={doc} />)}
        </div>
      </div>
    </div>
  );
}
