import type { ConfidenceScore } from "../company-type-router";

export type AiExposureCategory =
  | "ai_infrastructure"
  | "ai_semiconductors"
  | "ai_software"
  | "ai_platform"
  | "ai_data_analytics"
  | "ai_adopter"
  | "ai_narrative_only"
  | "unknown";

export type AiExposureNarrativeInput = {
  ticker?: string;
  sector?: string;
  industry?: string;
  companyDescription?: string;
  aiRevenuePct?: number;
  aiRevenueGrowthPct?: number;
  aiBacklogPct?: number;
  aiCapexPctRevenue?: number;
  dataCenterRevenuePct?: number;
  softwareAiProductRevenuePct?: number;
  aiCustomerWinsCount?: number;
  revenueGrowthPct?: number;
  grossMarginPct?: number;
  operatingMarginPct?: number;
  freeCashFlowMarginPct?: number;
  stockBasedCompPctRevenue?: number;
  cashBurn?: number;
  cashAndEquivalents?: number;
  marketCap?: number;
  mentionsAiInDescription?: boolean;
  mentionsAiInNewsOrGuidance?: boolean;
};

export type AiExposureNarrativeOutput = {
  modelId: "ai_exposure_narrative_score";
  status: "success" | "not_run_missing_inputs" | "not_applicable" | "failed";
  category: AiExposureCategory;
  scores: {
    aiExposureScore: number;
    monetizationEvidenceScore: number;
    narrativeRiskScore: number;
    executionRiskScore: number;
  };
  classification: {
    exposureLevel: "none" | "low" | "moderate" | "high";
    monetizationStage: "none" | "early" | "proven" | "material";
    narrativeQuality: "weak" | "mixed" | "credible" | "strong";
  };
  ratingImplications: {
    canSupportBullCase: boolean;
    shouldIncreaseValuationConfidence: boolean;
    shouldDecreaseValuationConfidence: boolean;
    avoidStrongBuyWithoutProof: boolean;
    reason: string;
  };
  confidence: ConfidenceScore;
  evidence: string[];
  warnings: string[];
  limitations: string[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampConfidence(value: number): ConfidenceScore {
  if (value >= 5) return 5;
  if (value >= 4) return 4;
  if (value >= 3) return 3;
  if (value >= 2) return 2;
  return 1;
}

function text(input: AiExposureNarrativeInput): string {
  return `${input.sector ?? ""} ${input.industry ?? ""} ${input.companyDescription ?? ""}`.toLowerCase();
}

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some(needle => haystack.includes(needle));
}

function hasAiMention(input: AiExposureNarrativeInput): boolean {
  return Boolean(
    input.mentionsAiInDescription ||
    input.mentionsAiInNewsOrGuidance ||
    hasAny(text(input), [" ai ", "artificial intelligence", "machine learning", " generative ai", "accelerator", "gpu", "data center", "datacenter"]),
  );
}

function hasQuantifiedAiEvidence(input: AiExposureNarrativeInput): boolean {
  return [
    input.aiRevenuePct,
    input.aiRevenueGrowthPct,
    input.aiBacklogPct,
    input.dataCenterRevenuePct,
    input.softwareAiProductRevenuePct,
    input.aiCustomerWinsCount,
  ].some(value => isFiniteNumber(value) && value > 0);
}

function classifyCategory(input: AiExposureNarrativeInput): AiExposureCategory {
  const combined = text(input);
  if (hasAny(combined, ["semiconductor", "chip", "gpu", "accelerator", "memory", "foundry"])) return "ai_semiconductors";
  if (hasAny(combined, ["data center infrastructure", "datacenter infrastructure", "server hardware", "networking", "cooling", "power", "electrical equipment"])) return "ai_infrastructure";
  if (hasAny(combined, ["data analytics", "data platform", "ml ops", "observability", "data infrastructure"])) return "ai_data_analytics";
  if (hasAny(combined, ["cloud platform", "digital advertising", "marketplace", "hyperscaler", "large technology platform"])) return "ai_platform";
  if (hasAny(combined, ["software", "saas", "enterprise software", "automation", "application software"])) return "ai_software";
  if (hasAiMention(input) && !hasQuantifiedAiEvidence(input)) return "ai_narrative_only";
  if (hasAiMention(input)) return "ai_adopter";
  return "unknown";
}

function exposureLevel(score: number): AiExposureNarrativeOutput["classification"]["exposureLevel"] {
  if (score >= 70) return "high";
  if (score >= 40) return "moderate";
  if (score > 0) return "low";
  return "none";
}

function monetizationStage(score: number): AiExposureNarrativeOutput["classification"]["monetizationStage"] {
  if (score >= 75) return "material";
  if (score >= 50) return "proven";
  if (score >= 20) return "early";
  return "none";
}

function narrativeQuality(
  monetizationScore: number,
  narrativeRiskScore: number,
): AiExposureNarrativeOutput["classification"]["narrativeQuality"] {
  if (monetizationScore >= 75 && narrativeRiskScore < 35) return "strong";
  if (monetizationScore >= 50 && narrativeRiskScore < 50) return "credible";
  if (monetizationScore >= 20 || narrativeRiskScore < 65) return "mixed";
  return "weak";
}

export function calculateAiExposureNarrativeScore(input: AiExposureNarrativeInput): AiExposureNarrativeOutput {
  const warnings: string[] = [];
  const limitations: string[] = [];
  const evidence: string[] = [];
  const category = classifyCategory(input);
  const aiMention = hasAiMention(input);
  const quantified = hasQuantifiedAiEvidence(input);

  if (!aiMention && !quantified && category === "unknown") {
    return {
      modelId: "ai_exposure_narrative_score",
      status: "not_applicable",
      category: "unknown",
      scores: { aiExposureScore: 0, monetizationEvidenceScore: 0, narrativeRiskScore: 0, executionRiskScore: 0 },
      classification: { exposureLevel: "none", monetizationStage: "none", narrativeQuality: "weak" },
      ratingImplications: {
        canSupportBullCase: false,
        shouldIncreaseValuationConfidence: false,
        shouldDecreaseValuationConfidence: false,
        avoidStrongBuyWithoutProof: false,
        reason: "No AI-related indicators found.",
      },
      confidence: 3,
      evidence,
      warnings,
      limitations: ["No AI-related indicators are present."],
    };
  }

  if (aiMention && !quantified && category === "unknown") {
    return {
      modelId: "ai_exposure_narrative_score",
      status: "not_run_missing_inputs",
      category: "unknown",
      scores: { aiExposureScore: 10, monetizationEvidenceScore: 0, narrativeRiskScore: 80, executionRiskScore: 50 },
      classification: { exposureLevel: "low", monetizationStage: "none", narrativeQuality: "weak" },
      ratingImplications: {
        canSupportBullCase: false,
        shouldIncreaseValuationConfidence: false,
        shouldDecreaseValuationConfidence: true,
        avoidStrongBuyWithoutProof: true,
        reason: "AI is mentioned but no meaningful category, revenue, backlog, or customer evidence is available.",
      },
      confidence: 1,
      evidence: ["AI mention detected without supporting evidence."],
      warnings: ["AI exposure appears narrative-driven without sufficient monetization evidence."],
      limitations: ["AI exposure is indicated, but no quantifiable or category evidence exists."],
    };
  }

  let aiExposureScore = 0;
  if (isFiniteNumber(input.aiRevenuePct)) {
    if (input.aiRevenuePct > 20) aiExposureScore += 40;
    else if (input.aiRevenuePct >= 5) aiExposureScore += 25;
    evidence.push(`AI revenue mix available: ${input.aiRevenuePct}%.`);
  }
  if ((isFiniteNumber(input.softwareAiProductRevenuePct) && input.softwareAiProductRevenuePct > 0) ||
      (isFiniteNumber(input.aiBacklogPct) && input.aiBacklogPct > 0) ||
      (isFiniteNumber(input.aiCustomerWinsCount) && input.aiCustomerWinsCount > 0)) {
    aiExposureScore += 15;
    evidence.push("AI product, backlog, or customer-win evidence exists.");
  }
  if (isFiniteNumber(input.dataCenterRevenuePct) && input.dataCenterRevenuePct > 20) {
    aiExposureScore += 15;
    evidence.push(`Datacenter revenue exposure available: ${input.dataCenterRevenuePct}%.`);
  }
  if (category !== "unknown" && category !== "ai_narrative_only") {
    aiExposureScore += 10;
    evidence.push(`AI category classified as ${category}.`);
  }
  if (aiMention) {
    aiExposureScore += 5;
    evidence.push("AI mentioned in description/news/guidance.");
  }
  aiExposureScore = clamp100(aiExposureScore);

  let monetizationEvidenceScore = 0;
  if (isFiniteNumber(input.aiRevenuePct) && input.aiRevenuePct > 20) monetizationEvidenceScore += 55;
  else if (isFiniteNumber(input.aiRevenuePct) && input.aiRevenuePct > 0) monetizationEvidenceScore += 35;
  if (isFiniteNumber(input.aiBacklogPct) && input.aiBacklogPct > 0) monetizationEvidenceScore += 25;
  if (isFiniteNumber(input.softwareAiProductRevenuePct) && input.softwareAiProductRevenuePct > 0) monetizationEvidenceScore += 25;
  if (isFiniteNumber(input.aiCustomerWinsCount) && input.aiCustomerWinsCount > 0) monetizationEvidenceScore += Math.min(20, input.aiCustomerWinsCount * 2);
  if (aiMention && monetizationEvidenceScore === 0) monetizationEvidenceScore = 10;
  monetizationEvidenceScore = clamp100(monetizationEvidenceScore);

  let narrativeRiskScore = 20;
  if (aiMention && monetizationEvidenceScore < 20) narrativeRiskScore += 55;
  if (category === "ai_narrative_only") narrativeRiskScore += 25;
  if (isFiniteNumber(input.marketCap) && input.marketCap < 2_000_000_000 && monetizationEvidenceScore < 50) narrativeRiskScore += 15;
  if (isFiniteNumber(input.stockBasedCompPctRevenue) && input.stockBasedCompPctRevenue > 15) narrativeRiskScore += 15;
  if (isFiniteNumber(input.freeCashFlowMarginPct) && input.freeCashFlowMarginPct > 10 && monetizationEvidenceScore >= 50) narrativeRiskScore -= 20;
  narrativeRiskScore = clamp100(narrativeRiskScore);

  let executionRiskScore = 20;
  if (isFiniteNumber(input.freeCashFlowMarginPct) && input.freeCashFlowMarginPct < 0) executionRiskScore += 25;
  if (isFiniteNumber(input.cashBurn) && isFiniteNumber(input.cashAndEquivalents) && input.cashAndEquivalents > 0 && input.cashBurn / input.cashAndEquivalents > 0.4) executionRiskScore += 25;
  if (isFiniteNumber(input.aiCapexPctRevenue) && input.aiCapexPctRevenue > 15) executionRiskScore += 20;
  if (isFiniteNumber(input.grossMarginPct) && input.grossMarginPct < 35) executionRiskScore += 15;
  if (isFiniteNumber(input.operatingMarginPct) && input.operatingMarginPct < 0) executionRiskScore += 15;
  if (isFiniteNumber(input.revenueGrowthPct) && input.revenueGrowthPct > 25 && isFiniteNumber(input.freeCashFlowMarginPct) && input.freeCashFlowMarginPct < 0) executionRiskScore += 10;
  executionRiskScore = clamp100(executionRiskScore);

  if (category === "ai_narrative_only" || (aiMention && monetizationEvidenceScore < 20)) {
    warnings.push("AI exposure appears narrative-driven without sufficient monetization evidence.");
  }
  if (isFiniteNumber(input.aiCapexPctRevenue) && input.aiCapexPctRevenue > 15 && (!isFiniteNumber(input.freeCashFlowMarginPct) || input.freeCashFlowMarginPct < 5)) {
    warnings.push("AI investment may pressure free cash flow before monetization is proven.");
  }
  if (!isFiniteNumber(input.aiRevenuePct) && !isFiniteNumber(input.aiBacklogPct) && !isFiniteNumber(input.softwareAiProductRevenuePct)) {
    limitations.push("AI revenue, backlog, and AI product revenue are not quantified.");
  }

  const canSupportBullCase = monetizationEvidenceScore >= 50 && executionRiskScore < 70;
  const shouldIncreaseValuationConfidence = monetizationEvidenceScore >= 65 && executionRiskScore < 45 && (input.freeCashFlowMarginPct ?? 0) > 0;
  const shouldDecreaseValuationConfidence = narrativeRiskScore >= 65 || executionRiskScore >= 75;
  const avoidStrongBuyWithoutProof = narrativeRiskScore >= 60 || monetizationEvidenceScore < 30;

  let confidence = 3;
  if ((isFiniteNumber(input.aiRevenuePct) || isFiniteNumber(input.aiBacklogPct)) && executionRiskScore < 60 && category !== "unknown") confidence += 2;
  else if (category !== "unknown" && monetizationEvidenceScore >= 20) confidence += 1;
  if (monetizationEvidenceScore < 20) confidence -= 1;
  if (category === "ai_narrative_only") confidence -= 1;

  return {
    modelId: "ai_exposure_narrative_score",
    status: "success",
    category: category === "unknown" && aiMention ? "ai_adopter" : category,
    scores: {
      aiExposureScore,
      monetizationEvidenceScore,
      narrativeRiskScore,
      executionRiskScore,
    },
    classification: {
      exposureLevel: exposureLevel(aiExposureScore),
      monetizationStage: monetizationStage(monetizationEvidenceScore),
      narrativeQuality: narrativeQuality(monetizationEvidenceScore, narrativeRiskScore),
    },
    ratingImplications: {
      canSupportBullCase,
      shouldIncreaseValuationConfidence,
      shouldDecreaseValuationConfidence,
      avoidStrongBuyWithoutProof,
      reason: shouldDecreaseValuationConfidence
        ? "AI narrative or execution risk should reduce valuation confidence."
        : canSupportBullCase
        ? "AI exposure is supported by monetization evidence and can support the bull case."
        : "AI exposure is contextual, not strong enough to drive valuation confidence.",
    },
    confidence: clampConfidence(confidence),
    evidence,
    warnings,
    limitations,
  };
}
