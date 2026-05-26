"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";

interface Section {
  id: string;
  title: string;
  emoji: string;
  content: React.ReactNode;
}

function RiskBox({ items }: { items: string[] }) {
  return (
    <div className="rounded-xl p-3 mt-3 space-y-1.5"
      style={{ background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.2)" }}>
      <div className="flex items-center gap-1.5 mb-2">
        <AlertTriangle size={11} style={{ color: "#fb923c" }} />
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#fb923c" }}>
          Einschränkungen & Risiken
        </p>
      </div>
      {items.map((item, i) => (
        <p key={i} className="text-xs leading-relaxed flex gap-1.5" style={{ color: "var(--muted)" }}>
          <span style={{ color: "#fb923c" }}>·</span>{item}
        </p>
      ))}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--primary)" }}>
        {label}
      </p>
      <div className="text-xs leading-relaxed space-y-1" style={{ color: "var(--muted)" }}>
        {children}
      </div>
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="inline-block text-[10px] px-2 py-0.5 rounded font-medium mr-1 mb-1"
      style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
      {label}
    </span>
  );
}

const SECTIONS: Section[] = [
  {
    id: "watchlist",
    title: "Watchlist",
    emoji: "⭐",
    content: (
      <div className="space-y-3">
        <Block label="Was es macht">
          <p>Persönliche Aktienliste mit Echtzeit-Kursen und Tagesveränderungen. Aktien können über die Suche hinzugefügt werden — statische Liste von ~100 bekannten Titeln sowie Live-Suche via Backend.</p>
        </Block>
        <Block label="Morgen-Briefing">
          <p>Tägliche KI-Zusammenfassung der Marktlage bezogen auf deine Watchlist. Generiert von <strong className="text-white">Claude Haiku</strong> auf Basis live abgerufener Indexpreise und Watchlist-Daten.</p>
        </Block>
        <Block label="NH Select Chip">
          <p>Zeigt den heutigen Synthesizer-Pick kompakt an. Klick führt zum Markt-Tab mit der vollständigen Begründung.</p>
        </Block>
        <Block label="Datenquellen">
          <Pill label="Yahoo Finance (inoffiziell)" />
          <Pill label="Claude Haiku" />
        </Block>
        <RiskBox items={[
          "Yahoo Finance ist keine offizielle API — Kurse können verzögert oder kurzzeitig fehlerhaft sein.",
          "Das Morgen-Briefing ist KI-generiert und stellt keine Anlageberatung dar.",
          "Keine Garantie auf Vollständigkeit oder Aktualität der Daten.",
        ]} />
      </div>
    ),
  },
  {
    id: "markt",
    title: "Markt",
    emoji: "📈",
    content: (
      <div className="space-y-3">
        <Block label="Makro-Indikatoren">
          <p>VIX (Volatilitätsindex), 10-jährige US-Rendite, USD-Index, Gold und Öl — live via Yahoo Finance. VIX über 25 gilt als erhöhte Marktspannung.</p>
        </Block>
        <Block label="Sektor-Heatmap">
          <p>11 SPDR-Sektor-ETFs (XLK, XLV, XLF, XLE, XLY, XLP, XLI, XLB, XLRE, XLU, XLC) als Proxy für die S&P-500-Sektoren. Zeitraum wählbar: 1T / 1W / 1M.</p>
        </Block>
        <Block label="Earnings-Kalender">
          <p>Nächste Berichtstermine deiner Watchlist-Aktien, gefiltert auf die nächsten 60 Tage. Sortiert nach Dringlichkeit (rot = ≤ 3 Tage, orange = ≤ 7 Tage).</p>
        </Block>
        <Block label="NH Select">
          <p>Mehrstufiger KI-Prozess — täglich automatisch ausgeführt. Scouts sammeln Signale, der Synthesizer wählt den besten Pick. Details siehe Abschnitt NH Select.</p>
        </Block>
        <Block label="Datenquellen">
          <Pill label="Yahoo Finance (inoffiziell)" />
          <Pill label="SPDR ETFs als Sektor-Proxy" />
          <Pill label="Google News RSS" />
        </Block>
        <RiskBox items={[
          "SPDR ETFs sind Proxys, keine exakten Sektor-Indizes — bilden den Sektor nicht 1:1 ab.",
          "Earnings-Termine können sich verschieben oder von der Datenquelle fehlen.",
          "Makro-Daten ohne Echtzeit-Garantie.",
        ]} />
      </div>
    ),
  },
  {
    id: "aktiendetail",
    title: "Aktiendetail & Analyse-Score",
    emoji: "🔎",
    content: (
      <div className="space-y-3">
        <Block label="Kursdaten & Chart">
          <p>Preis, Tagesveränderung und historischer Kursverlauf (1T bis ALL) via Yahoo Finance. Kurse sind Tagesschlusskurse, kein Intraday-Tick.</p>
        </Block>
        <Block label="NH Analyse-Score (0–100)">
          <p>Rein regelbasiert — kein KI-Modell. Berechnet aus drei gewichteten Teilscores:</p>
          <p className="mt-1">• <strong className="text-white">Fundamental (40%):</strong> KGV, Free Cashflow, Umsatzwachstum</p>
          <p>• <strong className="text-white">Technisch (30%):</strong> RSI, Abstand zum 50-Tage-MA, Kurs über/unter 200-Tage-MA</p>
          <p>• <strong className="text-white">Risiko inv. (30%):</strong> Debt-to-Equity, RSI-Extremwerte, MA-Spread</p>
          <p className="mt-1">Signale: ≥80 Bullish · ≥60 Slightly Bullish · ≥40 Neutral · ≥20 Caution · &lt;20 High Risk</p>
        </Block>
        <Block label="KI-Vollanalyse (Multi-Agenten-Pipeline)">
          <p>Die Analyse läuft in sechs Stufen:</p>
          <p className="mt-1">• <strong className="text-white">Diana (regelbasiert):</strong> Prüft vor der Analyse die Datenlage — bewertet Vollständigkeit von Kennzahlen, News, EDGAR-Daten und Analysten-Konsens. Gibt einen Datenbasis-Score (0–100) aus und setzt die maximale Conviction, die Opus vergeben darf.</p>
          <p>• <strong className="text-white">Felix (Haiku 4.5):</strong> Bewertet Finanzkennzahlen und SEC EDGAR Quartalsdaten auf Wachstum, Profitabilität und Verschuldung. Liefert eine Wachstumsbewertung (1–10) mit Stärken und Risiken.</p>
          <p>• <strong className="text-white">Nina (Haiku 4.5):</strong> Bewertet angereicherte Nachrichtenartikel (Titel + Excerpts aus Jina AI) und bestimmt Marktstimmung sowie Nachrichtenthemen.</p>
          <p>• <strong className="text-white">Marco (Haiku 4.5):</strong> Analysiert Insider-Transaktionen (SEC Form 4), institutionelle Positionen und Google Trends als Marktsignale.</p>
          <p>• <strong className="text-white">Opus 4.7 (Adaptive Thinking):</strong> Orchestriert alle Agenten — koordiniert Felix, Nina und Marco, fasst die Ergebnisse zusammen und erstellt Empfehlung, Conviction-Score (1–10, gedeckelt durch Diana), Kursziele, Bull/Bear-Case und Wachstumsausblick.</p>
          <p>• <strong className="text-white">Vera (Haiku 4.5):</strong> Prüft die fertige Analyse nachgelagert gegen authoritative Finance-API-Daten (Kurs, MAs, RSI, KGV, FCF u.a.), Analysten-Konsens und vorhandene News-Excerpts. Der Fact-Check blockiert die Hauptanalyse nicht; belegte Fehler können den Conviction-Score nachträglich senken.</p>
          <p className="mt-1">Ergebnis wird 6 Stunden gecacht. Kursziele werden aus MA50-Abstand und Analysten-Konsens berechnet — modellbasierte Orientierungsmarken, kein Ersatz für professionelle Analysten-Kursziele.</p>
        </Block>
        <Block label="Konkurrenten">
          <p>3 Peer-Aktien pro Titel — statische Liste für ~30 bekannte Unternehmen, für unbekannte Symbole ermittelt <strong className="text-white">Claude Haiku 4.5</strong> die Peers dynamisch.</p>
        </Block>
        <Block label="Datenquellen">
          <Pill label="Yahoo Finance (inoffiziell)" />
          <Pill label="Diana (Datenqualitäts-Modul)" />
          <Pill label="Claude Opus 4.7 (Analyse)" />
          <Pill label="Claude Haiku 4.5 (Vera)" />
          <Pill label="Claude Haiku 4.5 (Felix / Nina / Marco / Peers)" />
          <Pill label="Google News RSS" />
          <Pill label="Jina AI Reader" />
        </Block>
        <RiskBox items={[
          "Der Score basiert auf wenigen Datenpunkten — kein DCF, kein Branchen-Kontext, keine Zukunftsprognosen.",
          "Vera arbeitet im stabilen Hauptpfad nachgelagert mit vorhandenen News-Excerpts. Authoritative Kennzahlen aus der Finance API (Kurs, MAs, RSI etc.) gelten immer als belegt und können nicht durch Artikel überschrieben werden.",
          "KGV, Cashflow und Wachstum können von Yahoo Finance fehlen oder veraltet sein — besonders bei europäischen Aktien. Diana zeigt fehlende Felder transparent an.",
          "Ein hoher Score ist kein Kaufsignal, sondern ein Indikator auf Basis historischer Kennzahlen.",
        ]} />
      </div>
    ),
  },
  {
    id: "portfolio",
    title: "Portfolio",
    emoji: "💼",
    content: (
      <div className="space-y-3">
        <Block label="Positionen">
          <p>Manuell eingetragene Lots (Kaufpreis + Anzahl Aktien). Mehrere Lots pro Aktie möglich. Gewinn/Verlust wird gegen den aktuellen Yahoo Finance Kurs berechnet.</p>
        </Block>
        <Block label="Portfoliowert-Chart">
          <p>Historischer Gesamtwert berechnet aus gehaltenen Aktienanzahlen × historische Tagesschlusskurse (Yahoo Finance). Zeitraum ALL bis 1M wählbar.</p>
        </Block>
        <Block label="S&P 500 Benchmark">
          <p>SPY ETF als Markt-Proxy. Prozentualer Vergleich ab dem ersten Datenpunkt des gewählten Zeitraums — zeigt ob das Portfolio den Markt schlägt.</p>
        </Block>
        <Block label="Korrelationsmatrix">
          <p>Pearson-Korrelation der täglichen Renditen aller Positionen über 3 Monate. Rot = stark positiv (Klumpenrisiko), Grau = unkorrelliert, Grün = negativ (Hedge-Effekt). Sichtbar ab ≥ 2 Positionen.</p>
        </Block>
        <Block label="Datenquellen">
          <Pill label="Yahoo Finance (inoffiziell)" />
          <Pill label="Manuelle Eingabe" />
        </Block>
        <RiskBox items={[
          "Dividenden, Steuern und Transaktionskosten werden nicht berücksichtigt.",
          "SPY als Benchmark ist US-lastig — für DE/EU-Portfolios nur bedingt aussagekräftig.",
          "Korrelation der Vergangenheit ist kein verlässlicher Indikator für künftige Korrelationen.",
          "Kurse können verzögert sein — P&L-Berechnung ist nicht für den aktiven Handel geeignet.",
        ]} />
      </div>
    ),
  },
  {
    id: "news",
    title: "News",
    emoji: "📰",
    content: (
      <div className="space-y-3">
        <Block label="Artikel-Feed">
          <p>Pro Watchlist-Aktie werden bis zu 5 aktuelle Artikel über Google News RSS geladen (max. 8 Aktien gleichzeitig). Anzeige nach Wichtigkeit, Datum oder Symbol filterbar.</p>
        </Block>
        <Block label="Agent Lisa (Claude Haiku)">
          <p>Klassifiziert jeden Artikel nach Relevanz anhand von Titel und Artikel-Excerpt und übersetzt ins Deutsche:</p>
          <p className="mt-1">• <strong className="text-white">Wichtig:</strong> Direkte Unternehmensnews (Quartalszahlen, Übernahmen, CEO-Wechsel)</p>
          <p>• <strong className="text-white">Mittel:</strong> Analysten-Ratings, Sektor- oder Wettbewerbsnews</p>
          <p>• <strong className="text-white">Gering:</strong> Allgemeine Markt- oder Wirtschaftsnews</p>
        </Block>
        <Block label="Podcast-Sektion">
          <p>Wenn der Podcast-Scout (NH Select) heute aktiv war, erscheinen analysierte Finanz-Podcasts als aufklappbare Sektion mit Zusammenfassung.</p>
        </Block>
        <Block label="Datenquellen">
          <Pill label="Google News RSS" />
          <Pill label="Claude Haiku (Lisa)" />
        </Block>
        <RiskBox items={[
          "Google News RSS ist keine offizielle API — Verfügbarkeit und Vollständigkeit nicht garantiert.",
          "Lisa bewertet Titel und Artikel-Excerpt — bei kurzen oder fehlenden Excerpts kann die Klassifizierung ungenau sein.",
          "Übersetzungen sind maschinell und inhaltlich nicht geprüft.",
        ]} />
      </div>
    ),
  },
  {
    id: "screener",
    title: "Screener",
    emoji: "🔍",
    content: (
      <div className="space-y-3">
        <Block label="Datengrundlage">
          <p>Zeigt alle Aktien die bereits einen NH Analyse-Score in der Datenbank haben. Beim ersten Besuch nur Titel, die manuell über das Aktiendetail analysiert wurden.</p>
        </Block>
        <Block label="Universe laden">
          <p>Analysiert ~50 vordefinierte Aktien (US Bluechips, DAX-Auswahl, ETFs) in 5er-Batches und speichert die Scores. Aktien mit Score jünger als 6 Stunden werden übersprungen. Dauert beim ersten Mal 1–2 Minuten.</p>
        </Block>
        <Block label="Filter & Sortierung">
          <p>Signal-Chips (Bullish bis High Risk), Min-Score-Slider (0–90), Sortierung nach Score, RSI, KGV oder Marktkapitalisierung. Alle Filter kombinierbar.</p>
        </Block>
        <Block label="Datenquellen">
          <Pill label="Supabase (gecachte Scores)" />
          <Pill label="Yahoo Finance (inoffiziell)" />
        </Block>
        <RiskBox items={[
          "Scores sind maximal 6 Stunden alt — kein Echtzeit-Screening.",
          "Universe ist auf ~50 vorselektierte Titel begrenzt, kein vollständiger Marktüberblick.",
          "Ein hoher Score bedeutet keine Kaufempfehlung — siehe Erklärung beim Analyse-Score.",
        ]} />
      </div>
    ),
  },
  {
    id: "nhselect",
    title: "NH Select",
    emoji: "🎯",
    content: (
      <div className="space-y-3">
        <Block label="Mehrstufiger KI-Prozess (täglich automatisch)">
          <p>NH Select läuft jeden Werktag vollautomatisch in drei Stufen:</p>
        </Block>
        <Block label="Stufe 1 — Scouts (Claude Haiku)">
          <p>• <strong className="text-white">US-Scout:</strong> Scannt 3 Google News RSS-Feeds (Analyst Upgrades, Earnings Beats, Momentum) und extrahiert 2–4 US-Aktien</p>
          <p>• <strong className="text-white">DE-Scout:</strong> Gleicher Prozess für deutsche und europäische Märkte</p>
          <p>• <strong className="text-white">Podcast-Scout:</strong> Analysiert Finanz-Podcast-Inhalte auf erwähnte Aktien und Themen</p>
        </Block>
        <Block label="Stufe 2 — Synthesizer (Claude Opus + Extended Thinking)">
          <p>Liest alle Scout-Ergebnisse und Radar-Signale der letzten 48h. Wählt die eine vielversprechendste Aktie des Tages mit Empfehlung (Kaufen/Halten/Verkaufen), Conviction-Score (1–10) und ausführlicher Begründung.</p>
        </Block>
        <Block label="Trefferquote">
          <p>7 Tage nach jedem Pick prüft ein Cron-Job automatisch ob der Kurs gestiegen ist. Die Erfolgsrate aller bisherigen Picks wird auf der NH Select Seite angezeigt.</p>
        </Block>
        <Block label="Push-Benachrichtigungen">
          <p>Bei jedem täglichen Synthesizer-Pick wird eine Web Push Notification verschickt (nur wenn in den Einstellungen aktiviert).</p>
        </Block>
        <Block label="Datenquellen">
          <Pill label="Google News RSS" />
          <Pill label="Claude Haiku (Scouts)" />
          <Pill label="Claude Opus (Synthesizer)" />
          <Pill label="Yahoo Finance (Kursvalidierung)" />
        </Block>
        <RiskBox items={[
          "Scouts lesen RSS-Feeds — kein Zugriff auf vollständige Artikeltexte hinter Paywalls.",
          "Opus bezieht aktuelle Kursdaten aller Kandidaten vor der Entscheidung, aber keine Echtzeit-Orderbook-Daten.",
          "Trefferquote misst nur Kursrichtung nach 7 Tagen — kein Risiko-adjustiertes Ergebnis.",
          "Keine Garantie auf tägliche Ausführung (abhängig von Cron-Verfügbarkeit).",
          "NH Select ist keine Anlageberatung — alle Empfehlungen dienen nur zu Research-Zwecken.",
        ]} />
      </div>
    ),
  },
  {
    id: "vergleich",
    title: "Aktienvergleich",
    emoji: "⚖️",
    content: (
      <div className="space-y-3">
        <Block label="Was es macht">
          <p>Zwei beliebige Aktien head-to-head vergleichen. Erreichbar über die Suche, den &quot;Vergleichen&quot;-Button im Aktiendetail oder die Konkurrenten-Chips.</p>
        </Block>
        <Block label="Performance-Chart">
          <p>Beide Kurse normiert auf 0% ab dem ersten gemeinsamen Datenpunkt — zeigt relative Outperformance, nicht absolute Kursniveaus.</p>
        </Block>
        <Block label="Fundamentaldaten-Tabelle">
          <p>KGV, Marktkapitalisierung, Umsatzwachstum, Debt/Equity und RSI beider Aktien nebeneinander.</p>
        </Block>
        <Block label="Agent Kai (Claude Opus 4.7)">
          <p>Vergleicht beide Aktien mit Adaptive Thinking — bezieht Fundamentaldaten, Peer-Kontext und News-Excerpts ein. Liefert Stärken, Schwächen und ein begründetes Verdict. Nutzt gecachte Snapshot-Daten — falls keine vorhanden, übergibt das Frontend die bereits geladenen Daten direkt.</p>
        </Block>
        <Block label="Datenquellen">
          <Pill label="Yahoo Finance (inoffiziell)" />
          <Pill label="Claude Opus 4.7 (Kai)" />
        </Block>
        <RiskBox items={[
          "Der normierte Chart hängt stark vom gewählten Startpunkt ab — kurze Zeiträume können irreführend sein.",
          "Kai vergleicht die verfügbaren Kennzahlen beider Titel — Branchen- oder Makro-Kontext nur wenn in Peer-Daten vorhanden.",
          "Dividenden und andere Ausschüttungen werden nicht berücksichtigt.",
        ]} />
      </div>
    ),
  },
  {
    id: "alerts",
    title: "Preis-Alerts",
    emoji: "🔔",
    content: (
      <div className="space-y-3">
        <Block label="Was es macht">
          <p>Benachrichtigung per Web Push wenn ein Kurs einen definierten Schwellenwert über- oder unterschreitet. Alerts können für beliebige Aktien gesetzt werden.</p>
        </Block>
        <Block label="Prüfungsintervall">
          <p>Ein Cron-Job prüft regelmäßig alle aktiven Alerts gegen aktuelle Yahoo Finance Kurse. Ausgelöste Alerts werden als inaktiv markiert.</p>
        </Block>
        <Block label="Push-Benachrichtigungen">
          <p>Web Push muss einmalig im Browser aktiviert werden (unter Mehr → Einstellungen). Funktioniert auf Desktop und mobilen Browsern die Web Push unterstützen.</p>
        </Block>
        <Block label="Datenquellen">
          <Pill label="Yahoo Finance (inoffiziell)" />
          <Pill label="Web Push API" />
        </Block>
        <RiskBox items={[
          "Alerts werden nur beim Cron-Intervall geprüft, nicht in Echtzeit — kurze Kurs-Spikes können verpasst werden.",
          "Push-Benachrichtigungen funktionieren nur wenn der Browser Push-Berechtigungen erteilt hat.",
          "Kurse von Yahoo Finance können verzögert sein — Alert kann leicht zu spät auslösen.",
        ]} />
      </div>
    ),
  },
];

function AccordionItem({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3.5 flex items-center justify-between text-left">
        <div className="flex items-center gap-3">
          <span className="text-base">{section.emoji}</span>
          <span className="text-sm font-semibold text-white">{section.title}</span>
        </div>
        {open
          ? <ChevronUp size={15} style={{ color: "var(--muted)" }} />
          : <ChevronDown size={15} style={{ color: "var(--muted)" }} />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: "var(--card-border)" }}>
          <div className="pt-3">
            {section.content}
          </div>
        </div>
      )}
    </div>
  );
}

export function AboutView() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Über Next Horizon</h2>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
          Funktionsbeschreibung aller Features, verwendete Datenquellen und Hinweise zu Einschränkungen.
        </p>
      </div>

      <div className="rounded-2xl border p-4"
        style={{ background: "rgba(251,146,60,0.06)", borderColor: "rgba(251,146,60,0.25)" }}>
        <div className="flex items-start gap-2">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" style={{ color: "#fb923c" }} />
          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            <strong className="text-white">Kein Anlageberatungs-Dienst.</strong> Alle Analysen, Scores und Empfehlungen dienen ausschließlich zu Research- und Informationszwecken. Keine der Funktionen stellt eine Anlageberatung, Finanzberatung oder Handelsempfehlung dar. Investitionsentscheidungen liegen allein beim Nutzer.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {SECTIONS.map(section => (
          <AccordionItem key={section.id} section={section} />
        ))}
      </div>

      <p className="text-xs text-center pb-2" style={{ color: "var(--muted)" }}>
        Next Horizon · Datenquelle: Yahoo Finance (inoffiziell) · KI: Anthropic Claude
      </p>
    </div>
  );
}
