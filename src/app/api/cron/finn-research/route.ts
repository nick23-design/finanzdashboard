/*
 * Agentischer Finn – autonomer täglicher Research-Agent
 *
 * Supabase SQL (einmalig ausführen):
 *   CREATE TABLE IF NOT EXISTS public.agent_daily_picks (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     symbol TEXT NOT NULL,
 *     name TEXT NOT NULL,
 *     price NUMERIC,
 *     signal TEXT NOT NULL,
 *     score INTEGER NOT NULL,
 *     reason TEXT NOT NULL,
 *     research_log JSONB DEFAULT '[]',
 *     created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
 *   );
 *   ALTER TABLE public.agent_daily_picks ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Public read" ON public.agent_daily_picks FOR SELECT USING (true);
 *   -- Inserts only via service role (cron endpoint uses SUPABASE_SERVICE_ROLE_KEY)
 *
 * Vercel env var required: SUPABASE_SERVICE_ROLE_KEY
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const FINN_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_stock_data",
    description: "Ruft aktuelle Kursdaten, Fundamentaldaten, RSI und gleitende Durchschnitte einer Aktie ab",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Aktien-Ticker (z.B. AAPL, NVDA)" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_news",
    description: "Ruft die neuesten Schlagzeilen für eine Aktie ab",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Aktien-Ticker" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_analyst_data",
    description: "Ruft Analysten-Kursziele und Kauf-/Verkaufsempfehlungen ab",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Aktien-Ticker" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "select_hot_pick",
    description: "Wählt die finale Tagesempfehlung nach abgeschlossener Recherche aus. Nur aufrufen wenn du genug Daten gesammelt hast.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Aktien-Ticker der gewählten Aktie" },
        name: { type: "string", description: "Vollständiger Unternehmensname" },
        signal: {
          type: "string",
          enum: ["Kaufen", "Leicht kaufen"],
          description: "Handelssignal",
        },
        score: {
          type: "number",
          description: "Überzeugungswert 0–100 (Stärke des Kaufsignals)",
        },
        reason: {
          type: "string",
          description: "1–2 präzise Sätze auf Deutsch: Warum diese Aktie heute die beste Gelegenheit ist",
        },
      },
      required: ["symbol", "name", "signal", "score", "reason"],
    },
  },
];

async function callTool(name: string, input: Record<string, unknown>): Promise<string> {
  const symbol = String(input.symbol ?? "").toUpperCase();
  if (!symbol) return JSON.stringify({ error: "Kein Symbol" });

  try {
    if (name === "get_stock_data") {
      const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}`, {
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) return JSON.stringify({ error: "Keine Daten" });
      const d = await res.json();
      return JSON.stringify({
        symbol,
        name: d.name,
        price: d.price,
        change_pct_1d: d.price_change_pct,
        rsi: d.rsi,
        above_ma50: d.price != null && d.ma50 != null ? d.price > d.ma50 : null,
        above_ma200: d.price != null && d.ma200 != null ? d.price > d.ma200 : null,
        pe_ratio: d.pe_ratio,
        revenue_growth: d.revenue_growth,
        market_cap_b: d.market_cap != null ? (d.market_cap / 1e9).toFixed(1) : null,
      });
    }

    if (name === "get_news") {
      const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/google-news`, {
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) return JSON.stringify({ headlines: [] });
      const news = await res.json();
      const headlines = (Array.isArray(news) ? news : [])
        .slice(0, 5)
        .map((n: { title?: string; published?: string }) => ({
          title: n.title,
          date: n.published,
        }));
      return JSON.stringify({ headlines });
    }

    if (name === "get_analyst_data") {
      const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/analyst-data`, {
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) return JSON.stringify({ error: "Keine Analystendaten" });
      const d = await res.json();
      return JSON.stringify({
        target_mean: d.mean_target,
        target_high: d.high_target,
        buy_count: (d.strong_buy ?? 0) + (d.buy ?? 0),
        hold_count: d.hold ?? 0,
        sell_count: (d.sell ?? 0) + (d.strong_sell ?? 0),
      });
    }
  } catch {
    return JSON.stringify({ error: "Timeout oder Netzwerkfehler" });
  }

  return JSON.stringify({ error: "Unbekanntes Tool" });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  const supabase = createServiceClient();

  // Skip if already ran today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: existing } = await supabase
    .from("agent_daily_picks")
    .select("id, symbol")
    .gte("created_at", todayStart.toISOString())
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ status: "already_ran_today", symbol: existing.symbol });
  }

  // Gather candidates: trending + curated growth stocks
  let trending: string[] = [];
  try {
    const res = await fetch(`${FINANCE_API_URL}/trending`, {
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data: { symbol: string }[] = await res.json();
      trending = data.map((d) => d.symbol).filter(Boolean).slice(0, 10);
    }
  } catch { /* ignore */ }

  const curated = ["NVDA", "MSFT", "AAPL", "META", "GOOGL", "AMZN", "TSLA", "AVGO", "CRM", "PLTR", "SNOW", "NET", "DDOG", "COIN", "SHOP"];
  const candidates = [...new Set([...trending, ...curated])].slice(0, 20);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Du bist Finn, ein autonomer Investment-Research-Agent. Deine Aufgabe: den besten Hot Pick für heute identifizieren.

Kandidaten (${candidates.length} Aktien): ${candidates.join(", ")}

Vorgehen:
1. Hole Kursdaten für 5–6 vielversprechende Kandidaten (bevorzuge Momentum + Wachstum)
2. Für die besten 2–3: hole Nachrichten und Analystendaten
3. Wähle dann mit select_hot_pick deine finale Empfehlung

Fokus: Positive Momentum (RSI 45–70, Kurs über MA50), starkes Umsatzwachstum, Analystenkonsens "Kaufen". Schreibe den Grund auf Deutsch.`,
    },
  ];

  const researchLog: Array<{ tool: string; symbol: string }> = [];
  let finalPick: {
    symbol: string;
    name: string;
    signal: string;
    score: number;
    reason: string;
  } | null = null;

  for (let turn = 0; turn < 10; turn++) {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: FINN_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") break;
    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, unknown>;

      if (block.name === "select_hot_pick") {
        finalPick = {
          symbol: String(input.symbol ?? "").toUpperCase(),
          name: String(input.name ?? ""),
          signal: String(input.signal ?? "Kaufen"),
          score: Math.round(Number(input.score) || 70),
          reason: String(input.reason ?? ""),
        };
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "Auswahl gespeichert." });
        break;
      }

      const result = await callTool(block.name, input);
      researchLog.push({ tool: block.name, symbol: String(input.symbol ?? "") });
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }
    if (finalPick) break;
  }

  if (!finalPick) {
    return NextResponse.json({ error: "Keine Empfehlung generiert" }, { status: 500 });
  }

  // Fetch current price and confirm name
  let price: number | null = null;
  try {
    const res = await fetch(`${FINANCE_API_URL}/assets/${finalPick.symbol}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const d = await res.json();
      price = d.price ?? null;
      if (d.name && finalPick.name === finalPick.symbol) finalPick.name = d.name;
    }
  } catch { /* use null */ }

  const { data: saved, error: dbError } = await supabase
    .from("agent_daily_picks")
    .insert({
      symbol: finalPick.symbol,
      name: finalPick.name,
      price,
      signal: finalPick.signal,
      score: finalPick.score,
      reason: finalPick.reason,
      research_log: researchLog,
    })
    .select()
    .single();

  if (dbError || !saved) {
    return NextResponse.json({ error: "DB-Fehler", detail: dbError?.message }, { status: 500 });
  }

  return NextResponse.json({ status: "success", pick: saved, research_steps: researchLog.length });
}
