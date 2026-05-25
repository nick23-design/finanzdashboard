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
      "Bis zu 5 Artikel-Titel + Kurzbeschreibung pro Watchlist-Aktie (max. 8 Aktien)",
      "Beschreibungen via og:description / meta-description (parallel, 2,5 s Timeout)",
      "Quelle: Google News RSS",
    ],
    outputs: [
      "Wichtigkeits-Klassifizierung: hoch / mittel / niedrig",
      "Deutsche Übersetzung des Titels",
    ],
    systemPrompt: `"Du bist eine Finanz-Nachrichtenredakteurin. Antworte ausschließlich mit validem JSON."`,
    workflow: [
      "Google News RSS wird für jede Watchlist-Aktie abgerufen",
      "Bis zu 5 Artikel-URLs werden parallel gefetcht — nur die ersten 8 KB (Head-Bereich)",
      "og:description oder meta-description wird extrahiert, falls vorhanden",
      "Titel + Artikelauszug werden in einem einzigen API-Call an Haiku übergeben",
      "Haiku klassifiziert nach Relevanz und übersetzt ins Deutsche",
      "Ergebnis wird mit Originaldaten gemerged und sortiert angezeigt",
    ],
    strengths: [
      "Schnell: Single-Call für alle Artikel + parallele Head-only Fetches",
      "Artikelauszüge verbessern die Klassifizierung bei mehrdeutigen Titeln deutlich",
      "Deutsche Übersetzungen profitieren von mehr Kontext",
    ],
    weaknesses: [
      "og:description enthält oft Marketing-Text statt echtem Artikelinhalt",
      "Paywall-Seiten liefern manchmal nur generische Beschreibungen wie 'Subscribe to read'",
      "Artikel auf langsamen Servern (>2,5 s) fallen auf Titel-only zurück — systematische Verzerrung zugunsten schneller Quellen",
      "Google News redirect-URLs können selten nicht auflösen, dann kein Auszug",
      "Voller Artikeltext bleibt unzugänglich — tiefe Analyse wie Zahlen im Fließtext nicht möglich",
    ],
    reliability: 4,
    reliabilityNote: "Klassifizierung klar verbessert durch Auszüge. Hauptrisiko: Qualität der og:description variiert stark nach Quelle.",
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
      "SEC EDGAR Daten (US-Aktien): Quartalsumsätze, Nettogewinn, Bruttogewinn der letzten 6 Quartale",
      "Branchen-Peers: Ø KGV, Ø Umsatzwachstum, Ø Debt/Equity aus Supabase-Cache (falls vorhanden)",
    ],
    outputs: [
      "Wachstumsbewertung 1–10",
      "Key Positives (Array)",
      "Key Risks (Array)",
      "Bewertungskommentar (Text) — jetzt mit relativem Peer-Vergleich",
    ],
    systemPrompt: `"Du bist ein wachstumsorientierter Aktienanalyst. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach."`,
    workflow: [
      "Snapshot-Daten und EDGAR-Quartalszahlen werden als strukturierter Text formatiert",
      "Peer-Snapshots der letzten 24h werden aus Supabase geladen (falls gecacht)",
      "Felix bewertet Wachstum, Profitabilität und Bewertung relativ zu Peer-Durchschnittswerten",
      "Ergebnis fließt als Input in den Synthese-Agenten (Opus)",
    ],
    strengths: [
      "Peer-Vergleich ermöglicht relative Bewertung statt absoluter Zahlen",
      "EDGAR-Daten geben historischen Kontext über mehrere Quartale",
      "Strukturierte Ausgabe ist gut maschinenlesbar",
    ],
    weaknesses: [
      "Peer-Vergleich nur für ~35 fest hinterlegte Aktien (PEER_MAP) — alle anderen erhalten keinen Kontext",
      "Peers müssen in den letzten 24h gecacht sein, sonst kein Vergleich",
      "Peer-Durchschnitte können irreführend sein wenn Peers sehr unterschiedliche Geschäftsmodelle haben (z.B. NVDA vs. INTC)",
      "EDGAR nur für US-Aktien verfügbar",
      "Haiku kann bei sehr widersprüchlichen Signalen (hohes KGV + hohes Wachstum) zu schnellen Urteilen neigen",
    ],
    reliability: 4,
    reliabilityNote: "Peer-Kontext verbessert Bewertungsqualität spürbar. Zuverlässigkeit fällt für Aktien außerhalb der PEER_MAP auf früherem Niveau.",
  },
  {
    id: "nina",
    model: "Claude Haiku",
    modelColor: "#8b5cf6",
    trigger: "Teil der Vollanalyse-Pipeline (on-demand)",
    cache: "6 Stunden (als Teil des Gesamtergebnisses)",
    pipeline: "Schritt 2 von 5 der Vollanalyse",
    inputs: [
      "Bis zu 10 aktuelle Nachrichten-Schlagzeilen + Artikelauszüge zur Aktie",
      "Premium-Quellen-Markierung [★] für Reuters, Bloomberg, FT, WSJ, CNBC, Handelsblatt, FAZ",
      "Quelle: Google News RSS + paralleler Head-Fetch der Artikel-URLs",
    ],
    outputs: [
      "Sentiment: bullish / neutral / bearish",
      "Key Themes (Array)",
      "Sentiment Summary (Text)",
    ],
    systemPrompt: `"Du bist ein Finanz-Nachrichtenanalyst. Artikel von Quellen mit [★] sind besonders zuverlässig und sollen stärker gewichtet werden. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach."`,
    workflow: [
      "Google News RSS liefert aktuelle Schlagzeilen zur Aktie",
      "Artikel-URLs werden parallel gefetcht (nur Head, 8 KB, 2,5 s Timeout)",
      "Premium-Quellen werden mit [★] markiert",
      "Nina analysiert Tonalität, Themen und Quellengewicht der Headlines",
      "Ergebnis fließt in den Synthese-Agenten",
    ],
    strengths: [
      "Artikelauszüge geben deutlich mehr Kontext als Titel allein",
      "Premium-Quellengewichtung reduziert Einfluss reißerischer Kleinmedien",
      "Themen-Extraktion hilft Hauptnarrative zu erkennen",
    ],
    weaknesses: [
      "og:description-Qualität variiert stark — viele Seiten liefern SEO-Text statt Artikelkern",
      "Paywall-Artikel (Bloomberg, FT) liefern oft nur generische Abo-Aufforderungen",
      "Quellengewichtung ist hardcoded — neue oder regionale Premium-Quellen werden nicht erkannt",
      "Sentiment kann sich innerhalb von Stunden umkehren — 6h Cache kann veraltetes Bild zeigen",
      "Keine Unterscheidung zwischen sachlicher Berichterstattung und Meinungsartikeln",
    ],
    reliability: 4,
    reliabilityNote: "Brauchbar als ergänzender Indikator. Artikelauszüge + Quellengewichtung machen Einschätzungen deutlich stabiler.",
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
      "Insider-Transaktionen sind eines der stärksten verfügbaren Frühsignale",
      "Google Trends gibt frühzeitig Hinweise auf Momentum-Shifts",
      "Institutionelle Positionierung zeigt Smart-Money-Flüsse",
    ],
    weaknesses: [
      "Insider-Daten und institutionelle Daten nur für US-Aktien via SEC verfügbar — für DE/EU-Aktien ist dieser Schritt leer",
      "Insider-Verkäufe können viele Gründe haben (Steuern, Diversifikation, Optionsverfallstermine) — nicht immer Pessimismus",
      "Institutionelle Quartalsberichte (13F) erscheinen mit bis zu 45 Tagen Verzögerung",
      "Google Trends misst öffentliches Suchinteresse, nicht gezielt das von Investoren",
      "Haiku bewertet Insider-Muster ohne den persönlichen Kontext der Transaktionsperson",
    ],
    reliability: 3,
    reliabilityNote: "Starker Zusatz-Kontext für US-Aktien. Für Nicht-US-Aktien liefert Marco kaum verwertbare Daten.",
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
      "Reduziert Halluzinationen in der Opus-Analyse messbar",
      "Transparentes System: Conviction sinkt nachvollziehbar bei gefundenen Unsicherheiten",
      "Schützt vor erfundenen Firmennamen, Deals oder Zahlen",
    ],
    weaknesses: [
      "Vera kann nur prüfen was in den übergebenen Daten steht — keine externe Recherche möglich",
      "Vera selbst ist ein KI-Modell und kann beim Beurteilen Fehler machen",
      "Conviction-Anpassung (−3 bis 0) ist eine grobe Näherung, kein präzises Maß",
      "Erkennt keine subtilen Interpretationsfehler — nur konkrete Faktenbehauptungen",
      "Wenn Opus und Vera beide denselben Fehler machen, bleibt er unentdeckt",
    ],
    reliability: 4,
    reliabilityNote: "Wirksames Sicherheitsnetz gegen grobe Fehler. Schützt nicht vor systemischen Schwächen der gesamten Pipeline.",
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
      "Felix-Ergebnis inkl. Peer-Vergleich: Wachstumsbewertung, Stärken, Risiken",
      "Nina-Ergebnis inkl. Artikelauszüge: Sentiment, Themen, Summary",
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
      "Erhält aggregierten Kontext aus Felix (mit Peer-Daten), Nina (mit Auszügen), Marco + Rohdaten",
      "Adaptive Thinking: Opus denkt intern vor der Antwort (bei komplexen Abwägungen)",
      "Synthetisiert alle Signale zu einer konsistenten Gesamtempfehlung",
      "Berechnet konkrete Kursziele basierend auf MA50 und Analysten-Konsens",
      "Ergebnis geht an Vera zum Fact-Check",
    ],
    strengths: [
      "Stärkstes verfügbares Claude-Modell — beste Reasoning-Qualität",
      "Adaptive Thinking aktiviert bei erkannten Widersprüchen zwischen Signalen",
      "Berücksichtigt nun alle Verbesserungen der vorgelagerten Agenten",
      "Konkrete Kursziele mit Begründung sind praktisch verwertbar",
    ],
    weaknesses: [
      "Teuerster und langsamster Agent in der Pipeline (~15–30 s)",
      "Kein Internetzugang — kann ausschließlich bereitgestellte Daten nutzen",
      "Kursziele sind Modell-Schätzungen, keine professionellen Analystenpreise — weichen oft deutlich ab",
      "'Garbage in, garbage out': Lückenhafte Eingangsdaten (fehlende Kennzahlen, leere EDGAR-Daten) führen zu weniger belastbaren Ergebnissen",
      "Adaptive Thinking hat ein Token-Budget — bei sehr komplexen Aktien kann dieses zu knapp sein",
    ],
    reliability: 4,
    reliabilityNote: "Beste Reasoning-Qualität im System. Output ist nur so gut wie der schwächste Eingangs-Agent.",
  },
  {
    id: "kai",
    model: "Claude Opus 4.7 + Adaptive Thinking",
    modelColor: "#6366f1",
    trigger: "On-demand (beim Klick auf 'KI-Analyse' im Vergleich)",
    cache: "Keine — wird bei jedem Aufruf neu generiert",
    inputs: [
      "Snapshot-Daten beider Aktien: Preis, KGV, MarktKap, Wachstum, FCF, D/E, RSI, MAs",
      "NH Analyse-Score beider Aktien (falls vorhanden)",
      "Branchen-Peers beider Aktien: Ø KGV, Ø Wachstum, Ø D/E aus Supabase-Cache",
      "Aktuelle News beider Aktien: bis zu 5 Schlagzeilen pro Aktie (Google News)",
      "Fallback: Frontend übergibt bereits geladene Daten direkt",
    ],
    outputs: [
      "Gewinner (Symbol oder null bei Gleichstand)",
      "Summary (2–3 Sätze inkl. Branchen-Einordnung und Sentiment)",
      "Empfehlung (1 Satz)",
      "Stärken A + B (je 3 Punkte)",
      "Schwächen A + B (je 2 Punkte)",
      "Verdict (1–2 Sätze mit konkreter Begründung)",
    ],
    systemPrompt: `"Du bist Kai, ein präziser Aktienvergleichs-Analyst. Du hast Zugang zu Kennzahlen, Branchen-Peers und aktuellen News beider Aktien. Antworte ausschließlich mit validem JSON."`,
    workflow: [
      "Snapshot-Daten, Scores, News und Peer-Kontext für beide Aktien werden parallel abgerufen",
      "News (bis zu 5 Headlines pro Aktie) liefern aktuelles Sentiment",
      "Branchen-Peers aus PEER_MAP werden aus dem Supabase-Cache geladen",
      "Adaptive Thinking: Kai wägt bei komplexen Entscheidungen intern ab",
      "Strukturierte Analyse mit klarem Gewinner und Branchen-Einordnung",
    ],
    strengths: [
      "Opus + Adaptive Thinking für tiefste Abwägungen bei knappen Entscheidungen",
      "Branchen-Peer-Kontext ermöglicht relative statt absolute Bewertung",
      "Aktuelle News-Sentiment fließt direkt in die Empfehlung ein",
      "Fallback auf Frontend-Daten macht Kai robust bei fehlenden DB-Snapshots",
    ],
    weaknesses: [
      "Deutlich langsamer als vorher (~15–25s statt ~5s) durch Opus + parallele Daten-Fetches",
      "Peer-Kontext nur für ~35 hinterlegte Aktien — alle anderen ohne Branchen-Einordnung",
      "News-Sentiment basiert nur auf Titeln (keine Artikelauszüge wie bei Nina)",
      "Opus ist teurer als Sonnet — bei häufigen Vergleichen höhere Kosten",
      "Vergleich ist nur so stark wie die verfügbaren Snapshot-Daten — fehlende Kennzahlen schwächen das Urteil",
    ],
    reliability: 5,
    reliabilityNote: "Stärkste Vergleichsanalyse im System. Hauptkompromiss: deutlich längere Wartezeit.",
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
      "Nur Symbole die von der Finance API validiert wurden (existierende Ticker)",
    ],
    systemPrompt: `"Du bist US-Scout, ein US-Markt Analyst. Analysiere aktuelle US-Finanznachrichten und identifiziere 2-4 vielversprechende US-Aktien mit konkreten Ticker-Symbolen. Antworte ausschließlich als JSON-Array."`,
    workflow: [
      "Drei thematisch unterschiedliche Google News RSS-Feeds werden abgerufen",
      "Alle Titel werden zusammengeführt und nummeriert",
      "US-Scout extrahiert konkrete Ticker-Symbole aus den Nachrichten",
      "Jedes Symbol wird gegen die Finance API validiert (Kurs muss abrufbar sein)",
      "Nur valide Symbole werden in der Datenbank gespeichert",
    ],
    strengths: [
      "Ticker-Validierung filtert halluzinierte oder falsche Symbole zuverlässig heraus",
      "Breite Abdeckung durch drei verschiedene Themen-Feeds",
      "Findet aktuelle Momentum-Aktien direkt aus dem Nachrichtenfluss",
    ],
    weaknesses: [
      "Validierung erfordert erreichbare Finance API — fällt die API aus, werden alle Picks verworfen",
      "Validierung bestätigt nur dass ein Symbol existiert, nicht dass es das richtige Unternehmen ist",
      "Liest nur Titel — kein Artikelinhalt, kein Kursniveau, kein RSI",
      "Momentum-Aktien können zum Zeitpunkt der Empfehlung bereits 20–30% gestiegen sein",
    ],
    reliability: 3,
    reliabilityNote: "Ticker-Validierung bringt deutliche Qualitätsverbesserung. Rohe Signalquelle — Synthesizer-Filter bleibt entscheidend.",
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
      "Symbole validiert — .DE-Suffix wird automatisch ergänzt wenn nötig",
    ],
    systemPrompt: `Analog zu US-Scout, mit Fokus auf deutsche und europäische Märkte.`,
    workflow: [
      "Gleicher Ablauf wie US-Scout, aber mit europäischen Suchbegriffen",
      "Jedes Symbol wird zunächst ohne Suffix validiert",
      "Bei Fehlschlag wird .DE-Suffix ergänzt und erneut validiert (z.B. BMW → BMW.DE)",
      "Nur valide Symbole werden gespeichert",
    ],
    strengths: [
      "Einziger Agent der systematisch DAX/Euro-Stoxx abdeckt",
      ".DE-Fallback löst das häufigste Problem europäischer Ticker-Erkennung",
      "Ticker-Validierung filtert falsche Symbole heraus",
    ],
    weaknesses: [
      "Andere europäische Börsen (.PA, .AS, .MI, .MC) werden nicht automatisch ergänzt",
      "Weniger Nachrichtenvolumen als US-Markt — manchmal zu wenige Kandidaten",
      "Haiku extrahiert europäische Unternehmensnamen aus deutschsprachigen Nachrichten manchmal ungenau",
      "Validierung schützt vor falschem Symbol, nicht vor falscher Unternehmenszuordnung",
    ],
    reliability: 3,
    reliabilityNote: ".DE-Validierung löst das häufigste Problem. Europäische Börsenplätze jenseits XETRA bleiben Schwachstelle.",
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
      "Kann Meinungen und Thesen als Fakten interpretieren",
      "Podcasts können gesponserte Inhalte enthalten — keine Unterscheidung möglich",
      "Keine Ticker-Validierung wie bei US-Scout und DE-Scout",
    ],
    reliability: 2,
    reliabilityNote: "Ergänzung, kein Hauptsignal. Interessant für qualitative Impulse, aber niedrigste Zuverlässigkeit der drei Scouts.",
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
      "Aktuelle Kurse aller Kandidaten-Symbole (live abgerufen vor dem Opus-Call)",
      "Aktuelles Datum und Wochentag",
    ],
    outputs: [
      "Die eine beste Aktie des Tages",
      "Empfehlung: Kaufen / Leicht kaufen / Halten",
      "Conviction: 1–10",
      "Begründung (2–3 Sätze)",
      "Quellen-Array",
    ],
    systemPrompt: `"Du bist Opus, der leitende Investment-Stratege von NextHorizon. Deine Aufgabe ist die tägliche NH-Select-Empfehlung. Berücksichtige die aktuellen Kurse: Aktien die bereits stark gestiegen sind oder nahe Widerständen notieren sind kritisch zu bewerten."`,
    workflow: [
      "Liest alle Scout-Ergebnisse und Radar-Signale der letzten 48h",
      "Ruft aktuelle Kurse aller Kandidaten parallel ab (vor dem Opus-Call)",
      "Extended Thinking: Opus wägt intern Signalstärke, Konsens und Kursniveaus ab",
      "Wählt die Aktie mit dem stärksten Signal-Konsens bei vertretbarem Kursniveau",
      "Speichert Ergebnis + Einstiegskurs für Outcome-Tracking",
      "Sendet Web Push Notification an alle Abonnenten",
    ],
    strengths: [
      "Kennt nun aktuelle Kurse vor der Entscheidung — kann überhitzte Kandidaten aussortieren",
      "Extended Thinking ermöglicht tiefe Abwägung zwischen konkurrierenden Signalen",
      "Signal-Konsens aus mehreren unabhängigen Quellen erhöht Zuverlässigkeit",
      "Outcome-Tracking macht Trefferquote über Zeit messbar und transparent",
    ],
    weaknesses: [
      "Kurse ohne technischen Kontext (kein RSI, kein MA-Vergleich) — Preisebene allein ist schwacher Indikator",
      "Extended Thinking Budget (2000 Tokens) kann bei vielen Kandidaten zu knapp sein",
      "Qualität hängt stark von der Güte der Scout-Eingaben ab",
      "Kann an Tagen mit dünnem Nachrichtenfluss keine starke Wahl treffen — Conviction sinkt, Empfehlung bleibt aber",
      "Reagiert auf vergangene Nachrichten — bereits eingepreiste Ereignisse können zu Fehlempfehlungen führen",
    ],
    reliability: 4,
    reliabilityNote: "Aktueller Kurszusatz macht Entscheidungen fundierter. Systemisches Risiko: alle Scouts liefern an schwachen Tagen wenig.",
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
      "Findet Aktien die gerade Momentum aufbauen — oft vor medialer Sättigung",
      "Kombiniert Trend-Signal mit fundamentaler Bewertung (NH Score)",
    ],
    weaknesses: [
      "Yahoo Finance Trending wird durch Meme-Stocks, Reddit und Social Media stark verzerrt",
      "Score-Berechnung pro Ticker triggert zusätzliche API-Calls — Fehlerrate steigt mit Anzahl der Trendenden",
      "Trending bedeutet Aufmerksamkeit, nicht Qualität — viele Trending-Aktien fallen danach",
      "Keine Ticker-Validierung wie bei den Scouts",
    ],
    reliability: 3,
    reliabilityNote: "Guter Frühindikator wenn Trending durch Fundamentaldaten bestätigt wird. Allein wenig aussagekräftig.",
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
