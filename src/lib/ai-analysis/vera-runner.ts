/**
 * Vera-Fakten-Check — geteilte Kernlogik für den Cron (Batch) und den
 * manuellen On-Demand-Trigger.
 *
 * Enthält den eigentlichen LLM-Check (runVeraFactCheck) sowie das Mapping der
 * Vera-Issues auf das fact_check_findings-Dataset (Guardrail-Feedback-Loop).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VERA_CRON_SYSTEM_PROMPT } from "@/lib/ai-analysis/agent-prompts";
import type { VeraFactCheckResult, VeraIssueType, FactCheckStatus } from "@/types/vera";
import type { Database } from "@/types/database";

export const VERA_MODEL = "claude-sonnet-4-6";
const VERA_TIMEOUT_MS = 55_000;

type FactCheckFindingInsert = Database["public"]["Tables"]["fact_check_findings"]["Insert"];

export interface StoredAnalysis {
  id: string;
  symbol: string;
  recommendation: string;
  conviction: number;
  summary: string;
  bull_case: unknown;
  bear_case: unknown;
  growth_outlook: string;
  extra_data: unknown;
}

interface VeraIssueRaw {
  type: string;
  message: string;
  severity?: "low" | "medium" | "high";
  affectedSection?: string;
  suggestedFix?: string;
}

interface VeraRawResponse {
  issues?: VeraIssueRaw[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("");
}

function parseJSON<T>(raw: string): T {
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found");
  return JSON.parse(stripped.slice(start, end + 1)) as T;
}

function statusFromIssues(issues: VeraFactCheckResult["issues"]): FactCheckStatus {
  if (!issues.length) return "verified";
  const hasHigh = issues.some(i => (i as { severity?: string }).severity === "high");
  if (hasHigh) return "needs_revision";
  return "verified_with_warnings";
}

function maxSeverity(issues: VeraFactCheckResult["issues"]): "none" | "low" | "medium" | "high" {
  if (!issues.length) return "none";
  const sevOrder = ["low", "medium", "high"];
  let max = -1;
  for (const issue of issues) {
    const sev = (issue as { severity?: string }).severity ?? "low";
    const idx = sevOrder.indexOf(sev);
    if (idx > max) max = idx;
  }
  return (sevOrder[max] ?? "low") as "low" | "medium" | "high";
}

// ─── VERA Fact-Check (LLM) ────────────────────────────────────────────────────

export async function runVeraFactCheck(analysis: StoredAnalysis): Promise<VeraFactCheckResult> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: VERA_TIMEOUT_MS,
    maxRetries: 0,
  });

  const extra = (analysis.extra_data as Record<string, unknown>) ?? {};
  const analystConsensus = extra.analyst_consensus_range as { base?: number | null; currency?: string } | null ?? null;
  const modelValuation = extra.model_valuation_range as { base?: number | null; currency?: string } | null ?? null;
  const valuationDivergence = extra.valuation_divergence as { difference_pct?: number | null; interpretation?: string } | null ?? null;
  const businessDrivers = extra.business_drivers as { business_model_type?: string; sector_template?: string; red_flags?: string[] } | null ?? null;
  const dataQuality = extra.data_quality as { completeness_score?: number; analysis_confidence_cap?: number } | null ?? null;
  const valuationRange = extra.valuation_range as { base?: number | null; currency?: string; rationale?: string } | null ?? null;
  const entryQuality = extra.entry_quality as { label?: string } | null ?? null;
  const valuationConfidence = (extra.valuation_confidence as string | null) ?? null;
  const claims = extra.claims as Array<{ claim: string; confidence: number }> | null ?? [];

  const bullCase = Array.isArray(analysis.bull_case) ? (analysis.bull_case as string[]).join(" | ") : String(analysis.bull_case ?? "");
  const bearCase = Array.isArray(analysis.bear_case) ? (analysis.bear_case as string[]).join(" | ") : String(analysis.bear_case ?? "");

  const draftText = [
    `Symbol: ${analysis.symbol}`,
    `Empfehlung: ${analysis.recommendation} (Conviction: ${analysis.conviction}/10)`,
    `Zusammenfassung: ${analysis.summary}`,
    `Bull-Case: ${bullCase}`,
    `Bear-Case: ${bearCase}`,
    `Wachstumsausblick: ${analysis.growth_outlook}`,
    analystConsensus ? `Analystenkonsens Base: ${analystConsensus.currency} ${analystConsensus.base ?? "N/A"}` : null,
    modelValuation ? `Eigenes Modell Base: ${modelValuation.currency} ${modelValuation.base ?? "N/A"}` : null,
    valuationDivergence?.interpretation ? `Divergenz: ${valuationDivergence.interpretation}` : null,
    valuationRange ? `Valuation Range: ${valuationRange.currency} Base ${valuationRange.base ?? "N/A"} — ${valuationRange.rationale ?? ""}` : null,
    businessDrivers ? `Business Model: ${businessDrivers.business_model_type ?? "N/A"} | Template: ${businessDrivers.sector_template ?? "N/A"}` : null,
    businessDrivers?.red_flags?.length ? `Red Flags: ${businessDrivers.red_flags.slice(0, 3).join(" | ")}` : null,
    dataQuality ? `Datenbasis: ${dataQuality.completeness_score}/100 | Cap: ${dataQuality.analysis_confidence_cap}/10` : null,
    entryQuality ? `Entry Quality: ${entryQuality.label}` : null,
    valuationConfidence ? `Bewertungskonfidenz: ${valuationConfidence}` : null,
    claims.length ? `Claims (Anzahl): ${claims.length}` : null,
  ].filter(Boolean).join("\n");

  const userContent = `Prüfe diese Analyse auf die 6 VERA-Kriterien (A-F):

${draftText}

JSON-Format:
{
  "issues": [
    {
      "type": "schema|valuation_mixing|unsupported_claim|wrong_driver|stale_data|overconfident_recommendation|number_mismatch",
      "message": "Kurze Beschreibung des Problems",
      "severity": "low|medium|high",
      "affectedSection": "optional: welcher Teil betroffen",
      "suggestedFix": "optional: Vorschlag zur Korrektur"
    }
  ]
}

Wenn keine Issues gefunden: {"issues": []}`;

  const response = await client.messages.create({
    model: VERA_MODEL,
    max_tokens: 2000,
    system: VERA_CRON_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const raw = parseJSON<VeraRawResponse>(extractText(response.content));
  const issues: VeraFactCheckResult["issues"] = (raw.issues ?? []).map(i => ({
    type: (i.type as VeraIssueType) ?? "schema",
    message: i.message ?? "",
    affectedSection: i.affectedSection,
    suggestedFix: i.suggestedFix,
    severity: i.severity ?? "low",
  }));

  return {
    status: statusFromIssues(issues),
    checkedAt: new Date().toISOString(),
    severity: maxSeverity(issues),
    issues,
  };
}

// ─── Findings-Mapping (Guardrail-Feedback-Loop) ───────────────────────────────

// Vera-Issue-Typen → die festen issue_type-Werte der fact_check_findings-Tabelle.
const ISSUE_TYPE_MAP: Record<string, FactCheckFindingInsert["issue_type"]> = {
  valuation_mixing: "uebertriebener_konsens",
  unsupported_claim: "unbelegt_guidance",
  number_mismatch: "falsche_zahl",
  stale_data: "fehlende_evidenz",
  // wrong_driver, overconfident_recommendation, schema → sonstiges (Fallback)
};

function severityToConfidence(sev: "low" | "medium" | "high"): number {
  return sev === "high" ? 9 : sev === "medium" ? 7 : 5;
}

/**
 * Mappt die Vera-Issues auf fact_check_findings-Rows. review_status startet als
 * 'auto' (= ausstehend) — erst nach Nutzer-Bestätigung ('confirmed') wirken sie
 * als Guardrail (siehe fetchGuardrails).
 */
export function mapIssuesToFindings(
  issues: VeraFactCheckResult["issues"],
  symbol: string,
  analysisId: string,
): FactCheckFindingInsert[] {
  return issues.map(issue => {
    const sev = ((issue as { severity?: "low" | "medium" | "high" }).severity ?? "low");
    return {
      analysis_id: analysisId,
      symbol,
      claim: (issue.affectedSection || issue.message || "—").slice(0, 200),
      issue_type: ISSUE_TYPE_MAP[issue.type] ?? "sonstiges",
      correction: issue.suggestedFix || issue.message || "—",
      severity: sev,
      evidence_urls: [],
      confidence: severityToConfidence(sev),
      review_status: "auto",
    };
  });
}

/** Schreibt die gemappten Findings (non-critical: Fehler werden geschluckt). */
export async function persistFindings(
  supabase: SupabaseClient<Database>,
  rows: FactCheckFindingInsert[],
): Promise<void> {
  if (!rows.length) return;
  try {
    await supabase.from("fact_check_findings").insert(rows);
  } catch {
    /* Non-critical — Guardrail-Dataset ist Best-Effort. */
  }
}
