import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface RadarSignalRow {
  symbol: string;
  signal_type: string;
  description: string;
  confidence: number;
  source: string;
  found_at: string;
}

interface NHSelectResult {
  symbol: string;
  name?: string;
  recommendation: string;
  conviction: number;
  rationale: string;
  sources: string[];
  agent: string;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // 1. Fetch recent radar signals (last 48h)
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const { data: radarSignals } = await (supabase as any)
    .from("radar_signals")
    .select("symbol, signal_type, description, confidence, source, found_at")
    .gte("found_at", since)
    .order("confidence", { ascending: false })
    .limit(20) as { data: RadarSignalRow[] | null };

  // 2. Fetch recent scout sources (last 48h)
  const { data: scoutSources } = await (supabase as any)
    .from("nh_select_daily")
    .select("symbol, recommendation, rationale, agent, created_at")
    .gte("created_at", since)
    .neq("agent", "Synthesizer")
    .order("created_at", { ascending: false })
    .limit(15) as { data: { symbol: string; recommendation: string; rationale: string; agent: string; created_at: string }[] | null };

  const radarText = radarSignals?.length
    ? radarSignals.map(s =>
        `${s.symbol} [${s.signal_type}, Konfidenz ${s.confidence}/10]: ${s.description} (${s.source})`
      ).join("\n")
    : "Keine Radar-Signale vorhanden.";

  const scoutText = scoutSources?.length
    ? scoutSources.map(s =>
        `${s.symbol} von ${s.agent}: ${s.recommendation} — ${s.rationale}`
      ).join("\n")
    : "Keine Scout-Ergebnisse vorhanden.";

  // 3. Fetch current prices for all candidate symbols before calling Opus
  const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";
  const candidateSymbols = [
    ...new Set([
      ...(radarSignals ?? []).map(s => s.symbol),
      ...(scoutSources ?? []).map(s => s.symbol),
    ]),
  ];

  const priceMap: Record<string, number | null> = {};
  await Promise.all(
    candidateSymbols.map(async (sym) => {
      try {
        const res = await fetch(`${FINANCE_API_URL}/assets/${sym}`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          const d = await res.json() as { price?: number };
          priceMap[sym] = d.price ?? null;
        } else {
          priceMap[sym] = null;
        }
      } catch {
        priceMap[sym] = null;
      }
    })
  );

  const priceText = candidateSymbols
    .filter(s => priceMap[s] != null)
    .map(s => `${s}: $${(priceMap[s] as number).toFixed(2)}`)
    .join(" | ");

  // 4. Opus synthesizes NH Select pick
  const today = new Date().toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric"
  });

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    thinking: { type: "enabled", budget_tokens: 2000 },
    system: `Du bist Opus, der leitende Investment-Stratege von NextHorizon. Deine Aufgabe ist die tägliche NH-Select-Empfehlung: die eine vielversprechendste Aktie des Tages, basierend auf Radar-Signalen und Scout-Recherchen.

Berücksichtige die aktuellen Kurse bei der Entscheidung: Aktien die bereits stark gestiegen sind (mögliche Überhitzung) oder nahe Widerständen notieren sind kritisch zu bewerten.

Antworte ausschließlich als JSON-Objekt.`,
    messages: [{
      role: "user",
      content: `Heute ist ${today}.

RADAR-SIGNALE (letzte 48h):
${radarText}

SCOUT-RECHERCHEN (letzte 48h):
${scoutText}
${priceText ? `\nAKTUELLE KURSE:\n${priceText}` : ""}

Wähle die eine beste Aktie als NH Select für heute. Format:
{
  "symbol": "TICKER",
  "name": "Unternehmensname",
  "recommendation": "Kaufen|Leicht kaufen|Halten",
  "conviction": 1-10,
  "rationale": "Begründung auf Deutsch (2-3 Sätze)",
  "sources": ["Quelle 1", "Quelle 2"]
}`,
    }],
  });

  // Parse result
  let pick: Omit<NHSelectResult, "agent" | "created_at"> | null = null;
  for (const block of response.content) {
    if (block.type === "text") {
      const match = block.text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          pick = JSON.parse(match[0]) as Omit<NHSelectResult, "agent" | "created_at">;
        } catch { /* ignore */ }
      }
      break;
    }
  }

  if (!pick) {
    return NextResponse.json({ error: "Opus konnte keine Empfehlung generieren" }, { status: 500 });
  }

  // 5. Save to nh_select_daily — price already fetched in priceMap above
  const priceAtPick: number | null = priceMap[pick.symbol] ?? null;
  const row = {
    ...pick,
    agent: "Synthesizer",
    created_at: new Date().toISOString(),
    price_at_pick: priceAtPick,
  };
  const { error } = await (supabase as any).from("nh_select_daily").insert(row);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 6. Mark used radar signals
  if (radarSignals?.length) {
    const usedSymbols = [pick.symbol];
    await (supabase as any)
      .from("radar_signals")
      .update({ used_in_select: true })
      .in("symbol", usedSymbols)
      .gte("found_at", since);
  }

  // 7. Send push notifications
  try {
    const webPush = await import("web-push");
    const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:nick.muetze@gmail.com";

    if (vapidPublic && vapidPrivate) {
      webPush.default.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
      const { data: subs } = await (supabase as any)
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .limit(500);

      if (subs?.length) {
        const payload = JSON.stringify({
          title: `NH Select: ${pick.symbol}`,
          body: `${pick.recommendation} · Überzeugung ${pick.conviction}/10`,
          url: `/dashboard/asset/${pick.symbol}?from=nh-select`,
        });

        await Promise.allSettled(
          subs.map((s: { endpoint: string; p256dh: string; auth: string }) =>
            webPush.default.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload
            )
          )
        );
      }
    }
  } catch { /* Push-Fehler dürfen den Cron nicht abbrechen */ }

  return NextResponse.json({ success: true, symbol: pick.symbol, conviction: pick.conviction });
}
