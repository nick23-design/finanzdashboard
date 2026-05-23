import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

  let finance_api: "online" | "warming" | "offline" = "offline";
  try {
    const res = await fetch(`${FINANCE_API_URL}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    finance_api = res.ok ? "online" : "offline";
  } catch (err) {
    // Timeout = Render cold start; connection refused = truly offline
    finance_api =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
        ? "warming"
        : "offline";
  }

  return NextResponse.json({
    anthropic: hasAnthropicKey ? "online" : "offline",
    finance_api,
    checked_at: new Date().toISOString(),
  });
}
