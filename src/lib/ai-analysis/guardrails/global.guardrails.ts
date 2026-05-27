/**
 * Global Guardrails
 *
 * Rules that apply universally regardless of sector or company type.
 *
 * G1 — Analyst claims without structured consensus → cap confidence
 * G2 — News price targets → mark as unverified
 */

import type {
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailResult,
  GuardrailRule,
} from "./types";

// ─── G1: Analyst claims without structured consensus ─────────────────────────

/**
 * When no structured analyst consensus exists, claims sourced from "analyst"
 * have no verified backing. Cap their confidence to ≤ 4 and add a guardrail note.
 */
export const G1_AnalystClaimsWithoutConsensus: GuardrailRule = {
  id: "G1",
  scope: "global",
  severity: "warning",
  description:
    "Analyst claims present but no structured consensus — cap claim confidence to ≤ 4.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (context.hasAnalystConsensus) return false;
    return analysis.claims.some(c => c.source_type === "analyst");
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const analystClaims = analysis.claims.filter(c => c.source_type === "analyst");
    const message =
      `${analystClaims.length} Analyst-Claim(s) ohne strukturierten Analystenkonsens — Belege ungeprüft.`;

    return {
      id: "G1",
      scope: "global",
      severity: "warning",
      issueType: "analyst_consensus_missing",
      message,
      patch: {
        claimCapBySourceType: { sourceType: "analyst", cap: 4 },
        warnings: [message],
      },
    };
  },
};

// ─── G2: News price targets → label as unverified ────────────────────────────

/**
 * Price targets mentioned in news articles may be cited inaccurately or be
 * outdated. Prefix their evidence with [News-Kursziel, unverified] and add a note.
 *
 * Pattern covers:
 *   - "$123.45" / "123.45 USD" / "123 Dollar" / "123 Euro" / "€123"
 *   - "Kursziel $123" / "Kursziel 123"
 */
const NEWS_PRICE_PATTERN =
  String.raw`\$\s*[\d,.]+|\b\d{2,5}(?:[.,]\d+)?\s*(?:USD|EUR|Dollar|Euro)\b|[Kk]ursziel\s*(?:\$|€)?\s*[\d,.]+`;

export const G2_NewsPriceTargetUnverified: GuardrailRule = {
  id: "G2",
  scope: "global",
  severity: "info",
  description:
    "News claims that mention price targets → mark evidence as unverified.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const re = new RegExp(NEWS_PRICE_PATTERN);
    return analysis.claims.some(
      c =>
        c.source_type === "news" &&
        re.test(`${c.claim} ${c.evidence}`),
    );
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const re = new RegExp(NEWS_PRICE_PATTERN);
    const count = analysis.claims.filter(
      c => c.source_type === "news" && re.test(`${c.claim} ${c.evidence}`),
    ).length;

    const message =
      `${count} Kursziel(e) aus News — nur als unverified target mention zu werten, nicht als Analystenkonsens.`;

    return {
      id: "G2",
      scope: "global",
      severity: "info",
      issueType: "news_target_unverified",
      message,
      patch: {
        claimEvidencePrefix: {
          sourceType: "news",
          pattern: NEWS_PRICE_PATTERN,
          prefix: "[News-Kursziel, unverified]",
        },
        warnings: [message],
      },
    };
  },
};
