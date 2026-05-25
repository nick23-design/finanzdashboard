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
    id: "diana",
    model: "Regelbasiert (kein LLM)",
    modelColor: "#06b6d4",
    trigger: "Teil der Vollanalyse-Pipeline (on-demand)",
    cache: "6 Stunden (als Teil des Gesamtergebnisses)",
    pipeline: "Schritt 0 — Datenqualitäts-Vorprüfung",
    inputs: [
      "Asset-Snapshot: Preis, KGV, Marktkapitalisierung, Umsatzwachstum, Free Cashflow, Debt/Equity, RSI, MA50, MA200",
      "EDGAR-Verfügbarkeit: Prüft ob SEC-Quartalsdaten für das Symbol vorhanden sind",
    ],
    outputs: [
      "Completeness-Score 0–100",
      "Liste fehlender Kennzahlen",
      "Liste veralteter oder unplausibler Felder",
      "Warnungen (z. B. kein EDGAR für EU-Aktien, Preis fehlt)",
      "Analysis-Confidence-Cap 4–10 für Opus",
    ],
    systemPrompt: `"Kein LLM — Diana ist vollständig regelbasiert. Kein API-Call, kein Modell, kein Prompt."`,
    workflow: [
      "Alle Kennzahlen des Asset-Snapshots werden gegen eine Pflichtfeld-Liste geprüft",
      "Fehlende Pflichtfelder (KGV, Marktkapitalisierung, etc.) werden mit Punktabzug bewertet",
      "EDGAR-Verfügbarkeit wird separat geprüft (US-only, wichtig für Felix)",
      "Score 0–100 wird berechnet: ≥85 = gut, ≥70 = lückenhaft, ≥55 = schwach",
      "Score-Mapping zu Confidence-Cap: ≥85→10, ≥70→8, ≥55→7, ≥40→6, ≥25→5, sonst 4",
      "Cap wird als Obergrenze an Opus übergeben und im Analyse-Ergebnis sichtbar gemacht",
    ],
    strengths: [
      "Kein LLM — kein API-Call, kein Kostenfaktor, keine Latenz, keine Halluzinationen",
      "Verhindert, dass lückenhafte Rohdaten zu überkonfidenten Empfehlungen führen",
      "Macht Datenlücken für den User transparent (Datenbasis-Balken in der UI)",
      "Läuft immer synchron vor der Analyse — kein Ausfallrisiko",
    ],
    weaknesses: [
      "Kann die Qualität der Rohdaten nicht verbessern — nur bewerten und bremsen",
      "EDGAR-Prüfung nur für US-Aktien; EU-Aktien verlieren systematisch Punkte",
      "Score ist heuristisch — kein absoluter Wahrheitswert, nur ein Proxy für Datenvollständigkeit",
      "Versteht keine inhaltlichen Fehler in den Daten, nur fehlende oder unplausible Werte",
    ],
    reliability: 5,
    reliabilityNote: "Deterministisch — kein Modell, kein Zufall. Zuverlässigkeit 5/5 für das was sie tut: Datenvollständigkeit bewerten und Cap setzen.",
  },
  {
    id: "lisa",
    model: "Claude Haiku 4.5",
    modelColor: "#06b6d4",
    trigger: "On-demand (beim Öffnen der News-Seite)",
    cache: "Keine — wird bei jedem Seitenaufruf neu generiert",
    inputs: [
      "Bis zu 5 Artikel-Titel pro Watchlist-Aktie (max. 8 Aktien)",
      "Artikelauszüge via Jina AI Reader (r.jina.ai) — bis zu 700 Zeichen echten Artikeltext, Paywall-Bypass",
      "Fallback: og:description / meta-description (8 KB Head-Fetch)",
      "Quelle: Google News RSS",
    ],
    outputs: [
      "Wichtigkeits-Klassifizierung: hoch / mittel / niedrig",
      "Deutsche Übersetzung des Titels",
    ],
    systemPrompt: `"Du bist eine Finanz-Nachrichtenredakteurin. Antworte ausschließlich mit validem JSON."`,
    workflow: [
      "Google News RSS wird für jede Watchlist-Aktie abgerufen",
      "Artikel-URLs werden parallel an Jina AI Reader geschickt (r.jina.ai/{url}, 5 s Timeout)",
      "Jina liefert Markdown-Text — erste 700 Zeichen echten Artikelinhalts werden extrahiert",
      "Fallback auf og:description wenn Jina fehlschlägt oder zu wenig Text liefert",
      "Titel + Artikelauszug werden in einem einzigen API-Call an Haiku übergeben",
      "Haiku klassifiziert nach Relevanz und übersetzt ins Deutsche",
    ],
    strengths: [
      "Jina AI Reader kann häufig lesbare Artikel-Auszüge liefern, auch bei schwer zugänglichen Seiten — besser als reine Marketing-Beschreibungen",
      "Schnell: Single-Call für alle Artikel + parallele Jina-Fetches",
      "Deutsche Übersetzungen profitieren von echtem Artikelkontext",
    ],
    weaknesses: [
      "Jina scheitert bei sehr langsamen Servern (>5 s) oder blockierten Domains — dann Fallback auf og:description",
      "og:description-Fallback enthält oft Marketing-Text statt echtem Artikelinhalt",
      "Auszüge sind auf 700 Zeichen begrenzt — tiefe Analyse wie Zahlen im Fließtext nur teilweise möglich",
      "Google News redirect-URLs können selten nicht auflösen, dann kein Auszug",
    ],
    reliability: 4,
    reliabilityNote: "Klassifizierung deutlich verbessert durch echte Artikelauszüge via Jina. Hauptrisiko: Jina-Verfügbarkeit und Fallback-Qualität.",
  },
  {
    id: "felix",
    model: "Claude Haiku 4.5",
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
    model: "Claude Haiku 4.5",
    modelColor: "#8b5cf6",
    trigger: "Teil der Vollanalyse-Pipeline (on-demand)",
    cache: "6 Stunden (als Teil des Gesamtergebnisses)",
    pipeline: "Schritt 2 von 5 der Vollanalyse",
    inputs: [
      "Bis zu 10 aktuelle Nachrichten-Schlagzeilen + Artikelauszüge zur Aktie",
      "Artikelauszüge via Jina AI Reader — bis zu 700 Zeichen echten Artikeltext, Paywall-Bypass",
      "Premium-Quellen-Markierung [★] für Reuters, Bloomberg, FT, WSJ, CNBC, Handelsblatt, FAZ",
      "Quelle: Google News RSS + parallele Jina-Fetches",
    ],
    outputs: [
      "Sentiment: bullish / neutral / bearish",
      "Key Themes (Array)",
      "Sentiment Summary (Text)",
    ],
    systemPrompt: `"Du bist ein Finanz-Nachrichtenanalyst. Artikel von Quellen mit [★] sind besonders zuverlässig und sollen stärker gewichtet werden. Antworte ausschließlich mit validem JSON, ohne Erklärungen davor oder danach."`,
    workflow: [
      "Google News RSS liefert aktuelle Schlagzeilen zur Aktie",
      "Artikel-URLs werden parallel an Jina AI Reader geschickt (5 s Timeout)",
      "Jina liefert echten Artikeltext (bis 700 Zeichen); Fallback auf og:description",
      "Premium-Quellen werden mit [★] markiert",
      "Nina analysiert Tonalität, Themen und Quellengewicht mit vollem Artikelkontext",
      "Ergebnis fließt in den Synthese-Agenten",
    ],
    strengths: [
      "Jina AI Reader liefert echten Artikeltext — Sentiment deutlich präziser als mit Titeln allein",
      "Jina kann häufig Auszüge auch aus schwer zugänglichen Quellen wie Bloomberg und FT liefern — nicht garantiert, aber deutlich besser als nur Titel",
      "Premium-Quellengewichtung reduziert Einfluss reißerischer Kleinmedien",
    ],
    weaknesses: [
      "Jina scheitert bei sehr langsamen Servern oder blockierten Domains — dann Fallback auf og:description",
      "Quellengewichtung ist hardcoded — neue oder regionale Premium-Quellen werden nicht erkannt",
      "Sentiment kann sich innerhalb von Stunden umkehren — 6h Cache kann veraltetes Bild zeigen",
      "Keine Unterscheidung zwischen sachlicher Berichterstattung und Meinungsartikeln",
    ],
    reliability: 4,
    reliabilityNote: "Deutlich verbessert durch echte Artikelauszüge via Jina. Paywall-Bypass macht Premium-Quellen erstmals vollständig verwertbar.",
  },
  {
    id: "marco",
    model: "Claude Haiku 4.5",
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
    model: "Claude Sonnet 4.6",
    modelColor: "#ef4444",
    trigger: "Teil der Vollanalyse-Pipeline (on-demand)",
    cache: "6 Stunden (als Teil des Gesamtergebnisses)",
    pipeline: "Schritt 5 von 5 — Fact-Check nach Opus-Synthese",
    inputs: [
      "Draft-Analyse von Opus (Empfehlung, Summary, Bull/Bear-Case, Wachstumsausblick)",
      "Autoritative Marktdaten (live von Finance API): Kurs, MA50, MA200, KGV, FCF, Debt/Equity, Marktkapitalisierung, Umsatzwachstum — haben Vorrang vor Artikelangaben und gelten als per Definition belegt",
      "Analysten-Konsens (Kursziele, Buy/Hold/Sell-Verteilung)",
      "Bis zu 10 News mit Jina-Excerpts — jeder Artikel mit Altersangabe '(vor X Tagen)'",
      "URL-Whitelist für fetch_article Tool (nur URLs aus den bereits abgerufenen News)",
    ],
    outputs: [
      "Korrekturen (Array — leer wenn alles korrekt)",
      "Verifizierte Aussagen (Array)",
      "Conviction-Adjustment: −3 bis 0",
      "Korrigierte Summary, Bull-Case, Bear-Case (nur bei nachweislichen Fehlern)",
      "Strukturierte Findings: claim, issue_type, correction, severity, confidence → fact_check_findings DB",
      "Protokoll-Eintrag mit Anzahl nachrecherchierter Artikel, sichtbar in der Analyse-Ansicht",
    ],
    systemPrompt: `"Du bist Vera, eine kritische Fact-Checkerin für Finanzanalysen. [...] REGELN: (1) Autoritative Marktdaten (Finance API) dürfen nicht durch Artikelpreise überschrieben werden. (2) Altersbasierte Vertrauensregeln: Kurse nur aus Artikeln < 2 Tage, Quartalszahlen < 14 Tage, Ereignisse < 30 Tage, strukturelle Fakten zeitlos. (3) Prozentzahlen in Artikeln sind historische Kursbewegungen, keine MA-Abstände. (4) TTM-Wachstum ist korrekt auch wenn einzelne Quartale abweichen."`,
    workflow: [
      "Opus schließt Analyse mit complete_analysis-Tool-Call ab (Zod-validiert: Empfehlung aus Enum, Conviction 1–10)",
      "Vera erhält autoritative Marktdaten (Kurs, MA50/200, KGV) direkt aus dem Snapshot — diese haben Vorrang vor allem",
      "Vera prüft Faktenbehauptungen gegen Analysten-Daten und News-Excerpts unter Beachtung des Artikelalters",
      "Altersregel: Kurskorrekturen nur mit Artikeln < 2 Tage; Quartalszahlen < 14 Tage; Ereignisse < 30 Tage; strukturelle Fakten zeitlos",
      "Bei unklarer Beleglage: bis zu 3× fetch_article für Artikel aus der News-Whitelist (1200 Zeichen via Jina)",
      "Bei nachweislichen Fehlern: Conviction senken + Summary/Bull-/Bear-Case korrigieren",
      "Strukturierte Findings (issue_type, severity, confidence 1–10) werden in fact_check_findings gespeichert",
      "High-confidence Findings (≥7 symbol-spez., ≥9 global) fließen bei der nächsten Analyse als Guardrails in Opus zurück",
    ],
    strengths: [
      "Autoritative Marktdaten (Kurs, MA50/200) schützen vor falschen Preiskorrekturen durch veraltete Artikel",
      "Altersbasierte Vertrauensregeln: ältere Artikel lösen keine Korrekturen bei zeitkritischen Zahlen aus",
      "Aktive Recherche: kann bis zu 3 Artikel vollständig lesen (1200 Zeichen) um strittige Behauptungen zu prüfen",
      "Feedback-Loop: Korrekturen werden strukturiert gespeichert und automatisch zu Guardrails für künftige Opus-Analysen",
      "Läuft immer — auch im erfolgreichen Hauptpfad, nicht nur im Fallback",
    ],
    weaknesses: [
      "Recherche ist auf whitelisted News-URLs beschränkt — keine offene Web-Suche möglich",
      "Vera selbst ist ein KI-Modell und kann beim Beurteilen Fehler machen — daher nur Findings mit confidence ≥ 7 als Guardrails",
      "Conviction-Anpassung (−3 bis 0) bleibt eine grobe Näherung",
      "fetch_article-Aufrufe (max. 3 × 5 s Timeout) können Analysezeit um bis zu 15 s verlängern",
      "Altersregeln sind Prompt-Instruktionen — Vera kann sie als KI-Modell nicht garantiert einhalten",
    ],
    reliability: 4,
    reliabilityNote: "Autoritative Snapshot-Daten + Freshness-Regeln reduzieren Falschkorrekturen deutlich. Bleibt ein KI-Modell das nur begrenzten Quellenpool prüft — reliability 5 erst mit manuellem Review oder harter Claim-Validation.",
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
      "Historische Guardrails: symbol-spezifische Vera-Korrekturen (conf ≥ 7) + globale Patterns (conf ≥ 9, letzte 90 Tage)",
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
    systemPrompt: `"Du bist Opus, der leitende Investment-Stratege. [...] HISTORISCHE GUARDRAILS (aus früheren Vera-Korrekturen — strikt einhalten): - [Symbol] Korrektur... - [Global] Korrektur..."`,
    workflow: [
      "Historische Guardrails aus fact_check_findings werden geladen (symbol-spezifisch + global) und in den System-Prompt injiziert",
      "Erhält aggregierten Kontext aus Felix (mit Peer-Daten), Nina (mit Auszügen), Marco + Rohdaten",
      "Adaptive Thinking: Opus denkt intern vor der Antwort (bei komplexen Abwägungen)",
      "Synthetisiert alle Signale zu einer konsistenten Gesamtempfehlung",
      "Berechnet konkrete Kursziele basierend auf MA50 und Analysten-Konsens",
      "complete_analysis Tool-Call wird mit Zod validiert (Empfehlung aus Enum, Conviction 1–10) bevor Ergebnis akzeptiert wird",
      "Ergebnis geht an Vera zum Fact-Check",
    ],
    strengths: [
      "Stärkstes verfügbares Claude-Modell — beste Reasoning-Qualität",
      "Adaptive Thinking aktiviert bei erkannten Widersprüchen zwischen Signalen",
      "Guardrails aus Vera's früheren Korrekturen reduzieren wiederkehrende Fehlertypen bei bekannten Aktien",
      "Zod-Validierung des Tool-Outputs verhindert fehlerhafte Werte (falsche Enum, Conviction außerhalb 1–10)",
      "Kursziele aus MA50 und Analysten-Konsens berechnet — modellbasierte Orientierungsmarken, kein Ersatz für professionelle Analysten-Kursziele",
    ],
    weaknesses: [
      "Teuerster und langsamster Agent in der Pipeline (~15–30 s)",
      "Kein Internetzugang — kann ausschließlich bereitgestellte Daten nutzen",
      "Kursziele sind Modell-Schätzungen, keine professionellen Analystenpreise — weichen oft deutlich ab",
      "'Garbage in, garbage out': Lückenhafte Eingangsdaten führen zu weniger belastbaren Ergebnissen",
      "Guardrails wirken erst wenn Vera vorher für das Symbol Korrekturen gefunden hat (kalt = kein Effekt)",
    ],
    reliability: 4,
    reliabilityNote: "Beste Reasoning-Qualität im System. Guardrail-Feedback-Loop stärkt Qualität bei bekannten Aktien über Zeit. Output ist nur so gut wie der schwächste Eingangs-Agent.",
  },
  {
    id: "kai",
    model: "Claude Opus 4.7 + Adaptive Thinking",
    modelColor: "#6366f1",
    trigger: "On-demand (beim Klick auf 'KI-Analyse' im Vergleich)",
    cache: "2 Stunden (In-Memory-Cache pro Symbolpaar — AAPL+MSFT = MSFT+AAPL)",
    inputs: [
      "Snapshot-Daten beider Aktien: Preis, KGV, MarktKap, Wachstum, FCF, D/E, RSI, MAs",
      "NH Analyse-Score beider Aktien (falls vorhanden)",
      "Branchen-Peers beider Aktien: Ø KGV, Ø Wachstum, Ø D/E aus Supabase-Cache",
      "Aktuelle News beider Aktien: bis zu 5 Artikel mit Jina-Auszügen pro Aktie (Google News)",
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
      "News-URLs beider Aktien werden parallel an Jina AI Reader geschickt — bis zu 5 Artikel pro Symbol mit echtem Inhalt",
      "Branchen-Peers aus PEER_MAP werden aus dem Supabase-Cache geladen",
      "Adaptive Thinking: Kai wägt bei komplexen Entscheidungen intern ab",
      "Strukturierte Analyse mit klarem Gewinner, Artikelkontext und Branchen-Einordnung",
    ],
    strengths: [
      "Opus + Adaptive Thinking für tiefste Abwägungen bei knappen Entscheidungen",
      "Jina AI Reader liefert echten Artikelinhalt zu beiden Aktien — Sentiment fundiert statt nur Titel",
      "Branchen-Peer-Kontext ermöglicht relative statt absolute Bewertung",
      "Fallback auf Frontend-Daten macht Kai robust bei fehlenden DB-Snapshots",
    ],
    weaknesses: [
      "Langsamster Agent im System (~20–35s) — beim ersten Aufruf eines Paares, danach sofort aus Cache",
      "Cache lebt nur im Arbeitsspeicher — nach Vercel-Kaltstart oder Deployment ist er leer",
      "Peer-Kontext nur für ~35 hinterlegte Aktien — alle anderen ohne Branchen-Einordnung",
      "Opus ist teurer als Sonnet — Cache reduziert Kosten bei Wiederholungen deutlich",
    ],
    reliability: 5,
    reliabilityNote: "Stärkste Vergleichsanalyse im System. 2h-Cache vermeidet redundante Opus-Calls für dasselbe Symbolpaar.",
  },
  {
    id: "us-scout",
    model: "Claude Haiku 4.5",
    modelColor: "#3b82f6",
    trigger: "Täglich automatisch (Cron, Werktage)",
    cache: "Ergebnisse in Datenbank bis zum nächsten Tag",
    pipeline: "Schritt 1a der NH Select Pipeline",
    inputs: [
      "Google News RSS Feed 1–3: Analyst-Upgrades, Earnings-Beats, Momentum (Titel only)",
      "Premium RSS: Reuters Business, AP Business, MarketWatch (Titel + plain-text Beschreibung)",
      "Je bis zu 8 Artikel pro Feed",
    ],
    outputs: [
      "2–4 US-Aktien mit Symbol, Name, Empfehlung, Conviction 1–10, Begründung, Quellen",
      "Nur Symbole die von der Finance API validiert wurden (existierende Ticker)",
    ],
    systemPrompt: `"Du bist US-Scout, ein US-Markt Analyst. Analysiere aktuelle US-Finanznachrichten und identifiziere 2-4 vielversprechende US-Aktien mit konkreten Ticker-Symbolen. Antworte ausschließlich als JSON-Array."`,
    workflow: [
      "Drei thematische Google News RSS-Feeds + drei Premium RSS-Feeds werden parallel abgerufen",
      "Premium-Feeds (Reuters, AP, MarketWatch) liefern plain-text Beschreibungen — HTML-Descriptions werden übersprungen",
      "Alle Titel und Beschreibungen werden zusammengeführt (→ Excerpt nach dem Titel)",
      "US-Scout extrahiert konkrete Ticker-Symbole aus Nachrichten und Beschreibungen",
      "Jedes Symbol wird gegen die Finance API validiert (Kurs muss abrufbar sein)",
      "Nur valide Symbole werden in der Datenbank gespeichert",
    ],
    strengths: [
      "Premium RSS (Reuters, AP, MarketWatch) liefert echte Artikelzusammenfassungen direkt im Feed",
      "Breite Abdeckung durch sechs verschiedene Quellen (3 Google News + 3 Premium)",
      "Ticker-Validierung filtert nicht existierende Symbole heraus — garantiert aber nicht die richtige Unternehmenszuordnung",
    ],
    weaknesses: [
      "Google News RSS liefert weiterhin nur Titel — Premium-Beschreibungen abhängig von Feed-Qualität",
      "Validierung erfordert erreichbare Finance API — fällt die API aus, werden alle Picks verworfen",
      "Validierung bestätigt nur dass ein Symbol existiert, nicht dass es das richtige Unternehmen ist",
      "Momentum-Aktien können zum Zeitpunkt der Empfehlung bereits 20–30% gestiegen sein",
    ],
    reliability: 3,
    reliabilityNote: "Premium RSS erhöht Informationsdichte deutlich. Rohe Signalquelle — Synthesizer-Filter bleibt entscheidend.",
  },
  {
    id: "de-scout",
    model: "Claude Haiku 4.5",
    modelColor: "#6ECF97",
    trigger: "Täglich automatisch (Cron, Werktage)",
    cache: "Ergebnisse in Datenbank bis zum nächsten Tag",
    pipeline: "Schritt 1b der NH Select Pipeline",
    inputs: [
      "Google News RSS Feed 1–3: Analyst-Empfehlungen, Kursziele, DAX/MDAX (Titel only)",
      "Premium RSS: Reuters DE, Handelsblatt, FAZ Wirtschaft (Titel + plain-text Beschreibung)",
      "Je bis zu 8 Artikel pro Feed",
    ],
    outputs: [
      "2–4 DE/EU-Aktien mit Symbol, Name, Empfehlung, Conviction, Begründung",
      "Symbole validiert — .DE-Suffix wird automatisch ergänzt wenn nötig",
    ],
    systemPrompt: `"Du bist DE-Scout, ein DACH- und Europa-Markt Analyst. Analysiere aktuelle deutschsprachige Finanznachrichten und identifiziere 2-4 vielversprechende Aktien. Antworte ausschließlich als JSON-Array."`,
    workflow: [
      "Drei deutschsprachige Google News RSS-Feeds + drei Premium RSS-Feeds werden parallel abgerufen",
      "Premium-Feeds (Reuters DE, Handelsblatt, FAZ) liefern plain-text Beschreibungen — HTML-Descriptions werden übersprungen",
      "Alle Titel und Beschreibungen werden zusammengeführt (→ Excerpt nach dem Titel)",
      "Jedes Symbol wird zunächst ohne Suffix validiert",
      "Bei Fehlschlag wird .DE-Suffix ergänzt und erneut validiert (z.B. BMW → BMW.DE)",
      "Nur valide Symbole werden gespeichert",
    ],
    strengths: [
      "Premium RSS (Reuters DE, Handelsblatt, FAZ) liefert deutschsprachige Artikelzusammenfassungen",
      "Einziger Agent der systematisch DAX/MDAX abdeckt",
      ".DE-Fallback löst das häufigste Problem europäischer Ticker-Erkennung",
    ],
    weaknesses: [
      "Google News RSS liefert weiterhin nur Titel — Premium-Beschreibungen abhängig von Feed-Qualität",
      "Andere europäische Börsen (.PA, .AS, .MI, .MC) werden nicht automatisch ergänzt",
      "Weniger Nachrichtenvolumen als US-Markt — manchmal zu wenige Kandidaten",
      "Validierung schützt vor falschem Symbol, nicht vor falscher Unternehmenszuordnung",
    ],
    reliability: 3,
    reliabilityNote: "Premium RSS + .DE-Validierung erhöhen Qualität deutlich. Europäische Börsenplätze jenseits XETRA bleiben Schwachstelle.",
  },
  {
    id: "podcast-scout",
    model: "Claude Haiku 4.5",
    modelColor: "#8b5cf6",
    trigger: "Täglich automatisch (Cron, Werktage)",
    cache: "Ergebnisse in Datenbank bis zum nächsten Tag",
    pipeline: "Schritt 1c der NH Select Pipeline",
    inputs: [
      "Inhalte aus Finanz-Podcasts (Titel, Episodenbeschreibungen, Transkript-Ausschnitte)",
      "Fokus auf bekannte Investment-Podcasts",
    ],
    outputs: [
      "1–3 Aktien mit Symbol, Name, Empfehlung, Conviction, Begründung",
      "Nur Symbole die von der Finance API validiert wurden (.DE-Fallback für EU-Aktien)",
    ],
    systemPrompt: `"Du bist Podcast-Scout, ein Investment-Podcast Analyst. Analysiere aktuelle Investment-Podcast-Episoden und extrahiere konkret genannte Aktien-Empfehlungen. Antworte ausschließlich als JSON-Array."`,
    workflow: [
      "Vier Podcast-Feeds werden parallel abgerufen (Motley Fool Money, Alles auf Aktien, Google News Podcast DE/EN)",
      "Bis zu 5 Episoden pro Feed werden extrahiert (Titel + Beschreibung)",
      "Podcast-Scout extrahiert konkret empfohlene Aktien mit Podcast-Kontext",
      "Jedes Symbol wird gegen die Finance API validiert — .DE-Suffix wird bei Bedarf automatisch ergänzt",
      "Nur valide Symbole werden in der Datenbank gespeichert",
    ],
    strengths: [
      "Erfasst Investmentideen aus qualitativen Quellen jenseits von Headlines",
      "Podcasts behandeln oft tiefere Thesen als Tagesnachrichten",
      "Ticker-Validierung filtert nicht existierende Symbole heraus (wie US/DE-Scout) — garantiert keine korrekte Unternehmenszuordnung",
    ],
    weaknesses: [
      "Qualität stark abhängig von Podcast-Verfügbarkeit und -Inhalt",
      "Kann Meinungen und Thesen als Fakten interpretieren",
      "Podcasts können gesponserte Inhalte enthalten — keine Unterscheidung möglich",
      "Episodenbeschreibungen sind oft kurz und lassen Aktiennamen manchmal implizit",
    ],
    reliability: 3,
    reliabilityNote: "Ticker-Validierung hebt Zuverlässigkeit auf Scout-Niveau. Ergänzung, kein Hauptsignal — qualitative Impulse aus Podcast-Kontext.",
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
    model: "Claude Sonnet 4.6",
    modelColor: "#10b981",
    trigger: "Täglich automatisch (Cron, unabhängig von Scouts)",
    cache: "Signale bleiben 48h aktiv für den Synthesizer",
    inputs: [
      "Trending-Ticker vom Yahoo Finance Trending-Endpoint (Top 10)",
      "Google News RSS pro Ticker: bis zu 8 Artikel (Titel + URL + Quelle)",
      "Jina AI Reader: Artikel-Excerpts (300–700 Zeichen) — URL-dedupliziert, Cross-Ticker-Referenzen erhalten",
      "NH Analyse-Score pro Ticker (wird live berechnet)",
    ],
    outputs: [
      "3–5 Radar-Signale: Symbol, Signal-Typ, Beschreibung, Confidence 1–10",
    ],
    systemPrompt: `"Du bist Radar, ein autonomer Markt-Scanner. Unterscheide klar zwischen substanziellem Trend (Earnings, Guidance, M&A) und reinem Hype (Clickbait, Social Media). Antworte ausschließlich als JSON-Array."`,
    workflow: [
      "Top 10 Trending-Ticker werden von Yahoo Finance abgerufen",
      "Für jeden Ticker: bis zu 8 News-Items (title + url + source) aus Google News RSS",
      "URLs werden dedupliziert — jeder Artikel nur einmal via Jina AI Reader gefetcht",
      "Descriptions werden per URL-Map auf alle Items zurückgespielt (Cross-Ticker-Artikel bleiben bei beiden Symbolen)",
      "Jedes Item erhält einen Ranking-Score: +3 Excerpt, +3 Premium-Quelle, +2 Material-Event, +2 Symbol im Titel, +1 erster im Feed, −2 Clickbait",
      "Pro Symbol: Top 3 mit Topic-Diversity (max. 1× Earnings, 1× Analyst, 1× Other)",
      "Sonnet bewertet angereicherten Context und identifiziert 3–5 substanzielle Signale",
    ],
    strengths: [
      "Regelbasiertes Ranking filtert Clickbait und generische Artikel vor dem KI-Call",
      "Topic-Diversity verhindert drei gleichartige Earnings-Artikel pro Symbol",
      "Cross-Ticker-Artikel (z.B. 'NVDA vs AMD') bleiben bei beiden Symbolen erhalten",
      "Jina-Deduplizierung spart API-Calls bei überlappenden News",
    ],
    weaknesses: [
      "Yahoo Finance Trending wird durch Meme-Stocks, Reddit und Social Media stark verzerrt",
      "Score-Berechnung pro Ticker triggert zusätzliche API-Calls — Fehlerrate steigt mit Anzahl der Trendenden",
      "Ranking-Score ist regelbasiert — unbekannte Quellen oder neue Clickbait-Muster werden nicht erkannt",
      "Keine Ticker-Validierung wie bei den Scouts",
    ],
    reliability: 3,
    reliabilityNote: "Deutlich bessere Hype-vs-Substanz-Unterscheidung durch kuratierten Input. Kernrisiko bleibt das verzerrte Yahoo-Trending-Signal.",
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
          { label: "Claude Haiku 4.5", color: "#06b6d4", note: "Schnell, günstig, gut für strukturierte Tasks" },
          { label: "Claude Sonnet 4.6", color: "#10b981", note: "Ausgewogen — Qualität & Geschwindigkeit" },
          { label: "Claude Opus 4.7", color: "#f59e0b", note: "Stärkstes Modell, langsamer, für komplexe Synthese" },
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
