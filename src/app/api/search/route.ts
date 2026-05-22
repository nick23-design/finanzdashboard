import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const q = request.nextUrl.searchParams.get("q") ?? "";
  if (!q || q.length < 1) return NextResponse.json([]);

  try {
    const res = await fetch(
      `${FINANCE_API_URL}/search?q=${encodeURIComponent(q)}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return NextResponse.json([]);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json([]);
  }
}
