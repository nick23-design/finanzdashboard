-- Research data cache for secondary providers such as FMP.
-- These tables store provider output separately from user-owned data so the
-- analysis pipeline can use cached consensus, ownership and quarterly facts
-- without waiting on slow live provider calls.

create table if not exists public.analyst_consensus (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null,
  provider      text not null,
  mean_target   numeric,
  high_target   numeric,
  low_target    numeric,
  rating_count  integer,
  strong_buy    integer not null default 0,
  buy           integer not null default 0,
  hold          integer not null default 0,
  sell          integer not null default 0,
  strong_sell   integer not null default 0,
  raw           jsonb,
  fetched_at    timestamptz default now() not null,
  created_at    timestamptz default now() not null
);

create index if not exists analyst_consensus_symbol_fetched_idx
  on public.analyst_consensus(symbol, fetched_at desc);

alter table public.analyst_consensus enable row level security;

drop policy if exists "Authenticated users can read analyst consensus" on public.analyst_consensus;
create policy "Authenticated users can read analyst consensus"
  on public.analyst_consensus for select
  to authenticated
  using (true);

create table if not exists public.institutional_ownership (
  id                uuid primary key default gen_random_uuid(),
  symbol            text not null,
  provider          text not null,
  pct_insider       numeric,
  pct_institutions  numeric,
  top_holders       jsonb not null default '[]',
  raw               jsonb,
  fetched_at        timestamptz default now() not null,
  created_at        timestamptz default now() not null
);

create index if not exists institutional_ownership_symbol_fetched_idx
  on public.institutional_ownership(symbol, fetched_at desc);

alter table public.institutional_ownership enable row level security;

drop policy if exists "Authenticated users can read institutional ownership" on public.institutional_ownership;
create policy "Authenticated users can read institutional ownership"
  on public.institutional_ownership for select
  to authenticated
  using (true);

create table if not exists public.fundamental_facts (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null,
  provider      text not null,
  cik           text,
  revenue       jsonb not null default '[]',
  net_income    jsonb not null default '[]',
  gross_profit  jsonb not null default '[]',
  raw           jsonb,
  fetched_at    timestamptz default now() not null,
  created_at    timestamptz default now() not null
);

create index if not exists fundamental_facts_symbol_fetched_idx
  on public.fundamental_facts(symbol, fetched_at desc);

alter table public.fundamental_facts enable row level security;

drop policy if exists "Authenticated users can read fundamental facts" on public.fundamental_facts;
create policy "Authenticated users can read fundamental facts"
  on public.fundamental_facts for select
  to authenticated
  using (true);

create table if not exists public.provider_runs (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  job_type     text not null,
  status       text not null check (status in ('running', 'ok', 'partial', 'error')),
  symbols      jsonb not null default '[]',
  started_at   timestamptz default now() not null,
  finished_at  timestamptz,
  duration_ms  integer,
  details      jsonb,
  error        text
);

create index if not exists provider_runs_started_idx
  on public.provider_runs(started_at desc);

alter table public.provider_runs enable row level security;

drop policy if exists "Authenticated users can read provider runs" on public.provider_runs;
create policy "Authenticated users can read provider runs"
  on public.provider_runs for select
  to authenticated
  using (true);

create table if not exists public.provider_field_status (
  id          uuid primary key default gen_random_uuid(),
  symbol      text not null,
  provider    text not null,
  field       text not null,
  status      text not null check (status in ('ok', 'missing', 'error', 'skipped')),
  detail      text,
  fetched_at  timestamptz default now() not null
);

create index if not exists provider_field_status_symbol_idx
  on public.provider_field_status(symbol, provider, field, fetched_at desc);

alter table public.provider_field_status enable row level security;

drop policy if exists "Authenticated users can read provider field status" on public.provider_field_status;
create policy "Authenticated users can read provider field status"
  on public.provider_field_status for select
  to authenticated
  using (true);
