import type { MarketIndex } from "./finance-client";

// ─── Sanitize: safe string substitutions ────────────────────────────────────

const ADVICE_REPLACEMENTS: [RegExp, string][] = [
  [/\bGewinnchancen?\b/gi, "Research-Potenzial"],
  [/\bRenditepotenzial\b/gi, "Research-Potenzial"],
  [/\bKaufgelegenheit(?:en)?\b/gi, "Research-Idee"],
  [/\bEinstiegschancen?\b/gi, "Research-Idee"],
  [/\bKaufsignale?\b/gi, "Analysesignal"],
  [/\bInvestitionschancen?\b/gi, "Research-Idee"],
];

// Sector claims that require actual sector-ETF data to be credible
const SECTOR_REPLACEMENTS: [RegExp, string][] = [
  [
    /(?:der\s+)?Technologie(?:-)Sektor\s+(?:steht\s+)?unter\s+Druck/gi,
    "Einzelne große Tech-Werte aus der Watchlist zeigen Schwäche",
  ],
  [
    /(?:der\s+)?Tech(?:-)Sektor\s+(?:steht\s+)?unter\s+Druck/gi,
    "Einzelne Tech-Werte zeigen Schwäche",
  ],
  [
    /(?:der\s+)?Technologie(?:-)Sektor\s+(?:gibt\s+nach|fällt|schwächelt)/gi,
    "Einzelne Tech-Werte geben nach",
  ],
  [
    /(?:Halbleiter|Finanz|Energie|Gesundheits|Rohstoff)(?:-)Sektor\s+(?:unter\s+Druck|gibt\s+nach|fällt)/gi,
    "Einzelne Werte in diesem Bereich geben nach",
  ],
];

// Known hallucinated / garbled terms
const TERM_REPLACEMENTS: [RegExp, string][] = [
  [/Sentimentfoldern?\b/gi, "Sentimentfaktoren"],
  [/\bSentimentfolger\b/gi, "Sentimentfaktoren"],
  [/Kurspotential\b/gi, "Kursentwicklung"],
  [/\bMarktstimmungsfolder\b/gi, "Marktstimmung"],
];

export interface SanitizeResult {
  text: string;
  changes: string[];
}

export function sanitizeText(text: string, hasSectorData: boolean): SanitizeResult {
  let result = text;
  const changes: string[] = [];

  for (const [pattern, replacement] of ADVICE_REPLACEMENTS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) changes.push(`Anlagesprache → "${replacement}"`);
  }

  if (!hasSectorData) {
    for (const [pattern, replacement] of SECTOR_REPLACEMENTS) {
      const before = result;
      result = result.replace(pattern, replacement);
      if (result !== before) changes.push("Sektor-Aussage abgeschwächt (keine ETF-Daten)");
    }
  }

  for (const [pattern, replacement] of TERM_REPLACEMENTS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) changes.push(`Begriff korrigiert → "${replacement}"`);
  }

  return { text: result, changes };
}

// ─── Index direction validation + patching ───────────────────────────────────

const NEG_WORDS = [
  "gibt nach", "gab nach", "fällt", "fiel", "im Minus", "schwächer", "Verluste",
  "Rückgang", "gesunken", "abgegeben", "unter Druck", "verliert",
];
const POS_WORDS = [
  "steigt", "stieg", "legt zu", "legte zu", "im Plus", "Gewinne",
  "aufwärts", "gestiegen", "zulegen", "zulegte", "erholt",
];

// Correction maps: wrong direction word → correct neutral alternative
const NEG_TO_POS: Record<string, string> = {
  "gibt nach": "legt zu",
  "gab nach":  "legte zu",
  "fällt":     "steigt",
  "fiel":      "stieg",
  "im minus":  "im Plus",
  "schwächer": "fester",
  "verluste":  "Gewinne",
  "rückgang":  "Zuwachs",
  "gesunken":  "gestiegen",
  "abgegeben": "zugelegt",
  "unter druck": "mit Aufwärtstendenz",
  "verliert":  "gewinnt",
};
const POS_TO_NEG: Record<string, string> = {
  "steigt":    "gibt nach",
  "stieg":     "gab nach",
  "legt zu":   "gibt nach",
  "legte zu":  "gab nach",
  "im plus":   "im Minus",
  "gewinne":   "Verluste",
  "aufwärts":  "abwärts",
  "gestiegen": "gefallen",
  "zulegen":   "nachgeben",
  "zulegte":   "gab nach",
  "erholt":    "unter Druck",
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface IndexWarning {
  index: string;
  actual: "positiv" | "negativ";
  warning: string;
}

export function validateIndexClaims(text: string, indices: MarketIndex[]): IndexWarning[] {
  const warnings: IndexWarning[] = [];

  for (const idx of indices) {
    if (idx.change_pct == null) continue;
    const nameEsc = escapeRegex(idx.name);
    const window = 70;

    if (idx.change_pct > 0.1) {
      for (const neg of NEG_WORDS) {
        const pattern = new RegExp(
          `(?:${nameEsc}.{0,${window}}${escapeRegex(neg)}|${escapeRegex(neg)}.{0,${window}}${nameEsc})`,
          "i",
        );
        if (pattern.test(text)) {
          warnings.push({
            index: idx.name,
            actual: "positiv",
            warning: `${idx.name} ist +${idx.change_pct.toFixed(2)}%, Text enthält aber "${neg}"`,
          });
          break;
        }
      }
    } else if (idx.change_pct < -0.1) {
      for (const pos of POS_WORDS) {
        const pattern = new RegExp(
          `(?:${nameEsc}.{0,${window}}${escapeRegex(pos)}|${escapeRegex(pos)}.{0,${window}}${nameEsc})`,
          "i",
        );
        if (pattern.test(text)) {
          warnings.push({
            index: idx.name,
            actual: "negativ",
            warning: `${idx.name} ist ${idx.change_pct.toFixed(2)}%, Text enthält aber "${pos}"`,
          });
          break;
        }
      }
    }
  }

  return warnings;
}

/**
 * Patches direction-contradicting words in text based on actual index data.
 * Only replaces the specific occurrence within the proximity window of the
 * index name — not all global occurrences of the word.
 */
export function patchIndexDirections(text: string, indices: MarketIndex[]): SanitizeResult {
  let result = text;
  const changes: string[] = [];

  for (const idx of indices) {
    if (idx.change_pct == null) continue;
    const nameEsc = escapeRegex(idx.name);
    const win = 70;

    const patchWords = (words: string[], map: Record<string, string>, sign: string) => {
      for (const word of words) {
        const wordEsc = escapeRegex(word);
        // Capture groups: (pre)(word) for index-first, (word)(post) for word-first
        const pattern = new RegExp(
          `(${nameEsc}[\\s\\S]{0,${win}})(${wordEsc})|(${wordEsc})([\\s\\S]{0,${win}}${nameEsc})`,
          "gi",
        );
        let matched = false;
        const replacement = map[word.toLowerCase()] ?? "verändert sich";
        const patched = result.replace(pattern, (_m, pre, w1, w2, post) => {
          matched = true;
          return pre !== undefined ? pre + replacement : replacement + post;
        });
        if (matched) {
          result = patched;
          changes.push(`Richtung korrigiert: "${word}" → "${replacement}" (${idx.name} ${sign})`);
          break;
        }
      }
    };

    if (idx.change_pct > 0.1) {
      patchWords(NEG_WORDS, NEG_TO_POS, `+${idx.change_pct.toFixed(2)}%`);
    } else if (idx.change_pct < -0.1) {
      patchWords(POS_WORDS, POS_TO_NEG, `${idx.change_pct.toFixed(2)}%`);
    }
  }

  return { text: result, changes };
}

// ─── Data quality ─────────────────────────────────────────────────────────────

export type DataQuality = "gut" | "eingeschränkt" | "schwach";

export function assessDataQuality(params: {
  assetsWithPrice: number;
  watchlistTotal: number;
  newsCount: number;
  indicesCount: number;
  scoresCount: number;
}): DataQuality {
  const ratio = params.watchlistTotal > 0 ? params.assetsWithPrice / params.watchlistTotal : 0;
  if (ratio >= 0.8 && params.indicesCount >= 3 && params.newsCount >= 2 && params.scoresCount >= 1) {
    return "gut";
  }
  if (ratio >= 0.4 && params.indicesCount >= 1) {
    return "eingeschränkt";
  }
  return "schwach";
}

// ─── Idee-des-Tages candidate scoring ────────────────────────────────────────

export interface IdeaCandidate {
  symbol: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface IdeaInput {
  symbol: string;
  name: string;
  data: { price_change_pct?: number | null; rsi?: number | null } | null;
  hasScore: boolean;
  hasNews: boolean;
  hasEarnings: boolean;
  newsCount: number;
}

export function scoreIdeaCandidates(candidates: IdeaInput[]): IdeaCandidate[] {
  return candidates
    .map(c => {
      let score = 0;
      const reasons: string[] = [];
      const pct = c.data?.price_change_pct ?? 0;
      const absPct = Math.abs(pct);

      if (absPct >= 1.5) {
        score += Math.min(absPct * 2, 12);
        reasons.push(`Bewegung: ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`);
      }

      if (c.hasNews) {
        score += 3;
        if (c.newsCount >= 2) score += 1;
        reasons.push("News vorhanden");
        // Interesting divergence: news but price barely moved
        if (absPct < 0.5) {
          score += 2;
          reasons.push("News bei stabiler Kursbewegung (Divergenz prüfen)");
        }
      }

      if (c.hasScore) { score += 2; reasons.push("Analyse-Score vorhanden"); }

      if (c.data?.rsi != null) {
        if (c.data.rsi > 78) { score += 4; reasons.push(`RSI überkauft: ${c.data.rsi.toFixed(0)}`); }
        else if (c.data.rsi < 28) { score += 4; reasons.push(`RSI überverkauft: ${c.data.rsi.toFixed(0)}`); }
        else if (c.data.rsi > 70) { score += 2; reasons.push(`RSI erhöht: ${c.data.rsi.toFixed(0)}`); }
        else if (c.data.rsi < 35) { score += 2; reasons.push(`RSI niedrig: ${c.data.rsi.toFixed(0)}`); }
      }

      if (c.hasEarnings) { score += 3; reasons.push("Earnings in Kürze"); }

      return { symbol: c.symbol, name: c.name, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}
