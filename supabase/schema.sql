-- ============================================================
-- Finanzdashboard – Supabase Schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor)
-- ============================================================

-- Enable necessary extensions
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

-- Auto-create profile on signup
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
-- 3. asset_snapshots  (shared cache – no RLS user filter)
-- -------------------------------------------------------
create table if not exists public.asset_snapshots (
  id                uuid primary key default uuid_generate_v4(),
  symbol            text not null,
  price             numeric,
  currency          text,
  pe_ratio          numeric,
  market_cap        bigint,
  debt_to_equity    numeric,
  revenue_growth    numeric,
  free_cashflow     bigint,
  rsi               numeric,
  moving_average_50 numeric,
  moving_average_200 numeric,
  fetched_at        timestamptz default now() not null
);

-- Only the service role writes snapshots; anon/auth may read
alter table public.asset_snapshots enable row level security;

create policy "Authenticated users can read snapshots"
  on public.asset_snapshots for select
  to authenticated
  using (true);

create index if not exists asset_snapshots_symbol_fetched_idx
  on public.asset_snapshots(symbol, fetched_at desc);

-- -------------------------------------------------------
-- 4. analysis_scores  (shared cache)
-- -------------------------------------------------------
create table if not exists public.analysis_scores (
  id                 uuid primary key default uuid_generate_v4(),
  symbol             text not null,
  total_score        numeric not null,
  fundamental_score  numeric not null,
  technical_score    numeric not null,
  risk_score         numeric not null,
  signal             text not null,
  explanation        text not null,
  created_at         timestamptz default now() not null
);

alter table public.analysis_scores enable row level security;

create policy "Authenticated users can read scores"
  on public.analysis_scores for select
  to authenticated
  using (true);

create index if not exists analysis_scores_symbol_created_idx
  on public.analysis_scores(symbol, created_at desc);
