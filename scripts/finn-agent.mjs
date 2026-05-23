/**
 * Agentischer Finn – autonomer täglicher Research-Agent
 * Läuft direkt in GitHub Actions (kein Vercel-Timeout-Limit).
 *
 * Benötigte GitHub Secrets:
 *   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINANCE_API_URL
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const FINANCE_API_URL = process.env.FINANCE_API_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// --- Validierung ---
const missing = ["FINANCE_API_URL", "ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
  .filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Fehlende Umgebungsvariablen:", missing.join(", "));
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// --- Tool-Implementierungen ---
async function getStockData(symbol) {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return { error: "Keine Daten verfügbar" };
  const d = await res.json();
  return {
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
  };
}

async function getNews(symbol) {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/google-news`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return { headlines: [] };
  const news = await res.json();
  return {
    headlines: (Array.isArray(news) ? news : [])
      .slice(0, 5)
      .map((n) => ({ title: n.title, date: n.published })),
  };
}

async function getAnalystData(symbol) {
  const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}/analyst-data`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return { error: "Keine Analystendaten" };
  const d = await res.json();
  return {
    target_mean: d.mean_target,
    target_high: d.high_target,
    buy_count: (d.strong_buy ?? 0) + (d.buy ?? 0),
    hold_count: d.hold ?? 0,
    sell_count: (d.sell ?? 0) + (d.strong_sell ?? 0),
  };
}

async function callTool(name, input) {
  const symbol = (input.symbol ?? "").toUpperCase();
  try {
    if (name === "get_stock_data") return await getStockData(symbol);
    if (name === "get_news") return await getNews(symbol);
    if (name === "get_analyst_data") return await getAnalystData(symbol);
  } catch (err) {
    return { error: err.message };
  }
  return { error: "Unbekanntes Tool" };
}

// --- Tool-Definitionen für Haiku ---
const FINN_TOOLS = [
  {
    name: "get_stock_data",
    description: "Ruft aktuelle Kursdaten, Fundamentaldaten, RSI und gleitende Durchschnitte ab",
    input_schema: {
      type: "object",
      properties: { symbol: { type: "string", description: "Aktien-Ticker (z.B. AAPL)" } },
      required: ["symbol"],
    },
  },
  {
    name: "get_news",
    description: "Ruft die neuesten Schlagzeilen für eine Aktie ab",
    input_schema: {
      type: "object",
      properties: { symbol: { type: "string", description: "Aktien-Ticker" } },
      required: ["symbol"],
    },
  },
  {
    name: "get_analyst_data",
    description: "Ruft Analysten-Kursziele und Kauf-/Verkaufsempfehlungen ab",
    input_schema: {
      type: "object",
      properties: { symbol: { type: "string", description: "Aktien-Ticker" } },
      required: ["symbol"],
    },
  },
  {
    name: "select_hot_pick",
    description: "Wählt die finale Tagesempfehlung nach abgeschlossener Recherche aus",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Aktien-Ticker der gewählten Aktie" },
        name: { type: "string", description: "Vollständiger Unternehmensname" },
        signal: { type: "string", enum: ["Kaufen", "Leicht kaufen"] },
        score: { type: "number", description: "Überzeugungswert 0–100" },
        reason: { type: "string", description: "1–2 präzise Sätze auf Deutsch" },
      },
      required: ["symbol", "name", "signal", "score", "reason"],
    },
  },
];

// --- Hauptlogik ---
async function main() {
  console.log("Finn startet Research –", new Date().toISOString());

  // Schon heute gelaufen?
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: existing } = await supabase
    .from("agent_daily_picks")
    .select("id, symbol")
    .gte("created_at", todayStart.toISOString())
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(`Heute bereits gelaufen: ${existing.symbol}. Abbruch.`);
    return;
  }

  // Kandidaten sammeln: Trending + kuratierte Wachstumsaktien
  let trending = [];
  try {
    const res = await fetch(`${FINANCE_API_URL}/trending`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      trending = data.map((d) => d.symbol).filter(Boolean).slice(0, 10);
      console.log("Trending:", trending.join(", "));
    }
  } catch (err) {
    console.warn("Trending nicht verfügbar:", err.message);
  }

  const curated = ["NVDA", "MSFT", "AAPL", "META", "GOOGL", "AMZN", "TSLA", "AVGO", "CRM", "PLTR", "SNOW", "NET", "DDOG", "COIN", "SHOP"];
  const candidates = [...new Set([...trending, ...curated])].slice(0, 20);
  console.log(`${candidates.length} Kandidaten:`, candidates.join(", "));

  // Haiku Tool-Call-Loop
  const messages = [
    {
      role: "user",
      content: `Du bist Finn, ein autonomer Investment-Research-Agent. Deine Aufgabe: den besten Hot Pick für heute identifizieren.

Kandidaten (${candidates.length} Aktien): ${candidates.join(", ")}

Vorgehen:
1. Hole Kursdaten für 5–6 vielversprechende Kandidaten (bevorzuge Momentum + Wachstum)
2. Für die besten 2–3: hole Nachrichten und Analystendaten
3. Wähle dann mit select_hot_pick deine finale Empfehlung

Fokus: Positives Momentum (RSI 45–70, Kurs über MA50), starkes Umsatzwachstum, Analystenkonsens "Kaufen". Schreibe den Grund auf Deutsch.`,
    },
  ];

  const researchLog = [];
  let finalPick = null;

  for (let turn = 0; turn < 10; turn++) {
    console.log(`\n--- Turn ${turn + 1} ---`);

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: FINN_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    const textBlock = response.content.find((b) => b.type === "text");
    if (textBlock) console.log("Finn:", textBlock.text.slice(0, 200));

    if (response.stop_reason === "end_turn" || response.stop_reason !== "tool_use") break;

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      console.log(`Tool: ${block.name}(${JSON.stringify(block.input)})`);

      if (block.name === "select_hot_pick") {
        finalPick = {
          symbol: String(block.input.symbol ?? "").toUpperCase(),
          name: String(block.input.name ?? ""),
          signal: String(block.input.signal ?? "Kaufen"),
          score: Math.round(Number(block.input.score) || 70),
          reason: String(block.input.reason ?? ""),
        };
        console.log("Finale Auswahl:", finalPick.symbol, "–", finalPick.reason);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "Auswahl gespeichert." });
        break;
      }

      const result = await callTool(block.name, block.input);
      console.log("Ergebnis:", JSON.stringify(result).slice(0, 150));
      researchLog.push({ tool: block.name, symbol: block.input.symbol ?? "" });
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }

    if (toolResults.length > 0) messages.push({ role: "user", content: toolResults });
    if (finalPick) break;
  }

  if (!finalPick) {
    console.error("Keine Empfehlung generiert.");
    process.exit(1);
  }

  // Aktuellen Kurs holen
  let price = null;
  try {
    const res = await fetch(`${FINANCE_API_URL}/assets/${finalPick.symbol}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const d = await res.json();
      price = d.price ?? null;
      if (d.name && finalPick.name === finalPick.symbol) finalPick.name = d.name;
    }
  } catch { /* ignorieren */ }

  // In Supabase speichern
  const { data: saved, error } = await supabase
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

  if (error) {
    console.error("Supabase-Fehler:", error.message);
    process.exit(1);
  }

  console.log(`\nErfolgreich gespeichert: ${saved.symbol} (Score ${saved.score}, ${researchLog.length} Research-Schritte)`);
}

main().catch((err) => {
  console.error("Fataler Fehler:", err);
  process.exit(1);
});
