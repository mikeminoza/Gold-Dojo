-- Gold Lab: run this once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again.

-- One row per piece of shared state; the bot keeps the row with id = 'live' up to date.
create table if not exists public.bot_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Security: the website (public key) may only READ. There is deliberately no insert/update/delete
-- policy, so only the bot's secret key - which bypasses these rules - can write.
alter table public.bot_state enable row level security;

drop policy if exists "Website can read bot state" on public.bot_state;
create policy "Website can read bot state"
  on public.bot_state for select
  to anon, authenticated
  using (true);

grant select on public.bot_state to anon, authenticated;

-- Push every change to the website instantly (Supabase Realtime)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bot_state'
  ) then
    alter publication supabase_realtime add table public.bot_state;
  end if;
end $$;
