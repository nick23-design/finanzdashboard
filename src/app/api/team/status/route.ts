import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

  let financeApiOnline = false;
  try {
    const res = await fetch(`${FINANCE_API_URL}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    financeApiOnline = res.ok;
  } catch {
    financeApiOnline = false;
  }

  return NextResponse.json({
    anthropic: hasAnthropicKey ? "online" : "offline",
    finance_api: financeApiOnline ? "online" : "offline",
    checked_at: new Date().toISOString(),
  });
}
