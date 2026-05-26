import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Synthesizer picks of the last 7 days
    const { data: history } = await (supabase as any)
      .from("nh_select_daily")
      .select("symbol, name, recommendation, conviction, rationale, sources, agent, created_at")
      .eq("agent", "Synthesizer")
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(14);

    // Today's scout findings
    const { data: scouts } = await (supabase as any)
      .from("nh_select_daily")
      .select("symbol, name, recommendation, conviction, rationale, sources, agent, created_at")
      .neq("agent", "Synthesizer")
      .gte("created_at", todayStart.toISOString())
      .order("conviction", { ascending: false })
      .limit(15);

    return NextResponse.json({
      history: history ?? [],
      scouts: scouts ?? [],
    });
  } catch {
    return NextResponse.json({ history: [], scouts: [] });
  }
}
