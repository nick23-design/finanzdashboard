-- ============================================================
-- Finanzdashboard – Supabase Schema (vollständig)
-- Run this in the Supabase SQL Editor (Project > SQL Editor)
-- Idempotent: alle Statements nutzen IF NOT EXISTS / OR REPLACE
-- ============================================================

create extension if not exists "uuid-ossp";

-- -------------------------------------------------------
-- 1. profiles
-- -------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- -------------------------------------------------------
-- 2. watchlist_items
-- -------------------------------------------------------
create table if not exists public.watchlist_items (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  symbol     text not null,
  name       text not null default '',
  created_at timestamptz default now() not null,
  unique (user_id, symbol)
);

alter table public.watchlist_items enable row level security;

create policy "Users can read own watchlist"
  on public.watchlist_items for select
  using (auth.uid() = user_id);

create policy "Users can insert own watchlist items"
  on public.watchlist_items for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own watchlist items"
  on public.watchlist_items for delete
  using (auth.uid() = user_id);

create index if not exists watchlist_items_user_id_idx on public.watchlist_items(user_id);
create index if not exists watchlist_items_symbol_idx  on public.watchlist_items(symbol);

-- -------------------------------------------------------
-- 3. asset_snapshots  (shared cache – no per-user RLS)
-- -------------------------------------------------------
create table if not exists public.asset_snapshots (
  id                 uuid primary key default uuid_generate_v4(),
  symbol             text not null,
  price              numeric,
  currency           text,
  isin               text,
  description        text,
  pe_ratio           numeric,
  market_cap         bigint,
  debt_to_equity     numeric,
  revenue_growth     numeric,
  free_cashflow      bigint,
  rsi                numeric,
  moving_average_50  numeric,
  moving_average_200 numeric,
  fetched_at         timestamptz default now() not null
);

alter table public.asset_snapshots enable row level security;

create policy "Authenticated users can read snapshots"
  on public.asset_snapshots for select
  to authenticated
  using (true);

create policy "Authenticated users can insert snapshots"
  on public.asset_snapshots for insert
  to authenticated
  with check (true);

create index if not exists asset_snapshots_symbol_fetched_idx
  on public.asset_snapshots(symbol, fetched_at desc);

-- Add columns if upgrading from earlier schema version
alter table public.asset_snapshots
  add column if not exists isin        text,
  add column if not exists description text;

-- -------------------------------------------------------
-- 4. analysis_scores  (shared cache)
-- -------------------------------------------------------
create table if not exists public.analysis_scores (
  id                uuid primary key default uuid_generate_v4(),
  symbol            text not null,
  total_score       numeric not null,
  fundamental_score numeric not null,
  technical_score   numeric not null,
  risk_score        numeric not null,
  signal            text not null,
  explanation       text not null,
  created_at        timestamptz default now() not null
);

alter table public.analysis_scores enable row level security;

create policy "Authenticated users can read scores"
  on public.analysis_scores for select
  to authenticated
  using (true);

create policy "Authenticated users can insert scores"
  on public.analysis_scores for insert
  to authenticated
  with check (true);

create index if not exists analysis_scores_symbol_created_idx
  on public.analysis_scores(symbol, created_at desc);

-- -------------------------------------------------------
-- 5. ai_analyses  (KI-Analysen Cache, 6h TTL)
-- -------------------------------------------------------
create table if not exists public.ai_analyses (
  id                    uuid primary key default gen_random_uuid(),
  symbol                text not null,
  recommendation        text not null,
  conviction            integer not null,
  summary               text not null,
  bull_case             jsonb not null default '[]',
  bear_case             jsonb not null default '[]',
  growth_outlook        text not null default '',
  fundamental_rating    integer not null default 5,
  fundamental_positives jsonb not null default '[]',
  fundamental_risks     jsonb not null default '[]',
  valuation_comment     text not null default '',
  news_sentiment        text not null default 'neutral',
  news_themes           jsonb not null default '[]',
  sentiment_summary     text not null default '',
  extra_data            jsonb,
  analyzed_at           timestamptz not null default now()
);

create index if not exists ai_analyses_symbol_analyzed_at
  on public.ai_analyses(symbol, analyzed_at desc);

alter table public.ai_analyses enable row level security;

create policy "Allow authenticated"
  on public.ai_analyses for all
  to authenticated
  using (true) with check (true);

-- -------------------------------------------------------
-- 6. fact_check_findings  (Vera Feedback Dataset)
-- -------------------------------------------------------
create table if not exists public.fact_check_findings (
  id            uuid primary key default gen_random_uuid(),
  analysis_id   uuid references public.ai_analyses(id) on delete cascade,
  symbol        text not null,
  claim         text not null,
  issue_type    text not null check (issue_type in (
                  'unbelegt_guidance','uebertriebener_konsens','falsche_zahl',
                  'erfundenes_event','fehlende_evidenz','sonstiges'
                )),
  correction    text not null,
  severity      text not null default 'medium' check (severity in ('low','medium','high')),
  evidence_urls text[] default '{}',
  confidence    integer not null check (confidence >= 1 and confidence <= 10),
  review_status text not null default 'auto' check (review_status in ('auto','confirmed','rejected')),
  created_at    timestamptz not null default now()
);

create index if not exists fact_check_findings_symbol
  on public.fact_check_findings(symbol, created_at desc);
create index if not exists fact_check_findings_issue_type
  on public.fact_check_findings(issue_type, created_at desc);

alter table public.fact_check_findings enable row level security;

create policy "Allow authenticated"
  on public.fact_check_findings for all
  to authenticated
  using (true) with check (true);

-- -------------------------------------------------------
-- 7. analysis_outcomes  (30-Tage Trefferquoten-Tracking)
-- -------------------------------------------------------
create table if not exists public.analysis_outcomes (
  id                  uuid primary key default gen_random_uuid(),
  symbol              text not null,
  recommendation      text not null,
  conviction          integer,
  price_at_analysis   numeric,
  price_target        numeric,
  stop_loss           numeric,
  analyzed_at         timestamptz not null,
  check_at            timestamptz not null,
  outcome             text not null default 'pending'
                        check (outcome in ('pending','correct','neutral','incorrect')),
  price_at_check      numeric,
  return_pct          numeric,
  checked_at          timestamptz
);

create index if not exists analysis_outcomes_check_at
  on public.analysis_outcomes(check_at) where outcome = 'pending';
create index if not exists analysis_outcomes_symbol
  on public.analysis_outcomes(symbol, analyzed_at desc);

alter table public.analysis_outcomes enable row level security;

create policy "Allow authenticated"
  on public.analysis_outcomes for all
  to authenticated
  using (true) with check (true);

-- -------------------------------------------------------
-- 8. portfolio_positions
-- -------------------------------------------------------
create table if not exists public.portfolio_positions (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  symbol         text not null,
  name           text not null default '',
  shares         numeric not null,
  purchase_price numeric not null,
  purchase_date  date not null,
  broker         text,
  created_at     timestamptz default now() not null
);

create index if not exists portfolio_positions_user_id_idx
  on public.portfolio_positions(user_id);

alter table public.portfolio_positions enable row level security;

create policy "Users can manage own portfolio"
  on public.portfolio_positions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------------
-- 9. price_alerts
-- -------------------------------------------------------
create table if not exists public.price_alerts (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  symbol       text not null,
  name         text not null default '',
  target_price numeric not null,
  direction    text not null check (direction in ('above','below')),
  triggered    boolean not null default false,
  triggered_at timestamptz,
  created_at   timestamptz default now() not null
);

create index if not exists price_alerts_user_id_idx
  on public.price_alerts(user_id);
create index if not exists price_alerts_triggered_idx
  on public.price_alerts(triggered) where triggered = false;

alter table public.price_alerts enable row level security;

create policy "Users can manage own alerts"
  on public.price_alerts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------------
-- 10. push_subscriptions
-- -------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now() not null
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

create policy "Users can manage own push subscriptions"
  on public.push_subscriptions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------------
-- 11. morning_briefings
-- -------------------------------------------------------
create table if not exists public.morning_briefings (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  headline             text not null,
  market_overview      text not null,
  watchlist_highlights jsonb not null default '[]',
  daily_opportunity    jsonb,
  generated_at         timestamptz default now() not null
);

create index if not exists morning_briefings_user_generated_idx
  on public.morning_briefings(user_id, generated_at desc);

alter table public.morning_briefings enable row level security;

create policy "Users can read own briefings"
  on public.morning_briefings for select
  using (auth.uid() = user_id);

create policy "Service role can insert briefings"
  on public.morning_briefings for insert
  with check (true);

-- -------------------------------------------------------
-- 12. hot_picks
-- -------------------------------------------------------
create table if not exists public.hot_picks (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  symbol     text not null,
  name       text not null default '',
  price      numeric,
  signal     text not null,
  score      numeric not null,
  reason     text not null default '',
  created_at timestamptz default now() not null
);

create index if not exists hot_picks_user_created_idx
  on public.hot_picks(user_id, created_at desc);

alter table public.hot_picks enable row level security;

create policy "Users can read own hot picks"
  on public.hot_picks for select
  using (auth.uid() = user_id);

create policy "Authenticated users can insert hot picks"
  on public.hot_picks for insert
  to authenticated
  with check (true);

-- -------------------------------------------------------
-- 13. agent_daily_picks  (Finn autonomer Tages-Pick)
-- -------------------------------------------------------
create table if not exists public.agent_daily_picks (
  id          uuid primary key default uuid_generate_v4(),
  symbol      text not null,
  name        text not null default '',
  price       numeric,
  signal      text not null default '',
  score       numeric,
  reason      text not null default '',
  agent       text not null default 'Finn',
  extra_data  jsonb,
  created_at  timestamptz default now() not null
);

create index if not exists agent_daily_picks_created_idx
  on public.agent_daily_picks(created_at desc);

alter table public.agent_daily_picks enable row level security;

create policy "Authenticated users can read agent picks"
  on public.agent_daily_picks for select
  to authenticated
  using (true);

create policy "Service role can insert agent picks"
  on public.agent_daily_picks for insert
  with check (true);

-- -------------------------------------------------------
-- 14. nh_select_daily  (NH Select Screener Ergebnisse)
-- -------------------------------------------------------
create table if not exists public.nh_select_daily (
  id             uuid primary key default uuid_generate_v4(),
  symbol         text not null,
  name           text not null default '',
  recommendation text not null,
  conviction     integer,
  rationale      text not null default '',
  sources        jsonb default '[]',
  agent          text not null,
  created_at     timestamptz default now() not null
);

create index if not exists nh_select_daily_created_idx
  on public.nh_select_daily(created_at desc);
create index if not exists nh_select_daily_symbol_idx
  on public.nh_select_daily(symbol, created_at desc);

alter table public.nh_select_daily enable row level security;

create policy "Public read access"
  on public.nh_select_daily for select
  using (true);

create policy "Service role can insert"
  on public.nh_select_daily for insert
  with check (true);

-- -------------------------------------------------------
-- 15. radar_signals  (Radar-Cron Signale)
-- -------------------------------------------------------
create table if not exists public.radar_signals (
  id             uuid primary key default uuid_generate_v4(),
  symbol         text not null,
  signal_type    text not null,
  description    text not null default '',
  confidence     integer not null default 5,
  source         text not null default 'radar-cron',
  found_at       timestamptz default now() not null,
  used_in_select boolean not null default false
);

create index if not exists radar_signals_found_at_idx
  on public.radar_signals(found_at desc);
create index if not exists radar_signals_symbol_idx
  on public.radar_signals(symbol);

alter table public.radar_signals enable row level security;

create policy "Service role full access"
  on public.radar_signals for all
  with check (true);
