import { NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/api-auth";
import { fetchMarketIndices } from "@/lib/finance-client";

export async function GET() {
  const auth = await requireAuth();
  if (isNextResponse(auth)) return auth;

  const data = await fetchMarketIndices();
  return NextResponse.json(data);
}
