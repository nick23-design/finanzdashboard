import {
  sanitizeText,
  validateIndexClaims,
  patchIndexDirections,
  assessDataQuality,
  scoreIdeaCandidates,
} from "../briefing-validator";
import type { MarketIndex } from "../finance-client";

// ─── sanitizeText ────────────────────────────────────────────────────────────

describe("sanitizeText — Anlagesprache", () => {
  it("ersetzt Gewinnchance durch Research-Potenzial", () => {
    const { text, changes } = sanitizeText("Hier liegt eine Gewinnchance für Anleger.", false);
    expect(text).not.toContain("Gewinnchance");
    expect(text).toContain("Research-Potenzial");
    expect(changes.length).toBeGreaterThan(0);
  });

  it("ersetzt Kaufgelegenheit durch Research-Idee", () => {
    const { text } = sanitizeText("Das ist eine klassische Kaufgelegenheit.", false);
    expect(text).toContain("Research-Idee");
  });

  it("ersetzt Kaufsignal durch Analysesignal", () => {
    const { text } = sanitizeText("Es liegt ein starkes Kaufsignal vor.", false);
    expect(text).toContain("Analysesignal");
  });

  it("lässt neutralen Text unverändert", () => {
    const neutral = "AAPL beobachten — Earnings stehen an.";
    const { text, changes } = sanitizeText(neutral, false);
    expect(text).toBe(neutral);
    expect(changes).toHaveLength(0);
  });
});

describe("sanitizeText — Sektor-Aussagen", () => {
  it("schwächt 'Technologie-Sektor unter Druck' ab wenn keine ETF-Daten", () => {
    const { text } = sanitizeText("Der Technologie-Sektor steht unter Druck.", false);
    expect(text).not.toMatch(/Technologie.{0,10}Sektor/i);
  });

  it("lässt Sektor-Aussage unverändert wenn ETF-Daten vorhanden", () => {
    const input = "Der Technologie-Sektor steht unter Druck.";
    const { text } = sanitizeText(input, true);
    expect(text).toBe(input);
  });
});

describe("sanitizeText — halluzinierte Begriffe", () => {
  it("ersetzt Sentimentfoldern durch Sentimentfaktoren", () => {
    const { text } = sanitizeText("Aufgrund von Sentimentfoldern reagiert der Markt.", false);
    expect(text).toContain("Sentimentfaktoren");
    expect(text).not.toContain("Sentimentfoldern");
  });

  it("ersetzt Kurspotential durch Kursentwicklung", () => {
    const { text } = sanitizeText("Das Kurspotential ist begrenzt.", false);
    expect(text).toContain("Kursentwicklung");
  });
});

// ─── validateIndexClaims ─────────────────────────────────────────────────────

const makeIndex = (name: string, change_pct: number): MarketIndex => ({
  symbol: name.toUpperCase().replace(/[^A-Z]/g, ""),
  name,
  price: 10000,
  change_pct,
});

describe("validateIndexClaims", () => {
  it("erkennt Widerspruch: Index steigt, Text sagt 'gibt nach'", () => {
    const text = "NASDAQ gibt nach und verliert an Boden.";
    const warnings = validateIndexClaims(text, [makeIndex("NASDAQ", 0.19)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].actual).toBe("positiv");
    expect(warnings[0].index).toBe("NASDAQ");
  });

  it("erkennt Widerspruch: Index fällt, Text sagt 'steigt'", () => {
    const text = "DAX steigt und legt zu heute.";
    const warnings = validateIndexClaims(text, [makeIndex("DAX", -0.8)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].actual).toBe("negativ");
  });

  it("gibt keine Warnung wenn Richtung korrekt beschrieben", () => {
    const text = "NASDAQ legt zu und zeigt Stärke.";
    const warnings = validateIndexClaims(text, [makeIndex("NASDAQ", 0.19)]);
    expect(warnings).toHaveLength(0);
  });

  it("gibt keine Warnung bei neutraler Bewegung (< 0.1 %)", () => {
    const text = "S&P 500 gibt nach leicht.";
    const warnings = validateIndexClaims(text, [makeIndex("S&P 500", 0.05)]);
    expect(warnings).toHaveLength(0);
  });

  it("gibt keine Warnung wenn Index nicht im Text vorkommt", () => {
    const text = "Die Märkte zeigen gemischtes Bild.";
    const warnings = validateIndexClaims(text, [makeIndex("NASDAQ", -1.0)]);
    expect(warnings).toHaveLength(0);
  });
});

// ─── patchIndexDirections ────────────────────────────────────────────────────

describe("patchIndexDirections", () => {
  it("ersetzt negatives Wort wenn Index positiv ist (NASDAQ-Fall)", () => {
    const { text, changes } = patchIndexDirections(
      "NASDAQ gibt nach und verliert an Boden.",
      [makeIndex("NASDAQ", 0.19)],
    );
    expect(text).not.toContain("gibt nach");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]).toContain("NASDAQ");
  });

  it("ersetzt positives Wort wenn Index negativ ist", () => {
    const { text, changes } = patchIndexDirections(
      "Der DAX steigt heute deutlich.",
      [makeIndex("DAX", -0.8)],
    );
    expect(text).not.toContain("steigt");
    expect(changes.length).toBeGreaterThan(0);
  });

  it("verändert Text nicht bei korrekter Richtungsangabe", () => {
    const input = "Der NASDAQ legt zu heute.";
    const { text, changes } = patchIndexDirections(input, [makeIndex("NASDAQ", 0.19)]);
    expect(text).toBe(input);
    expect(changes).toHaveLength(0);
  });

  it("verändert Text nicht bei neutraler Bewegung (< 0.1 %)", () => {
    const input = "Der S&P 500 gibt nach leicht.";
    const { text, changes } = patchIndexDirections(input, [makeIndex("S&P 500", 0.05)]);
    expect(text).toBe(input);
    expect(changes).toHaveLength(0);
  });

  it("lässt Vorkommen außerhalb des Nähe-Fensters unverändert", () => {
    // Erstes "gibt nach" nah an NASDAQ → wird ersetzt
    // Zweites "gibt nach" > 70 Zeichen entfernt → bleibt
    const far = " ".repeat(80);
    const input = `NASDAQ gibt nach heute.${far}Ein anderer Wert gibt nach.`;
    const { text, changes } = patchIndexDirections(input, [makeIndex("NASDAQ", 0.5)]);
    expect(changes).toHaveLength(1);
    expect(text).toContain("gibt nach");   // fernes Vorkommen bleibt
    expect(text).toContain("NASDAQ legt zu"); // nahes Vorkommen wurde ersetzt
  });
});

// ─── assessDataQuality ───────────────────────────────────────────────────────

describe("assessDataQuality", () => {
  it("bewertet als 'gut' bei vollständigen Daten", () => {
    expect(assessDataQuality({
      assetsWithPrice: 8, watchlistTotal: 10,
      newsCount: 3, indicesCount: 4, scoresCount: 2,
    })).toBe("gut");
  });

  it("bewertet als 'eingeschränkt' bei Teildaten", () => {
    expect(assessDataQuality({
      assetsWithPrice: 4, watchlistTotal: 10,
      newsCount: 1, indicesCount: 2, scoresCount: 0,
    })).toBe("eingeschränkt");
  });

  it("bewertet als 'schwach' bei wenig Daten", () => {
    expect(assessDataQuality({
      assetsWithPrice: 1, watchlistTotal: 10,
      newsCount: 0, indicesCount: 0, scoresCount: 0,
    })).toBe("schwach");
  });

  it("behandelt leere Watchlist ohne Division durch 0", () => {
    expect(assessDataQuality({
      assetsWithPrice: 0, watchlistTotal: 0,
      newsCount: 0, indicesCount: 0, scoresCount: 0,
    })).toBe("schwach");
  });
});

// ─── scoreIdeaCandidates ─────────────────────────────────────────────────────

describe("scoreIdeaCandidates", () => {
  it("sortiert nach Score absteigend", () => {
    const result = scoreIdeaCandidates([
      { symbol: "A", name: "Alpha", data: { price_change_pct: 0.1 }, hasScore: false, hasNews: false, hasEarnings: false, newsCount: 0 },
      { symbol: "B", name: "Beta",  data: { price_change_pct: 3.5 }, hasScore: true,  hasNews: true,  hasEarnings: true,  newsCount: 3 },
    ]);
    expect(result[0].symbol).toBe("B");
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("gibt Bonus für RSI überkauft (> 78)", () => {
    const [r] = scoreIdeaCandidates([{
      symbol: "X", name: "X", data: { price_change_pct: 0, rsi: 82 },
      hasScore: false, hasNews: false, hasEarnings: false, newsCount: 0,
    }]);
    expect(r.reasons.some(r => r.includes("überkauft"))).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(4);
  });

  it("gibt Bonus für RSI überverkauft (< 28)", () => {
    const [r] = scoreIdeaCandidates([{
      symbol: "Y", name: "Y", data: { price_change_pct: 0, rsi: 22 },
      hasScore: false, hasNews: false, hasEarnings: false, newsCount: 0,
    }]);
    expect(r.reasons.some(r => r.includes("überverkauft"))).toBe(true);
  });

  it("erkennt News-Preis-Divergenz (News vorhanden, Bewegung < 0.5 %)", () => {
    const [r] = scoreIdeaCandidates([{
      symbol: "Z", name: "Z", data: { price_change_pct: 0.2 },
      hasScore: false, hasNews: true, hasEarnings: false, newsCount: 1,
    }]);
    expect(r.reasons.some(r => r.includes("Divergenz"))).toBe(true);
  });

  it("gibt 0 zurück bei leerem Input", () => {
    expect(scoreIdeaCandidates([])).toHaveLength(0);
  });
});
