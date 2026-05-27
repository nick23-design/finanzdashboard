/**
 * VERA Async Fact-Check CRON
 * Runs every 2 hours, processes up to 15 analyses with fact_check_status = 'pending_factcheck'.
 * Uses Sonnet 4.6 with the 6-point VERA spec (A-F).
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import type { VeraFactCheckResult, VeraIssueType, FactCheckStatus } from "@/types/vera";
import type { Json } from "@/types/database";

type AiAnalysesUpdate = {
  fact_check_status?: string;
  fact_check_result?: Json | null;
  fact_checked_at?: string | null;
};

export const maxDuration = 300; // Vercel Pro

const VERA_MODEL = "claude-sonnet-4-6";
const VERA_TIMEOUT_MS = 55_000;
const VERA_BATCH_SIZE = 15;

// ─── Helper ───────────────────────────────────────────────────────────────────

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
  const hasHigh = issues.some(i => {
    const sev = (i as { severity?: string }).severity;
    return sev === "high";
  });
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

// ─── VERA Fact-Check Logic ────────────────────────────────────────────────────

interface StoredAnalysis {
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

export async function runVeraFactCheck(
  analysis: StoredAnalysis,
): Promise<VeraFactCheckResult> {
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

  const systemPrompt = `Du bist Vera, eine kritische Fact-Checkerin für Finanzanalysen.
Prüfe die Analyse nach diesen 6 Kriterien (A-F):

A) KONSENS-VS-MODELL-TRENNUNG: Werden Analystenkonsens und eigenes Bewertungsmodell klar getrennt?
   Fehler: Konsens-Kursziele werden als eigenes Fair-Value ausgegeben.

B) DIVERGENZPRÜFUNG: Ist die Divergenz zwischen Konsens und eigenem Modell erwähnt und korrekt beschrieben?
   Fehler: Hohe Divergenz (>20%) ohne Kommentar oder falsche Interpretation.

C) WERTTREIBERPRÜFUNG: Passen die genannten Werttreiber zum Unternehmenstyp?
   Fehler: Hyperscaler ohne AI-Capex/Margenlogik, Semis ohne Zyklus/Inventar, Growth ohne Cashburn.

D) ZAHLENKONSISTENZ: Sind Conviction, Datenbasis-Score, Valuation Confidence und Empfehlung konsistent?
   Fehler: Hohe Conviction bei lückenhafter Datenbasis (< 50%) oder "Kaufen" bei niedrigem Score.

E) KONFIDENZPRÜFUNG: Sind die Sicherheitsaussagen proportional zur Datenbasis?
   Fehler: Pseudo-präzise Kursziele bei niedrigem Completeness Score ohne Vorbehalt.

F) AKTUALITÄTSPRÜFUNG: Wirken die Daten plausibel für eine Analyse (kein offensichtlicher Zeitwiderspruch)?
   Fehler: Evidenz für stark veraltete Daten ohne Hinweis.

WICHTIG:
- Korrigiere nur was eindeutig problematisch ist. Bei Unklarheit: kein Issue.
- Bewerte Issues mit severity: "low", "medium" oder "high".
- "high" nur bei klaren, belegbaren Fehlern (z.B. Konsens als eigenes Modell ausgegeben).
- Antworte ausschließlich mit kompaktem gültigem JSON.`;

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
    system: systemPrompt,
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

  const severity = maxSeverity(issues);
  const status = statusFromIssues(issues);

  return {
    status,
    checkedAt: new Date().toISOString(),
    severity,
    issues,
  };
}

// ─── CRON Handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const ts = () => new Date().toISOString();

  // Idempotenz: sofort auf "running_factcheck" setzen um Race Conditions zu vermeiden
  const { data: pending, error: fetchError } = await supabase
    .from("ai_analyses")
    .select("id, symbol, recommendation, conviction, summary, bull_case, bear_case, growth_outlook, extra_data")
    .eq("fact_check_status", "pending_factcheck")
    .order("analyzed_at", { ascending: true })
    .limit(VERA_BATCH_SIZE);

  if (fetchError) {
    console.error("[VERA-CRON] fetch error:", fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!pending?.length) {
    console.log("[VERA-CRON] keine ausstehenden Analysen");
    return NextResponse.json({ checked: 0, verified: 0, warnings: 0, failed: 0 });
  }

  // Sofort alle als "running_factcheck" markieren — verhindert doppelte Verarbeitung
  const ids = pending.map(r => r.id);
  const runningUpdate: AiAnalysesUpdate = { fact_check_status: "running_factcheck" };
  await supabase
    .from("ai_analyses")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(runningUpdate as any)
    .in("id", ids);

  let checked = 0;
  let verified = 0;
  let warnings = 0;
  let failed = 0;

  for (const analysis of pending) {
    checked++;
    try {
      const factCheckResult = await runVeraFactCheck(analysis as StoredAnalysis);

      const successUpdate: AiAnalysesUpdate = {
        fact_check_status: factCheckResult.status,
        fact_check_result: factCheckResult as unknown as Json,
        fact_checked_at: ts(),
      };
      await supabase
        .from("ai_analyses")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(successUpdate as any)
        .eq("id", analysis.id);

      if (factCheckResult.status === "verified") verified++;
      else if (factCheckResult.status === "verified_with_warnings") warnings++;

    } catch (err) {
      console.error(`[VERA-CRON] Fehler bei ${analysis.symbol} (${analysis.id}):`, err instanceof Error ? err.message : String(err));
      failed++;

      const failUpdate: AiAnalysesUpdate = {
        fact_check_status: "failed_factcheck",
        fact_checked_at: ts(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void supabase.from("ai_analyses").update(failUpdate as any).eq("id", analysis.id); // Non-critical, fire-and-forget
    }
  }

  const needsRevision = checked - verified - warnings - failed;
  console.log(`[VERA-CRON] checked: ${checked}, verified: ${verified}, warnings: ${warnings}, needs_revision: ${needsRevision}, failed: ${failed}`);

  return NextResponse.json({ checked, verified, warnings, needs_revision: needsRevision, failed });
}
