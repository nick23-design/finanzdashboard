import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { runAnalysisJob } from "@/app/api/ai-analysis/[symbol]/route";

export const maxDuration = 90;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Keine Job-ID" }, { status: 400 });

  const serviceClient = createServiceClient();

  const { data: job, error } = await serviceClient
    .from("analysis_jobs")
    .select("id, symbol, status, user_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });
  }

  // Idempotent — läuft nur wenn queued
  if (job.status !== "queued") {
    return NextResponse.json({ status: job.status });
  }

  await runAnalysisJob(job.id, job.symbol, user.id, serviceClient);

  return new NextResponse(null, { status: 202 });
}
