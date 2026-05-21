# Finanzdashboard

Regelbasierte Aktienanalyse-App (MVP). Nur zu Research- und Lernzwecken.
**Keine Anlageberatung.**

## Architektur

```
Browser (Next.js App Router)
  └── /dashboard           ← geschützte Pages (SSR Auth check)
  └── /api/*               ← API Routes (Auth + Caching)
        └── Supabase DB    ← Watchlist, Snapshots, Scores (Postgres + RLS)
        └── Finance API    ← FastAPI + yfinance (localhost:8000)
```

## Setup

### 1. Supabase Projekt erstellen

1. Gehe zu https://supabase.com → Neues Projekt
2. Im SQL-Editor: Inhalt von `supabase/schema.sql` ausführen
3. Authentication → Email/Password aktivieren
4. API-Keys notieren (Settings → API)

### 2. Environment Variables

```bash
cp .env.local.example .env.local
# .env.local ausfüllen:
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhb...
SUPABASE_SERVICE_ROLE_KEY=eyJhb...   # optional, für Admin-Zugriff
```

### 3. Python Finance API starten

```bash
cd finance-api
python -m venv .venv

# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API läuft dann auf http://localhost:8000
Docs: http://localhost:8000/docs

### 4. Next.js App starten

```bash
npm install
npm run dev
```

App läuft auf http://localhost:3000

### 5. Tests ausführen

```bash
# TypeScript Tests (Scoring + Validation)
npm test

# Python Tests
cd finance-api
python -m pytest test_main.py -v
```

## Projektstruktur

```
src/
  app/
    auth/               ← Login / Signup Seiten + Server Actions
    dashboard/          ← Geschützte Dashboard-Seiten
      asset/[symbol]/   ← Detailseite pro Aktie
      search/           ← Ticker-Suche
      settings/         ← Einstellungen
    api/
      watchlist/        ← GET, POST, DELETE
      assets/[symbol]/  ← GET (mit Cache), /history
      analyze/[symbol]/ ← POST (Scoring)
  components/
    auth/               ← AuthForm
    asset/              ← AssetDetailView, PriceChart
    dashboard/          ← WatchlistView, WatchlistCard, AddTickerForm, SearchView
    layout/             ← BottomNav
    ui/                 ← Disclaimer, Skeleton, MetricCard, ScoreBadge, ScoreBar
  lib/
    supabase/           ← client.ts, server.ts, middleware.ts
    scoring/
      engine.ts         ← Scoring-Logik (0–100, gewichtet)
      __tests__/        ← Jest Tests
    finance-client.ts   ← HTTP-Client zum Finance-API
    validation.ts       ← Zod-Schemas
    api-auth.ts         ← Auth-Helper für API Routes
  types/
    database.ts         ← Supabase-Typen
    finance.ts          ← Domain-Typen
finance-api/
  main.py               ← FastAPI + yfinance
  test_main.py          ← pytest Tests
  requirements.txt
supabase/
  schema.sql            ← Tabellen + RLS + Trigger
```

## Scoring-Logik

| Bereich              | Gewicht | Indikatoren                          |
|----------------------|---------|--------------------------------------|
| Fundamental          | 40%     | KGV, Free Cashflow, Umsatzwachstum   |
| Technisch            | 30%     | RSI, Kurs vs. 50/200-MA              |
| Risiko               | 30%     | Debt/Equity, RSI-Extreme, MA-Spread  |

| Score  | Signal          |
|--------|-----------------|
| 80–100 | Bullish         |
| 60–79  | Slightly Bullish|
| 40–59  | Neutral         |
| 20–39  | Caution         |
| 0–19   | High Risk       |

## Hinweise

- Yahoo Finance via yfinance ist **inoffiziell** – für Produktion andere Datenquelle verwenden.
- Cache-TTL: 6 Stunden (konfigurierbar in den API Routes).
- Daten werden in Supabase Postgres gecacht (keine zusätzlichen Kosten).
- Datenprovider austauschbar: `src/lib/finance-client.ts` anpassen.

---

> ⚠️ Diese App stellt keine Anlageberatung dar. Alle Daten ohne Gewähr.
