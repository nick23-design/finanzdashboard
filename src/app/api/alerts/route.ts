import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const addSchema = z.object({
  symbol: z.string().min(1).max(10).transform(s => s.toUpperCase().trim()),
  name: z.string().max(100).default(""),
  target_price: z.number().positive(),
  direction: z.enum(["above", "below"]),
});

export async function GET(_request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;
  const { user } = auth;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_alerts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
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
    .from("price_alerts")
    .insert({
      user_id: user.id,
      symbol: parsed.data.symbol,
      name: parsed.data.name,
      target_price: parsed.data.target_price,
      direction: parsed.data.direction,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
