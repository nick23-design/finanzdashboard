import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { fetchPriceHistory } from "@/lib/finance-client";
import type { AssetSnapshot } from "@/types/database";

export interface SectorData {
  name: string;
  etf: string;
  performance: number | null;
  price: number | null;
  currency: string | null;
}

const SECTORS = [
  { name: "Technologie",       etf: "XLK"  },
  { name: "Gesundheit",        etf: "XLV"  },
  { name: "Finanzen",          etf: "XLF"  },
  { name: "Energie",           etf: "XLE"  },
  { name: "Konsum (zyklisch)", etf: "XLY"  },
  { name: "Konsum (defensiv)", etf: "XLP"  },
  { name: "Industrie",         etf: "XLI"  },
  { name: "Materialien",       etf: "XLB"  },
  { name: "Immobilien",        etf: "XLRE" },
  { name: "Versorger",         etf: "XLU"  },
  { name: "Kommunikation",     etf: "XLC"  },
];

async function getSnapshot(symbol: string): Promise<AssetSnapshot | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("asset_snapshots")
    .select("*")
    .eq("symbol", symbol)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .single();
  return (data as AssetSnapshot | null) ?? null;
}

async function getPerformance(etf: string, period: string): Promise<number | null> {
  if (period === "1d") return null; // handled via snapshot.price_change_pct

  const histPeriod = period === "1w" ? "5d" : "1mo";
  try {
    const hist: { value: number }[] = await fetchPriceHistory(etf, histPeriod);
    if (!Array.isArray(hist) || hist.length < 2) return null;
    const first = hist[0].value;
    const last = hist[hist.length - 1].value;
    if (!first || first === 0) return null;
    return ((last - first) / first) * 100;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const period = request.nextUrl.searchParams.get("period") ?? "1d";

  const results = await Promise.all(
    SECTORS.map(async ({ name, etf }) => {
      const snapshot = await getSnapshot(etf);
      let performance: number | null = null;

      if (period === "1d") {
        // Use stored price_change_pct if available
        // asset_snapshots doesn't store it directly, so we try history as fallback
        performance = await getPerformance(etf, "1d").catch(() => null);
        // Actually fetch 5d history and take last 1-day change
        try {
          const hist: { value: number }[] = await fetchPriceHistory(etf, "5d");
          if (Array.isArray(hist) && hist.length >= 2) {
            const prev = hist[hist.length - 2].value;
            const curr = hist[hist.length - 1].value;
            if (prev && prev > 0) performance = ((curr - prev) / prev) * 100;
          }
        } catch { /* use null */ }
      } else {
        performance = await getPerformance(etf, period);
      }

      return {
        name,
        etf,
        performance,
        price: snapshot?.price ?? null,
        currency: snapshot?.currency ?? "USD",
      } satisfies SectorData;
    })
  );

  return NextResponse.json(results);
}
