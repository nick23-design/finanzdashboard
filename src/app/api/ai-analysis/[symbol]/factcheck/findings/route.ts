/**
 * Vera-Findings einer Analyse laden (GET) und reviewen (PATCH).
 *
 * Opt-in-Loop: Findings starten als review_status 'auto' (ausstehend) und wirken
 * erst als Guardrail, wenn der Nutzer sie bestätigt ('confirmed'). Bei Bestätigung
 * eines schwerwiegenden (high) Findings wird zusätzlich der Fact-Check-Status auf
 * 'needs_revision' gesetzt und die Conviction der Analyse um 1 gesenkt.
 */

import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { tickerSchema } from "@/lib/validation";
import { createServiceClient } from "@/lib/supabase/service";

async function latestAnalysisId(
  supabase: ReturnType<typeof createServiceClient>,
  symbol: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("ai_analyses")
    .select("id")
    .eq("symbol", symbol)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .single();
  return (data as { id: string } | null)?.id ?? null;
}

function parseSymbol(raw: string): string | null {
  const parsed = tickerSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const symbol = parseSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ error: "Ungültiges Ticker-Symbol" }, { status: 400 });

  const supabase = createServiceClient();
  const analysisId = await latestAnalysisId(supabase, symbol);
  if (!analysisId) return NextResponse.json({ findings: [] });

  const { data } = await supabase
    .from("fact_check_findings")
    .select("id, claim, correction, issue_type, severity, confidence, review_status, created_at")
    .eq("analysis_id", analysisId)
    .order("confidence", { ascending: false });

  return NextResponse.json({ findings: data ?? [] });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const symbol = parseSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ error: "Ungültiges Ticker-Symbol" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { findingId?: string; action?: string };
  const { findingId, action } = body;
  if (!findingId || (action !== "confirm" && action !== "reject")) {
    return NextResponse.json({ error: "findingId und action (confirm|reject) erforderlich." }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Aktuelles Finding laden (für Idempotenz + Severity).
  const { data: finding } = await supabase
    .from("fact_check_findings")
    .select("id, analysis_id, symbol, severity, review_status")
    .eq("id", findingId)
    .single();

  if (!finding || (finding as { symbol: string }).symbol !== symbol) {
    return NextResponse.json({ error: "Finding nicht gefunden." }, { status: 404 });
  }

  const prevStatus = (finding as { review_status: string }).review_status;
  const newStatus = action === "confirm" ? "confirmed" : "rejected";

  await supabase.from("fact_check_findings").update({ review_status: newStatus } as any).eq("id", findingId);

  // Übernahme-Wirkung: erstmalige Bestätigung eines high-Findings senkt Conviction
  // und markiert die Analyse als "needs_revision".
  const severity = (finding as { severity: string }).severity;
  const analysisId = (finding as { analysis_id: string | null }).analysis_id;
  if (action === "confirm" && prevStatus !== "confirmed" && severity === "high" && analysisId) {
    const { data: analysis } = await supabase
      .from("ai_analyses")
      .select("conviction")
      .eq("id", analysisId)
      .single();
    const conviction = (analysis as { conviction: number } | null)?.conviction;
    const update: Record<string, unknown> = { fact_check_status: "needs_revision" };
    if (typeof conviction === "number") update.conviction = Math.max(1, conviction - 1);
    await supabase.from("ai_analyses").update(update as any).eq("id", analysisId);
  }

  return NextResponse.json({ ok: true, review_status: newStatus });
}
