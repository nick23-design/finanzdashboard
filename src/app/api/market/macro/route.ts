import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

export interface MacroIndicator {
  key: string;
  label: string;
  value: number | null;
  change_pct: number | null;
  unit: string;
}

const MACRO_SYMBOLS = [
  { key: "vix",    symbol: "^VIX",      label: "VIX",    unit: ""  },
  { key: "tnx",    symbol: "^TNX",      label: "10J US", unit: "%" },
  { key: "dxy",    symbol: "DX-Y.NYB",  label: "USD",    unit: ""  },
  { key: "gold",   symbol: "GC=F",      label: "Gold",   unit: ""  },
  { key: "oil",    symbol: "CL=F",      label: "Öl",     unit: ""  },
];

async function fetchSymbol(symbol: string): Promise<{ price: number | null; change_pct: number | null }> {
  try {
    const res = await fetch(`${FINANCE_API_URL}/assets/${encodeURIComponent(symbol)}`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) return { price: null, change_pct: null };
    const data = await res.json();
    return { price: data.price ?? null, change_pct: data.price_change_pct ?? null };
  } catch {
    return { price: null, change_pct: null };
  }
}

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const results = await Promise.all(
    MACRO_SYMBOLS.map(async ({ key, symbol, label, unit }) => {
      const { price, change_pct } = await fetchSymbol(symbol);
      return { key, label, value: price, change_pct, unit } satisfies MacroIndicator;
    })
  );

  return NextResponse.json(results);
}
