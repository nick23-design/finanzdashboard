/**
 * Manueller Vera-Fakten-Check (On-Demand).
 * Führt den Vera-Check für die neueste Analyse eines Symbols sofort aus —
 * dieselbe Kernlogik wie der 2h-Cron (@/lib/ai-analysis/vera-runner).
 */

import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  runVeraFactCheck,
  mapIssuesToFindings,
  persistFindings,
  type StoredAnalysis,
} from "@/lib/ai-analysis/vera-runner";
import type { Json } from "@/types/database";

export const maxDuration = 120;

type AiAnalysesUpdate = {
  fact_check_status?: string;
  fact_check_result?: Json | null;
  fact_checked_at?: string | null;
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  // Vera-Calls sind teuer (Sonnet) — eng begrenzen.
  const rl = rateLimit({ key: `factcheck:${user.id}`, limit: 10, windowSecs: 600 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Zu viele Fakten-Checks. Bitte warte kurz." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const { symbol: rawSymbol } = await params;
  const parsed = tickerSchema.safeParse(rawSymbol);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Ticker-Symbol" }, { status: 400 });
  }
  const symbol = parsed.data;

  const supabase = createServiceClient();

  const { data: analysis } = await supabase
    .from("ai_analyses")
    .select("id, symbol, recommendation, conviction, summary, bull_case, bear_case, growth_outlook, extra_data")
    .eq("symbol", symbol)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .single();

  if (!analysis) {
    return NextResponse.json({ error: "Keine Analyse für dieses Symbol gefunden." }, { status: 404 });
  }

  const running: AiAnalysesUpdate = { fact_check_status: "running_factcheck" };
  await supabase.from("ai_analyses").update(running as any).eq("id", analysis.id);

  try {
    const result = await runVeraFactCheck(analysis as StoredAnalysis);

    const done: AiAnalysesUpdate = {
      fact_check_status: result.status,
      fact_check_result: result as unknown as Json,
      fact_checked_at: new Date().toISOString(),
    };
    await supabase.from("ai_analyses").update(done as any).eq("id", analysis.id);

    // Findings ins Guardrail-Dataset (review_status 'auto' = ausstehend).
    await persistFindings(supabase, mapIssuesToFindings(result.issues, symbol, analysis.id));

    return NextResponse.json({ status: result.status, result });
  } catch (err) {
    const fail: AiAnalysesUpdate = { fact_check_status: "failed_factcheck", fact_checked_at: new Date().toISOString() };
    void supabase.from("ai_analyses").update(fail as any).eq("id", analysis.id);
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: `Fakten-Check fehlgeschlagen: ${message}` }, { status: 503 });
  }
}
