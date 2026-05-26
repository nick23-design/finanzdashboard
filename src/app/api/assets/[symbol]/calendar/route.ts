import { NextRequest, NextResponse } from "next/server";
import { fetchEarningsCalendar } from "@/lib/finance-client";

export const maxDuration = 15;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  if (!symbol) return NextResponse.json(null);

  const data = await fetchEarningsCalendar(symbol).catch(() => null);
  return NextResponse.json(data);
}
