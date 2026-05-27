/**
 * Deterministic Valuation Divergence Module
 *
 * Single source of truth for:
 * - Can divergence be calculated?
 * - What upside values are allowed?
 * - May we speak of analyst consensus?
 * - Is a target news-derived or structured?
 *
 * This module is deterministic — zero LLM calls.
 * Opus receives the DivergenceResult and EXPLAINS it; it does NOT recalculate.
 */

export type ConsensusSource = "structured_consensus" | "news_derived" | "unavailable";

export interface DivergenceInput {
  /** Current market price in USD. Used for upside % calculations. */
  currentPrice?: number | null;
  analystConsensus?: {
    bear?: number | null;
    base?: number | null;
    bull?: number | null;
    /** How this consensus data was obtained. */
    source?: ConsensusSource;
    /** True if a structured analyst consensus exists for this security. */
    available: boolean;
  } | null;
  ownModel?: {
    bear?: number | null;
    base?: number | null;
    bull?: number | null;
    confidence?: "low" | "medium" | "high";
    method?: string[];
    /** True if an own valuation model was successfully built. */
    available: boolean;
  } | null;
}

export type DivergenceStatus =
  | "available"          // Both present; full calculation done
  | "missing_consensus"  // Own model only — no structured consensus
  | "missing_own_model"  // Consensus only — no own model built
  | "missing_both"       // Neither available
  | "insufficient_data"; // Both flags true but numeric data missing

export type GapLabel =
  | "own_model_more_bullish"  // ownModel > consensus  (baseGapPct < −5)
  | "consensus_more_bullish"  // consensus > ownModel  (baseGapPct >  +5)
  | "aligned"                 // |baseGapPct| < 5
  | "not_calculable";

export interface DivergenceResult {
  status: DivergenceStatus;
  /**
   * Consensus upside vs. current price in percent.
   * Only present when status === "available".
   */
  consensusUpsidePct?: number;
  /**
   * Own model upside vs. current price in percent.
   * Only present when status === "available".
   */
  ownModelUpsidePct?: number;
  /**
   * (consensusBase − modelBase) / currentPrice × 100.
   * Positive  → consensus more bullish.
   * Negative  → own model more bullish.
   * Only present when status === "available".
   */
  baseGapPct?: number;
  gapLabel?: GapLabel;
  /**
   * Deterministic, human-readable explanation seed.
   * Opus receives this and writes a German explanation — it does NOT recalculate.
   */
  explanationSeed: string;
  /** Downstream guardrail hints (Guardrail 1, 4 etc.). */
  warnings: string[];
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function buildValuationDivergence(input: DivergenceInput): DivergenceResult {
  const consensus = input.analystConsensus;
  const model = input.ownModel;

  const hasConsensus = consensus?.available === true;
  const hasModel = model?.available === true;

  // ── Case 1: Neither available ─────────────────────────────────────────────
  if (!hasConsensus && !hasModel) {
    return {
      status: "missing_both",
      explanationSeed:
        "Neither analyst consensus nor own valuation model is available. No divergence calculable.",
      warnings: [
        "No analyst consensus available — do not reference analyst price targets.",
        "No own model available — do not reference model-based valuations.",
      ],
    };
  }

  // ── Case 2: Consensus missing, own model present ──────────────────────────
  if (!hasConsensus) {
    const isNewsDerived = consensus?.source === "news_derived";
    return {
      status: "missing_consensus",
      explanationSeed: isNewsDerived
        ? "No structured analyst consensus available; only news-derived price targets were found. Own model is present but cannot be compared to analyst consensus."
        : "No structured analyst consensus available for this security. Own valuation model is present but cannot be compared to market consensus.",
      warnings: [
        "News-derived targets must not be labeled as analyst consensus.",
        "Only own model range is available; no consensus comparison is permitted.",
      ],
    };
  }

  // ── Case 3: Own model missing, consensus present ──────────────────────────
  if (!hasModel) {
    return {
      status: "missing_own_model",
      explanationSeed:
        "Analyst consensus is available but no own valuation model was built for this security. Divergence between own model and market consensus cannot be calculated.",
      warnings: [
        "Do not compare consensus to own model — own model is unavailable.",
        "Only analyst consensus range is available; treat it as market opinion, not own valuation.",
      ],
    };
  }

  // ── Case 4: Both available — validate numeric data ────────────────────────
  const price =
    typeof input.currentPrice === "number" && input.currentPrice > 0
      ? input.currentPrice
      : null;
  const cBase = typeof consensus?.base === "number" ? consensus.base : null;
  const mBase = typeof model?.base === "number" ? model.base : null;

  if (!price || cBase == null || mBase == null) {
    return {
      status: "insufficient_data",
      gapLabel: "not_calculable",
      explanationSeed:
        "Both consensus and own model are present, but base values or current market price are missing. Upside percentages and divergence gap cannot be calculated.",
      warnings: ["Insufficient numeric data to calculate divergence percentages."],
    };
  }

  // ── Case 5: Full calculation ──────────────────────────────────────────────
  const consensusUpsidePct = round1(((cBase - price) / price) * 100);
  const ownModelUpsidePct = round1(((mBase - price) / price) * 100);
  // Positive = consensus more bullish, negative = own model more bullish
  const baseGapPct = round1(((cBase - mBase) / price) * 100);

  let gapLabel: GapLabel;
  if (Math.abs(baseGapPct) < 5) {
    gapLabel = "aligned";
  } else if (baseGapPct >= 5) {
    gapLabel = "consensus_more_bullish";
  } else {
    gapLabel = "own_model_more_bullish";
  }

  const warnings: string[] = [];
  if (consensus?.source === "news_derived") {
    warnings.push(
      "Analyst consensus is news-derived, not structured data — treat with caution and do not present as authoritative consensus.",
    );
  }

  const absGap = Math.abs(baseGapPct).toFixed(1);
  let explanationSeed: string;

  if (gapLabel === "aligned") {
    explanationSeed =
      `Analyst consensus (${fmtPct(consensusUpsidePct)} upside) and own model (${fmtPct(ownModelUpsidePct)} upside) are largely aligned (gap: ${absGap}%). Both approaches point to a similar valuation.`;
  } else if (gapLabel === "consensus_more_bullish") {
    explanationSeed =
      `Analyst consensus (${fmtPct(consensusUpsidePct)} upside) is approximately ${absGap}% more optimistic than own model (${fmtPct(ownModelUpsidePct)} upside). The market consensus is more bullish than our conservative model.`;
  } else {
    // own_model_more_bullish
    explanationSeed =
      `Own model (${fmtPct(ownModelUpsidePct)} upside) is approximately ${absGap}% more bullish than analyst consensus (${fmtPct(consensusUpsidePct)} upside). Model assumptions are more optimistic than current market consensus.`;
  }

  return {
    status: "available",
    consensusUpsidePct,
    ownModelUpsidePct,
    baseGapPct,
    gapLabel,
    explanationSeed,
    warnings,
  };
}
