import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string; id: string }> },
) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_analyses")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Analyse nicht gefunden" }, { status: 404 });
  }

  return NextResponse.json(data);
}
