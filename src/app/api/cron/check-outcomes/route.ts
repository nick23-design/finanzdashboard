import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

type Recommendation =
  | "Kaufen"
  | "Leicht kaufen"
  | "Halten"
  | "Leicht verkaufen"
  | "Verkaufen";

function evalOutcome(
  rec: Recommendation,
  returnPct: number,
): "correct" | "neutral" | "incorrect" {
  switch (rec) {
    case "Kaufen":
      if (returnPct > 5) return "correct";
      if (returnPct < -5) return "incorrect";
      return "neutral";
    case "Leicht kaufen":
      if (returnPct > 3) return "correct";
      if (returnPct < -3) return "incorrect";
      return "neutral";
    case "Halten":
      if (Math.abs(returnPct) < 5) return "correct";
      if (Math.abs(returnPct) > 10) return "incorrect";
      return "neutral";
    case "Leicht verkaufen":
      if (returnPct < -3) return "correct";
      if (returnPct > 3) return "incorrect";
      return "neutral";
    case "Verkaufen":
      if (returnPct < -5) return "correct";
      if (returnPct > 5) return "incorrect";
      return "neutral";
    default:
      return "neutral";
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: pending } = await supabase
    .from("analysis_outcomes")
    .select("id, symbol, recommendation, price_at_analysis")
    .eq("outcome", "pending")
    .lte("check_at", new Date().toISOString())
    .limit(50);

  if (!pending?.length) return NextResponse.json({ checked: 0, updated: 0 });

  const symbols = [...new Set(pending.map(r => r.symbol))];
  const priceMap: Record<string, number | null> = {};

  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const res = await fetch(`${FINANCE_API_URL}/assets/${sym}`);
        if (res.ok) {
          const data = await res.json() as { price?: number };
          priceMap[sym] = data.price ?? null;
        }
      } catch {
        priceMap[sym] = null;
      }
    })
  );

  let updated = 0;

  for (const row of pending) {
    const currentPrice = priceMap[row.symbol];
    if (currentPrice == null || row.price_at_analysis == null) continue;

    const returnPct =
      ((currentPrice - row.price_at_analysis) / row.price_at_analysis) * 100;
    const outcome = evalOutcome(
      row.recommendation as Recommendation,
      returnPct,
    );
    await supabase
      .from("analysis_outcomes")
      .update({
        price_at_check: currentPrice,
        return_pct: parseFloat(returnPct.toFixed(2)),
        outcome,
        checked_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    updated++;
  }

  return NextResponse.json({ checked: pending.length, updated });
}
