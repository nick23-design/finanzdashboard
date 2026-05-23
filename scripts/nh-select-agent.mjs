/**
 * NH Select – Tägliche Investitionsidee aus US-News, DE-News & Investment-Podcasts
 *
 * Architektur: 3 Scout-Agenten (parallel) → Synthesizer → Supabase
 *
 * Benötigte GitHub Secrets:
 *   ANTHROPIC_API_KEY, SUPABASE_URL (oder NEXT_PUBLIC_SUPABASE_URL),
 *   SUPABASE_SERVICE_ROLE_KEY, FINANCE_API_URL
 *
 * Supabase SQL (einmalig):
 *   CREATE TABLE IF NOT EXISTS public.nh_select_daily (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     symbol TEXT NOT NULL,
 *     name TEXT NOT NULL,
 *     price NUMERIC,
 *     signal TEXT NOT NULL,
 *     score INTEGER NOT NULL,
 *     theme TEXT NOT NULL,
 *     reason TEXT NOT NULL,
 *     sources JSONB DEFAULT '[]',
 *     created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
 *   );
 *   ALTER TABLE public.nh_select_daily ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Public read" ON public.nh_select_daily FOR SELECT USING (true);
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// --- Env-Validierung ---
const FINANCE_API_URL = process.env.FINANCE_API_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const missing = [];
if (!FINANCE_API_URL) missing.push("FINANCE_API_URL");
if (!ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
if (!SUPABASE_URL) missing.push("SUPABASE_URL oder NEXT_PUBLIC_SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (missing.length) { console.error("Fehlende Variablen:", missing.join(", ")); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// --- Quellen-Konfiguration ---
const US_SOURCES = [
  { name: "US Markets", url: "https://news.google.com/rss/search?q=stock+market+investment+opportunity&hl=en&gl=US&ceid=US:en" },
  { name: "Growth Stocks", url: "https://news.google.com/rss/search?q=growth+stocks+buy+earnings+beat&hl=en&gl=US&ceid=US:en" },
  { name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
];

const DE_SOURCES = [
  { name: "Börse & Aktien", url: "https://news.google.com/rss/search?q=Aktien+Kaufempfehlung+Wachstum&hl=de&gl=DE&ceid=DE:de" },
  { name: "Deutsche Wirtschaft", url: "https://news.google.com/rss/search?q=B%C3%B6rse+Investment+Empfehlung&hl=de&gl=DE&ceid=DE:de" },
  { name: "Handelsblatt", url: "https://www.handelsblatt.com/contentexport/feed/schlagzeilen" },
];

const PODCAST_SOURCES = [
  { name: "We Study Billionaires", url: "https://feeds.megaphone.fm/investorspodcast" },
  { name: "Motley Fool Money", url: "https://feeds.megaphone.fm/foolmoneypodcast" },
  { name: "Acquired", url: "https://feeds.simplecast.com/4T39_jAj" },
  { name: "Odd Lots (Bloomberg)", url: "https://feeds.megaphone.fm/bloomberg-odd-lots" },
  { name: "Animal Spirits", url: "https://feeds.megaphone.fm/animal-spirits" },
  { name: "Finanzfluss", url: "https://feeds.acast.com/public/shows/finanzfluss-podcast" },
  { name: "Alles auf Aktien", url: "https://news.google.com/rss/search?q=%22Alles+auf+Aktien%22+Empfehlung&hl=de&gl=DE&ceid=DE:de" },
];

// --- RSS-Parser ---
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const getField = (tag) => {
      const r = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
      return r?.[1]?.trim()
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') || null;
    };
    const linkMatch = block.match(/<link[^>]*>([^<\s]+)<\/link>/) ||
      block.match(/<link[^>]+href="([^"]+)"/) ||
      block.match(/<guid[^>]*isPermaLink="true">([^<]+)<\/guid>/);
    const title = getField("title");
    if (title) {
      items.push({
        title,
        url: linkMatch?.[1]?.trim() || null,
        description: getField("description")?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null,
      });
    }
  }
  return items.slice(0, 6);
}

function stripHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

// --- Scout-Tool ---
const SCOUT_TOOL = {
  name: "report_findings",
  description: "Meldet analysierte Quellen und das identifizierte Investment-Thema",
  input_schema: {
    type: "object",
    properties: {
      theme: { type: "string", description: "Dominantes Investment-Thema heute (1 prägnanter Satz auf Deutsch)" },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name der Quelle oder des Podcasts" },
            title: { type: "string", description: "Titel des Artikels oder der Episode" },
            url: { type: "string", description: "URL (falls vorhanden, sonst leer lassen)" },
            summary: { type: "string", description: "2–3 Sätze Zusammenfassung auf Deutsch" },
          },
          required: ["name", "title", "summary"],
        },
      },
    },
    required: ["theme", "sources"],
  },
};

// --- Scout ausführen ---
async function runScout(agentName, sources, agentRole) {
  console.log(`\n[${agentName}] Lädt Quellen...`);
  const contentBlocks = [];

  for (const source of sources) {
    try {
      const rssRes = await fetch(source.url, {
        signal: AbortSignal.timeout(9000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NH-Select/1.0)" },
      });
      if (!rssRes.ok) { console.warn(`  [${agentName}] ${source.name}: HTTP ${rssRes.status}`); continue; }

      const xml = await rssRes.text();
      const items = parseRSS(xml);
      if (!items.length) { console.warn(`  [${agentName}] ${source.name}: keine Items`); continue; }

      console.log(`  [${agentName}] ${source.name}: ${items.length} Artikel`);

      // Artikel-Text für die ersten 2 Items holen
      const enriched = await Promise.all(
        items.slice(0, 2).map(async (item) => {
          if (!item.url) return item;
          try {
            const artRes = await fetch(item.url, {
              signal: AbortSignal.timeout(8000),
              headers: { "User-Agent": "Mozilla/5.0 (compatible; NH-Select/1.0)" },
            });
            if (!artRes.ok) return item;
            return { ...item, articleText: stripHTML(await artRes.text()) };
          } catch { return item; }
        })
      );

      contentBlocks.push({ sourceName: source.name, items: enriched });
    } catch (err) {
      console.warn(`  [${agentName}] ${source.name}: ${err.message}`);
    }
  }

  if (!contentBlocks.length) {
    console.warn(`[${agentName}] Keine Quellen erreichbar`);
    return { theme: "Keine Daten", sources: [] };
  }

  const contentText = contentBlocks.map((block) => {
    const itemsText = block.items.map((item) => {
      let t = `- "${item.title}"`;
      if (item.description) t += `\n  ${item.description.slice(0, 200)}`;
      if (item.articleText) t += `\n  Volltext: ${item.articleText.slice(0, 800)}`;
      if (item.url) t += `\n  URL: ${item.url}`;
      return t;
    }).join("\n");
    return `### ${block.sourceName}\n${itemsText}`;
  }).join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    tools: [SCOUT_TOOL],
    tool_choice: { type: "any" },
    system: `Du bist der ${agentRole} für NH Select. Analysiere die bereitgestellten Inhalte. Identifiziere das wichtigste Investment-Thema des Tages und fasse relevante Quellen auf Deutsch zusammen.`,
    messages: [{ role: "user", content: `Analysiere und melde deine Erkenntnisse:\n\n${contentText}` }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use" && b.name === "report_findings");
  if (!toolUse) return { theme: "Analyse fehlgeschlagen", sources: [] };

  console.log(`[${agentName}] Thema: ${toolUse.input.theme}`);
  return toolUse.input;
}

// --- Synthese-Tools ---
const SYNTHESIS_TOOLS = [
  {
    name: "search_stocks",
    description: "Sucht nach Aktien die zu einem Investment-Thema passen",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Suchbegriff: Unternehmen, Branche oder Thema" } },
      required: ["query"],
    },
  },
  {
    name: "get_stock_data",
    description: "Ruft aktuelle Kursdaten und Fundamentaldaten einer Aktie ab",
    input_schema: {
      type: "object",
      properties: { symbol: { type: "string", description: "Aktien-Ticker" } },
      required: ["symbol"],
    },
  },
  {
    name: "select_idea",
    description: "Wählt die finale NH Select Investitionsidee nach abgeschlossener Analyse aus",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        name: { type: "string", description: "Vollständiger Unternehmensname" },
        theme_title: { type: "string", description: "Prägnanter Thementitel (max 60 Zeichen, Deutsch)" },
        signal: { type: "string", enum: ["Kaufen", "Leicht kaufen"] },
        score: { type: "number", description: "Überzeugungswert 0–100" },
        reason: { type: "string", description: "2–3 Sätze auf Deutsch: warum diese Aktie + warum genau jetzt" },
      },
      required: ["symbol", "name", "theme_title", "signal", "score", "reason"],
    },
  },
];

// --- Synthesizer ausführen ---
async function runSynthesis(usResult, deResult, podcastResult) {
  console.log("\n[Synthesizer] Startet...");

  const context = `
## US-Scout (${usResult.sources.length} Quellen)
Thema: ${usResult.theme}
${usResult.sources.map((s) => `- ${s.name}: "${s.title}"\n  ${s.summary}`).join("\n")}

## DE-Scout (${deResult.sources.length} Quellen)
Thema: ${deResult.theme}
${deResult.sources.map((s) => `- ${s.name}: "${s.title}"\n  ${s.summary}`).join("\n")}

## Podcast-Scout (${podcastResult.sources.length} Quellen)
Thema: ${podcastResult.theme}
${podcastResult.sources.map((s) => `- ${s.name}: "${s.title}"\n  ${s.summary}`).join("\n")}
`.trim();

  const messages = [{
    role: "user",
    content: `Du bist der NH Select Synthesizer. Drei unabhängige Scouts haben heute analysiert:

${context}

Vorgehen:
1. Identifiziere das stärkste übergreifende Thema (Konvergenz mehrerer Quellen = stärkeres Signal)
2. Suche mit search_stocks nach 2–3 passenden Aktien zum Thema
3. Prüfe die vielversprechendsten mit get_stock_data
4. Wähle die beste Idee mit select_idea

Fokus: Aktuelle Relevanz (warum jetzt?), klarer Katalysator, Wachstumspotenzial.`,
  }];

  let finalIdea = null;

  for (let turn = 0; turn < 8; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: SYNTHESIS_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "end_turn" || response.stop_reason !== "tool_use") break;

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      if (block.name === "select_idea") {
        finalIdea = block.input;
        console.log(`[Synthesizer] Auswahl: ${finalIdea.symbol} – "${finalIdea.theme_title}"`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "Idee gespeichert." });
        break;
      }

      let result;
      try {
        if (block.name === "search_stocks") {
          const res = await fetch(`${FINANCE_API_URL}/search?q=${encodeURIComponent(block.input.query)}`, {
            signal: AbortSignal.timeout(8000),
          });
          const data = res.ok ? await res.json() : [];
          result = data.slice(0, 8).map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange }));
        } else if (block.name === "get_stock_data") {
          const symbol = String(block.input.symbol ?? "").toUpperCase();
          const res = await fetch(`${FINANCE_API_URL}/assets/${symbol}`, { signal: AbortSignal.timeout(10000) });
          if (res.ok) {
            const d = await res.json();
            result = { symbol, name: d.name, price: d.price, rsi: d.rsi, pe_ratio: d.pe_ratio, revenue_growth: d.revenue_growth, change_pct: d.price_change_pct };
          } else { result = { error: "Keine Daten" }; }
        }
      } catch (err) { result = { error: err.message }; }

      console.log(`[Synthesizer] ${block.name}(${JSON.stringify(block.input).slice(0, 60)}): ${JSON.stringify(result).slice(0, 80)}`);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }

    if (toolResults.length > 0) messages.push({ role: "user", content: toolResults });
    if (finalIdea) break;
  }

  return finalIdea;
}

// --- Hauptlogik ---
async function main() {
  console.log("NH Select Agent startet –", new Date().toISOString());

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: existing } = await supabase
    .from("nh_select_daily")
    .select("id, symbol")
    .gte("created_at", todayStart.toISOString())
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(`Heute bereits gelaufen: ${existing.symbol}. Abbruch.`);
    return;
  }

  // 3 Scouts parallel ausführen
  console.log("\nStarte 3 Scouts parallel...");
  const [usResult, deResult, podcastResult] = await Promise.all([
    runScout("US-Scout", US_SOURCES, "US-Finanzmarkt-Scout"),
    runScout("DE-Scout", DE_SOURCES, "Deutscher Finanzmarkt-Scout"),
    runScout("Podcast-Scout", PODCAST_SOURCES, "Investment-Podcast-Scout"),
  ]);

  // Synthesizer
  const idea = await runSynthesis(usResult, deResult, podcastResult);
  if (!idea) { console.error("Keine Idee generiert."); process.exit(1); }

  // Aktuellen Kurs holen
  let price = null;
  try {
    const res = await fetch(`${FINANCE_API_URL}/assets/${idea.symbol?.toUpperCase()}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) { const d = await res.json(); price = d.price ?? null; }
  } catch { /* ignorieren */ }

  // Alle Quellen mit Agent-Label zusammenführen
  const allSources = [
    ...usResult.sources.map((s) => ({ ...s, agent: "US-Scout" })),
    ...deResult.sources.map((s) => ({ ...s, agent: "DE-Scout" })),
    ...podcastResult.sources.map((s) => ({ ...s, agent: "Podcast-Scout" })),
  ];

  const { data: saved, error } = await supabase
    .from("nh_select_daily")
    .insert({
      symbol: idea.symbol?.toUpperCase(),
      name: idea.name,
      price,
      signal: idea.signal,
      score: Math.round(Number(idea.score) || 75),
      theme: idea.theme_title,
      reason: idea.reason,
      sources: allSources,
    })
    .select()
    .single();

  if (error) { console.error("Supabase-Fehler:", JSON.stringify(error)); process.exit(1); }

  console.log(`\nErfolgreich: ${saved.symbol} – "${saved.theme}" (${allSources.length} Quellen)`);
}

main().catch((err) => { console.error("Fataler Fehler:", err); process.exit(1); });
