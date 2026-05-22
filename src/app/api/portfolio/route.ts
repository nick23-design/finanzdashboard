import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

const addSchema = z.object({
  symbol: z.string().min(1).max(10).transform(s => s.toUpperCase().trim()),
  name: z.string().max(100).default(""),
  shares: z.number().positive(),
  purchase_price: z.number().positive(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type PortfolioPositionEnriched = {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  purchase_price: number;
  purchase_date: string;
  created_at: string;
  current_price: number | null;
  current_value: number | null;
  purchase_value: number;
  pnl: number | null;
  pnl_pct: number | null;
};

export async function GET(_request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const supabase = await createClient();
  const { data: positions, error } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!positions?.length) return NextResponse.json([]);

  const symbols = [...new Set(positions.map(p => p.symbol))];
  const priceMap: Record<string, number | null> = {};

  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const res = await fetch(`${FINANCE_API_URL}/assets/${sym}`, {
          next: { revalidate: 0 },
        });
        if (res.ok) {
          const data = await res.json();
          priceMap[sym] = data.price ?? null;
        } else {
          priceMap[sym] = null;
        }
      } catch {
        priceMap[sym] = null;
      }
    })
  );

  const enriched: PortfolioPositionEnriched[] = positions.map(p => {
    const cp = priceMap[p.symbol] ?? null;
    const purchaseValue = Number(p.purchase_price) * Number(p.shares);
    const currentValue = cp != null ? cp * Number(p.shares) : null;
    return {
      ...p,
      shares: Number(p.shares),
      purchase_price: Number(p.purchase_price),
      current_price: cp,
      current_value: currentValue,
      purchase_value: purchaseValue,
      pnl: currentValue != null ? currentValue - purchaseValue : null,
      pnl_pct: currentValue != null ? ((currentValue - purchaseValue) / purchaseValue) * 100 : null,
    };
  });

  return NextResponse.json(enriched);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const body = await request.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolio_positions")
    .insert({
      user_id: user.id,
      symbol: parsed.data.symbol,
      name: parsed.data.name,
      shares: parsed.data.shares,
      purchase_price: parsed.data.purchase_price,
      purchase_date: parsed.data.purchase_date,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
