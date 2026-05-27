/**
 * Data-Quality Guardrails
 *
 * Rules that adjust confidence, price targets, and claims based on Diana's
 * completeness score, stale fields, and missing data signals.
 *
 * Phase 1 rules (existing):
 *   G5a — Weak data basis → cap recommendation + conviction
 *   G5b — Low model confidence or thin data → remove price target
 *
 * Phase 4 rules (new):
 *   D3  — Single primary valuation source missing + high confidence → cap to "medium"
 *   D4  — No analyst consensus → mark consensus-language claims as unsupported
 *   D6  — EDGAR quarterly data missing → cap growth/margin/FCF claims to ≤5
 *   D7  — Insider + institutional data both missing → unassessable signal warning
 *   D8  — Large-cap (>50B) + dq<70 → data gaps framed as provider limitation
 *   D9  — Stale data fields present → freshness warning + conviction ≤7
 *   D11 — Missing data interpreted as negative business thesis → unsupported claim
 *   D12 — dq<60 + hard valuation language in claims → cautious note
 *
 * Coverage notes (no duplication):
 *   D1 (dq<40 → Halten + conv≤5 + target removed): G5a + G5b cover this;
 *      G5a extended to always warn when dq<40 even without rec change.
 *   D2 (dq<55 → removeTarget + conv≤6): G5b (removeTarget) + G12 (conviction) cover this.
 *   D5 (no own model → no valuation language): G10 (inference claims) + D3 (confidence) cover this.
 *   D10 (dq<70 + missingFields → visible summary): buildDataQualityGuardrails() in route.ts
 *        already produces "Fehlende Daten: …" before the guardrail engine runs.
 */

import type {
  GuardrailAnalysis,
  GuardrailContext,
  GuardrailPatch,
  GuardrailResult,
  GuardrailRule,
} from "./types";

// ─── G5a: Weak data basis ─────────────────────────────────────────────────────

/**
 * When Diana's completeness score is critically low (< 40) or weak (< 50):
 *   < 40: downgrade buy recommendations to "Halten", cap conviction to 5
 *   < 50: downgrade "Kaufen" to "Leicht kaufen", cap conviction to 6
 *
 * Conviction is always capped. A guardrail message is only added when the
 * recommendation is actually changed (matching original behaviour).
 */
export const G5a_WeakDataBasis: GuardrailRule = {
  id: "G5a",
  scope: "data_quality",
  severity: "warning",
  description:
    "Data completeness below threshold — cap conviction, downgrade bullish recommendation if needed.",

  condition(context: GuardrailContext): boolean {
    return (context.dataQualityScore ?? 100) < 50;
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const completeness = context.dataQualityScore ?? 100;
    const patch: GuardrailPatch = {};
    const warnings: string[] = [];

    if (completeness < 40) {
      patch.convictionMax = 5;
      if (
        analysis.recommendation === "Kaufen" ||
        analysis.recommendation === "Leicht kaufen"
      ) {
        patch.recommendation = "Halten";
        warnings.push(
          `Datenbasis kritisch lückenhaft (${completeness}/100) — Empfehlung auf 'Halten' begrenzt, Conviction auf ≤5 gecappt, Kursziel entfernt (via G5b).`,
        );
      } else {
        // Recommendation already defensive — still warn so D1 coverage is visible.
        warnings.push(
          `Datenbasis kritisch lückenhaft (${completeness}/100) — Conviction defensiv auf ≤5 begrenzt.`,
        );
      }
    } else {
      // 40 ≤ completeness < 50
      patch.convictionMax = 6;
      if (analysis.recommendation === "Kaufen") {
        patch.recommendation = "Leicht kaufen";
        warnings.push(
          "Empfehlung von 'Kaufen' auf 'Leicht kaufen' korrigiert — Datenbasis < 50%.",
        );
      }
    }

    if (warnings.length > 0) {
      patch.warnings = warnings;
    }

    const message =
      warnings[0] ??
      (completeness < 40
        ? `Conviction auf ≤5 gecappt — Datenbasis kritisch lückenhaft (${completeness}/100).`
        : `Conviction auf ≤6 gecappt — Datenbasis < 50%.`);

    return {
      id: "G5a",
      scope: "data_quality",
      severity: completeness < 40 ? "blocking" : "warning",
      issueType: "weak_data_quality",
      message,
      patch,
    };
  },
};

// ─── G5b: Low model confidence → remove price target ─────────────────────────

/**
 * When valuation model confidence is "low" OR completeness < 55,
 * a specific price target is unreliable and should be removed.
 *
 * Only fires when a non-null target actually exists.
 */
export const G5b_LowConfidenceTarget: GuardrailRule = {
  id: "G5b",
  scope: "data_quality",
  severity: "warning",
  description:
    "Model confidence 'low' or data completeness < 55% — remove precise price target.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (analysis.price_levels?.target == null) return false;
    const completeness = context.dataQualityScore ?? 100;
    return analysis.valuation_confidence === "low" || completeness < 55;
  },

  apply(): GuardrailResult {
    const message =
      "Präzises Kursziel entfernt — Modellkonfidenz 'low' oder Datenbasis < 55%.";
    return {
      id: "G5b",
      scope: "data_quality",
      severity: "warning",
      issueType: "overconfident_recommendation",
      message,
      patch: { removeTarget: true, warnings: [message] },
    };
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4 — Data-Quality Guardrails
// All rules below are deterministic, synchronous, and make no LLM/VERA calls.
// ══════════════════════════════════════════════════════════════════════════════

// ─── D3: Missing valuation source caps confidence ─────────────────────────────

/**
 * When exactly one of the two primary valuation sources (own model / analyst
 * consensus) is absent AND the current valuation_confidence is "high", the
 * "high" rating is not justified — cap to "medium".
 *
 * V13 handles the both-missing case (→ "low"). D3 and V13 are mutually
 * exclusive: D3 fires for exactly-one-missing, V13 for both-missing.
 *
 * Engine semantics: valuationConfidenceCap is conservative — it can only
 * lower confidence, never raise it.
 */
export const D3_ValuationInputsCapConfidence: GuardrailRule = {
  id: "D3",
  scope: "valuation",
  severity: "warning",
  description:
    "Exactly one primary valuation source missing + confidence 'high' → cap to 'medium'.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    // XOR: fire only when EXACTLY ONE source is missing
    const exactlyOneMissing = !context.hasOwnModel !== !context.hasAnalystConsensus;
    return exactlyOneMissing && analysis.valuation_confidence === "high";
  },

  apply(context: GuardrailContext): GuardrailResult {
    const missing = !context.hasOwnModel
      ? "eigenes Bewertungsmodell"
      : "strukturierter Analystenkonsens";
    const message =
      `Bewertungskonfidenz auf 'mittel' begrenzt — ${missing} fehlt. ` +
      `Hohe Konfidenz ('high') erfordert beide primären Bewertungsquellen.`;
    return {
      id: "D3",
      scope: "valuation",
      severity: "warning",
      issueType: "missing_valuation_source",
      message,
      patch: {
        valuationConfidenceCap: "medium",
        warnings: [message],
      },
    };
  },
};

// ─── D4: Missing consensus → mark consensus-language inference/metrics claims ─

/**
 * When no structured analyst consensus is available, inference and metrics
 * claims that use consensus-style language ("Analystenkonsens sieht",
 * "durchschnittliches Kursziel") have no backing and must be flagged.
 *
 * Complements G1 (which caps analyst-source claims) and G2 (which marks news
 * price targets). D4 handles inference and metrics source types.
 */
const CONSENSUS_LANGUAGE_PATTERN =
  String.raw`Analystenkonsens|Konsensziel|Konsens\s*(?:sieht|erwartet|schätzt|rechnet|target)|durchschnittliches?\s*Kursziel|mittleres?\s*Kursziel`;

export const D4_MissingConsensusLanguageInClaims: GuardrailRule = {
  id: "D4",
  scope: "data_quality",
  severity: "warning",
  description:
    "No analyst consensus → mark consensus-language inference/metrics claims as unsupported.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if (context.hasAnalystConsensus) return false;
    const re = new RegExp(CONSENSUS_LANGUAGE_PATTERN, "i");
    return analysis.claims.some(
      c =>
        (c.source_type === "inference" || c.source_type === "metrics") &&
        re.test(`${c.claim} ${c.evidence}`),
    );
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const re = new RegExp(CONSENSUS_LANGUAGE_PATTERN, "i");
    const count = analysis.claims.filter(
      c =>
        (c.source_type === "inference" || c.source_type === "metrics") &&
        re.test(`${c.claim} ${c.evidence}`),
    ).length;

    const message =
      `Kein strukturierter Analystenkonsens: ${count} konsensartige Aussage(n) in ` +
      `Inference-/Metrics-Claims ohne strukturelle Datengrundlage markiert.`;

    return {
      id: "D4",
      scope: "data_quality",
      severity: "warning",
      issueType: "missing_consensus_language",
      message,
      patch: {
        claimCapsByPattern: [
          { sourceType: "inference", pattern: CONSENSUS_LANGUAGE_PATTERN, cap: 4 },
          { sourceType: "metrics", pattern: CONSENSUS_LANGUAGE_PATTERN, cap: 4 },
        ],
        claimEvidencePrefix: {
          sourceType: "inference",
          pattern: CONSENSUS_LANGUAGE_PATTERN,
          prefix: "[Kein strukturierter Konsens]",
        },
        warnings: [message],
      },
    };
  },
};

// ─── D6: Missing EDGAR quarterly data weakens growth/margin/FCF claims ────────

/**
 * When Diana flags "EDGAR-Quartalsdaten" as missing, all growth, margin, and
 * FCF-trend claims in inference and metrics source types lack quarterly backing.
 * Cap their confidence to ≤ 5.
 *
 * Only fires when at least one matching claim has confidence > 5 (no-op guard).
 */
const GROWTH_CLAIM_PATTERN =
  String.raw`Umsatzwachstum|Margenwachstum|Margensteigerung|FCF-(?:Wachstum|Trend|Steigerung)|EPS-(?:Wachstum|Trend)|operative(?:r)?\s+(?:Marge|Cashflow|Gewinn)|Bruttomarge|Gewinnmarge|EBITDA-Marge|Nettogewinn.*Wachstum`;

export const D6_MissingFilingDataWeakensGrowthClaims: GuardrailRule = {
  id: "D6",
  scope: "data_quality",
  severity: "warning",
  description:
    "EDGAR quarterly data missing → cap growth/margin/FCF inference+metrics claims to ≤5.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    // Only fire when Diana explicitly flagged EDGAR quarterly data as missing
    if (!context.missingFields?.some(f => f.includes("EDGAR"))) return false;
    const re = new RegExp(GROWTH_CLAIM_PATTERN, "i");
    return analysis.claims.some(
      c =>
        (c.source_type === "metrics" || c.source_type === "inference") &&
        re.test(`${c.claim} ${c.evidence}`) &&
        c.confidence > 5,
    );
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const re = new RegExp(GROWTH_CLAIM_PATTERN, "i");
    const count = analysis.claims.filter(
      c =>
        (c.source_type === "metrics" || c.source_type === "inference") &&
        re.test(`${c.claim} ${c.evidence}`) &&
        c.confidence > 5,
    ).length;

    const message =
      `Fehlende EDGAR-Quartalsdaten: ${count} Wachstums-/Margenclaim(s) ohne Quartalsbelege ` +
      `vorsichtiger gewichtet (Konfidenz auf ≤5 begrenzt).`;

    return {
      id: "D6",
      scope: "data_quality",
      severity: "warning",
      issueType: "missing_filing_data",
      message,
      patch: {
        claimCapsByPattern: [
          { sourceType: "metrics", pattern: GROWTH_CLAIM_PATTERN, cap: 5 },
          { sourceType: "inference", pattern: GROWTH_CLAIM_PATTERN, cap: 5 },
        ],
        warnings: [message],
      },
    };
  },
};

// ─── D7: Missing insider + institutional data → unassessable signal ────────────

/**
 * When BOTH insider-trade data and institutional-holding data are absent, the
 * market-intelligence signal cannot be reliably assessed. "Insider neutral" or
 * "Institutionen stabil" derived from empty datasets should not be used as
 * supporting evidence.
 *
 * Only fires when both sources are explicitly absent (not just missing from
 * context — context flag defaults are handled in route.ts).
 */
export const D7_MissingInsiderDataBlocksSignal: GuardrailRule = {
  id: "D7",
  scope: "data_quality",
  severity: "info",
  description:
    "Insider AND institutional data both absent → add unassessable-signal warning.",

  condition(context: GuardrailContext): boolean {
    // Only fire when explicitly set to false (not undefined/unknown)
    return context.hasInsiderData === false && context.hasInstitutionalData === false;
  },

  apply(): GuardrailResult {
    const message =
      "Insider- und Institutionendaten fehlen: Markt-Intelligenz-Signal kann nicht zuverlässig " +
      "bewertet werden. 'Insider neutral' ist ohne Datenbasis kein positives Signal.";
    return {
      id: "D7",
      scope: "data_quality",
      severity: "info",
      issueType: "missing_market_intel_data",
      message,
      patch: { warnings: [message] },
    };
  },
};

// ─── D8: Large-cap data gaps = provider limitation, not company risk ──────────

/**
 * For large-cap companies (marketCap > 50B USD), data gaps in provider-supplied
 * fields (KGV, EDGAR, Analystenkonsens) are typically caused by ingestion or
 * coverage limitations — not by missing reporting at the company level.
 *
 * Complements V14 (which uses companyType as proxy; threshold dq < 60).
 * D8 uses marketCap as signal; threshold dq < 70 (broader).
 *
 * If marketCap is not available in context, the rule skips (no-op).
 */
const LARGE_CAP_THRESHOLD_USD = 50_000_000_000; // 50 Milliarden USD

export const D8_LargeCapDataGapIsProviderLimitation: GuardrailRule = {
  id: "D8",
  scope: "data_quality",
  severity: "info",
  description:
    "Large-cap (marketCap > 50B USD) with dq < 70 → data gaps as provider/ingestion limitation.",

  condition(context: GuardrailContext): boolean {
    if (context.marketCapUsd == null) return false;
    if (context.marketCapUsd <= LARGE_CAP_THRESHOLD_USD) return false;
    return (context.dataQualityScore ?? 100) < 70;
  },

  apply(context: GuardrailContext): GuardrailResult {
    const dq = context.dataQualityScore ?? 0;
    const mcapB = context.marketCapUsd != null
      ? `${(context.marketCapUsd / 1_000_000_000).toFixed(0)} Mrd. USD`
      : "Large Cap";
    const message =
      `Large-Cap-Datenlücken (Marktkapitalisierung ${mcapB}, Datenbasis ${dq}/100) als ` +
      `Datenprovider-/Ingestion-Limitation markiert — kein Indikator für operatives Unternehmensrisiko.`;
    return {
      id: "D8",
      scope: "data_quality",
      severity: "info",
      issueType: "large_cap_provider_limitation",
      message,
      patch: { warnings: [message] },
    };
  },
};

// ─── D9: Stale data → freshness warning + conviction cap ─────────────────────

/**
 * When Diana detects stale data fields (stale_fields.length > 0), time-sensitive
 * conclusions (especially short-term price calls) may be outdated.
 * Cap conviction to ≤ 7 and add a freshness warning.
 */
export const D9_StaleDataFreshnessWarning: GuardrailRule = {
  id: "D9",
  scope: "data_quality",
  severity: "warning",
  description:
    "Stale data fields present → freshness warning + conviction cap to 7.",

  condition(context: GuardrailContext): boolean {
    return (context.staleFieldCount ?? 0) > 0;
  },

  apply(context: GuardrailContext): GuardrailResult {
    const count = context.staleFieldCount ?? 1;
    const message =
      `${count} veraltete${count === 1 ? "s" : ""} Datenfeld${count === 1 ? "" : "er"} erkannt — ` +
      `ein Teil der Daten wirkt veraltet. Kurzfristige Aussagen wurden vorsichtiger gewichtet. Conviction begrenzt.`;
    return {
      id: "D9",
      scope: "data_quality",
      severity: "warning",
      issueType: "stale_data",
      message,
      patch: {
        convictionMax: 7,
        warnings: [message],
      },
    };
  },
};

// ─── D11: Missing data must not create a negative business thesis ─────────────

/**
 * Missing data (EDGAR gaps, absent consensus, incomplete filings) can limit
 * analytical confidence — but it is NOT evidence of operational risk at the
 * company level. Claims that interpret data gaps as negative company signals
 * are unsupported and should be flagged.
 *
 * Pattern covers phrases like:
 *   "fehlende Daten zeigen Risiko"
 *   "Datenlücken sprechen gegen"
 *   "fehlender Konsens ist negativ"
 *   "Datenlücken als Warnsignal"
 */
const MISSING_DATA_NEGATIVE_PATTERN =
  String.raw`fehlend[e]?\s+Daten?\s+(?:zeig|deutet?|belast|sprechen?\s+gegen|indiziert?|signalisiert?)` +
  String.raw`|Datenlücken?\s+(?:sprechen|deuten|belast|negativ|Risiko)` +
  String.raw`|fehlend[e]?\s+(?:Konsens?|EDGAR|Quartalsdaten?|Analyst)\s+(?:ist|wirkt?|deutet?)\s+(?:negativ|schlecht|unvorteilhaft|problematisch)` +
  String.raw`|Datenlücken?\s+als\s+(?:Risiko|Warnsignal|negatives?\s+Signal)`;

export const D11_MissingDataNotNegativeThesis: GuardrailRule = {
  id: "D11",
  scope: "data_quality",
  severity: "warning",
  description:
    "Claim interprets missing data as negative company signal → mark as unsupported.",

  condition(_context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    const re = new RegExp(MISSING_DATA_NEGATIVE_PATTERN, "i");
    return analysis.claims.some(c => re.test(`${c.claim} ${c.evidence}`));
  },

  apply(_context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const re = new RegExp(MISSING_DATA_NEGATIVE_PATTERN, "i");
    const count = analysis.claims.filter(c => re.test(`${c.claim} ${c.evidence}`)).length;

    const message =
      `${count} Claim(s) interpretiert Datenlücken als Unternehmensrisiko — als ungestützt markiert. ` +
      `Datenlücken begrenzen die Analysekonfidenz, sind aber kein eigenständiges operatives Risiko.`;

    return {
      id: "D11",
      scope: "data_quality",
      severity: "warning",
      issueType: "missing_data_negative_thesis",
      message,
      patch: {
        claimCapsByPattern: [
          { sourceType: "inference", pattern: MISSING_DATA_NEGATIVE_PATTERN, cap: 3 },
          { sourceType: "metrics", pattern: MISSING_DATA_NEGATIVE_PATTERN, cap: 3 },
          { sourceType: "news", pattern: MISSING_DATA_NEGATIVE_PATTERN, cap: 3 },
        ],
        warnings: [message],
      },
    };
  },
};

// ─── D12: Weak data quality + hard valuation language → cautious note ─────────

/**
 * When data quality is below 60 AND claims contain hard valuation-certainty
 * language ("klar unterbewertet", "fairer Wert ist", "Kursziel ist"), the
 * level of certainty is not justified by the underlying data.
 *
 * Cap those claims' confidence to ≤ 5 and add a cautious-language note.
 * Only fires when at least one matching claim has confidence > 5 (no-op guard).
 */
const HARD_VALUATION_LANGUAGE_PATTERN =
  String.raw`klar(?:er?|e)?\s+unterbewertet` +
  String.raw`|eindeutig\s+(?:unter|über)bewertet` +
  String.raw`|fairer?\s+Wert\s+(?:ist|beträgt|liegt\s+bei)` +
  String.raw`|Kursziel\s+(?:ist|liegt\s+bei|beträgt)` +
  String.raw`|fair\s+value\s+(?:is|is\s+at|beträgt|liegt\s+bei)` +
  String.raw`|sicher(?:er?|e)?\s+unterbewertet` +
  String.raw`|deutlich\s+unterbewertet\s+(?:auf\s+Basis|gemäß|laut)`;

export const D12_WeakDataLanguage: GuardrailRule = {
  id: "D12",
  scope: "data_quality",
  severity: "info",
  description:
    "dq < 60 + hard certainty-valuation language in inference/metrics claims → cautious note + cap to ≤5.",

  condition(context: GuardrailContext, analysis: GuardrailAnalysis): boolean {
    if ((context.dataQualityScore ?? 100) >= 60) return false;
    const re = new RegExp(HARD_VALUATION_LANGUAGE_PATTERN, "i");
    return analysis.claims.some(
      c =>
        (c.source_type === "inference" || c.source_type === "metrics") &&
        re.test(`${c.claim} ${c.evidence}`) &&
        c.confidence > 5,
    );
  },

  apply(context: GuardrailContext, analysis: GuardrailAnalysis): GuardrailResult {
    const dq = context.dataQualityScore ?? 0;
    const re = new RegExp(HARD_VALUATION_LANGUAGE_PATTERN, "i");
    const count = analysis.claims.filter(
      c =>
        (c.source_type === "inference" || c.source_type === "metrics") &&
        re.test(`${c.claim} ${c.evidence}`) &&
        c.confidence > 5,
    ).length;

    const message =
      `Schwache Datenbasis (${dq}/100): ${count} Bewertungs-Claim(s) mit harter Gewissheitssprache ` +
      `("klar unterbewertet", "fairer Wert ist") als szenariobasiert und vorsichtig eingestuft. Konfidenz auf ≤5 begrenzt.`;

    return {
      id: "D12",
      scope: "data_quality",
      severity: "info",
      issueType: "weak_data_valuation_language",
      message,
      patch: {
        claimCapsByPattern: [
          { sourceType: "inference", pattern: HARD_VALUATION_LANGUAGE_PATTERN, cap: 5 },
          { sourceType: "metrics", pattern: HARD_VALUATION_LANGUAGE_PATTERN, cap: 5 },
        ],
        warnings: [message],
      },
    };
  },
};

// ─── Phase 4 rule array (for index.ts) ───────────────────────────────────────

/**
 * All Phase 4 data-quality rules in execution order.
 * Run after Phase 3 (V1–V14) guardrails.
 *
 * D3 runs first: sets valuationConfidenceCap="medium" when one source missing.
 * D3 and V13 are mutually exclusive (D3: exactly-one-missing; V13: both-missing).
 */
export const DATA_QUALITY_PHASE4_RULES: GuardrailRule[] = [
  D3_ValuationInputsCapConfidence,
  D4_MissingConsensusLanguageInClaims,
  D6_MissingFilingDataWeakensGrowthClaims,
  D7_MissingInsiderDataBlocksSignal,
  D8_LargeCapDataGapIsProviderLimitation,
  D9_StaleDataFreshnessWarning,
  D11_MissingDataNotNegativeThesis,
  D12_WeakDataLanguage,
];
