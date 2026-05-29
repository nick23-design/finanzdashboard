-- Persisted German company descriptions.
-- The English business summary (yfinance) is translated once via the LLM and
-- stored here keyed by symbol, so repeated views do not re-spend tokens.
-- A manual refresh re-translates and updates the row (bumping updated_at).

create table if not exists public.company_descriptions (
  symbol          text primary key,
  description_de  text not null,
  source          text not null default 'translated' check (source in ('translated', 'original')),
  updated_at      timestamptz default now() not null
);

alter table public.company_descriptions enable row level security;

drop policy if exists "Authenticated users can read company descriptions" on public.company_descriptions;
create policy "Authenticated users can read company descriptions"
  on public.company_descriptions for select
  to authenticated
  using (true);

-- Writes happen via the service role (translation endpoint), which bypasses RLS.
