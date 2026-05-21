import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

interface AuthResult {
  user: User;
  supabase: Awaited<ReturnType<typeof createClient>>;
}

export async function requireAuth(): Promise<AuthResult | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  return { user, supabase };
}

export function isNextResponse(val: unknown): val is NextResponse {
  return val instanceof NextResponse;
}
