/**
 * VERA Async Fact-Check CRON
 * Runs every 2 hours, processes up to 15 analyses with fact_check_status = 'pending_factcheck'.
 * Uses Sonnet 4.6 with the 6-point VERA spec (A-F). Kernlogik + Findings-Mapping
 * liegen in @/lib/ai-analysis/vera-runner.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  runVeraFactCheck,
  mapIssuesToFindings,
  persistFindings,
  type StoredAnalysis,
} from "@/lib/ai-analysis/vera-runner";
import type { Json } from "@/types/database";

type AiAnalysesUpdate = {
  fact_check_status?: string;
  fact_check_result?: Json | null;
  fact_checked_at?: string | null;
};

export const maxDuration = 300; // Vercel Pro

const VERA_BATCH_SIZE = 15;

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
        .update(successUpdate as any)
        .eq("id", analysis.id);

      // Findings ins Guardrail-Dataset schreiben (review_status 'auto' = ausstehend).
      await persistFindings(
        supabase,
        mapIssuesToFindings(factCheckResult.issues, analysis.symbol, analysis.id),
      );

      if (factCheckResult.status === "verified") verified++;
      else if (factCheckResult.status === "verified_with_warnings") warnings++;

    } catch (err) {
      console.error(`[VERA-CRON] Fehler bei ${analysis.symbol} (${analysis.id}):`, err instanceof Error ? err.message : String(err));
      failed++;

      const failUpdate: AiAnalysesUpdate = {
        fact_check_status: "failed_factcheck",
        fact_checked_at: ts(),
      };
      void supabase.from("ai_analyses").update(failUpdate as any).eq("id", analysis.id); // Non-critical, fire-and-forget
    }
  }

  const needsRevision = checked - verified - warnings - failed;
  console.log(`[VERA-CRON] checked: ${checked}, verified: ${verified}, warnings: ${warnings}, needs_revision: ${needsRevision}, failed: ${failed}`);

  return NextResponse.json({ checked, verified, warnings, needs_revision: needsRevision, failed });
}
