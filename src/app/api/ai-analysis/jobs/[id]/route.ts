import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";

export const maxDuration = 10;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user, supabase } = auth;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Keine Job-ID" }, { status: 400 });

  const { data, error } = await supabase
    .from("analysis_jobs")
    .select("id, symbol, status, current_step, progress, result, error, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });
  }

  const resultObject =
    data.result && typeof data.result === "object" && !Array.isArray(data.result)
      ? data.result as Record<string, unknown>
      : null;
  const trace = Array.isArray(resultObject?.trace)
    ? resultObject.trace
    : Array.isArray(resultObject?.analysis_trace)
    ? resultObject.analysis_trace
    : [];
  const hasFinalResult =
    typeof resultObject?.recommendation === "string" &&
    typeof resultObject?.summary === "string";

  return NextResponse.json({
    id: data.id,
    symbol: data.symbol,
    status: data.status,
    current_step: data.current_step,
    progress: data.progress,
    result: hasFinalResult ? data.result : null,
    trace,
    error: data.error,
    created_at: data.created_at,
    updated_at: data.updated_at,
  });
}
