-- Golden Skibidi signal journal: run this once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again. Every BUY / SELL / CLOSE the bot makes is kept here permanently.

create table if not exists public.signals (
  id bigint generated always as identity primary key,
  event_id text not null unique,          -- the bot's own id, so re-sending never duplicates
  trade_id text,                          -- links a CLOSE to the BUY/SELL that opened it
  type text not null check (type in ('open', 'close')),
  side text not null check (side in ('BUY', 'SELL')),
  strategy text,                          -- e.g. "orb" (session breakout) or "ema"
  session text,                           -- e.g. "New York"
  symbol text,
  timeframe text,
  price double precision not null,        -- entry price (open) or exit price (close)
  entry double precision,                 -- for a close: the price it was opened at
  sl double precision,
  tp double precision,
  lots double precision,
  risk double precision,                  -- account money at risk if the stop is hit
  pnl double precision,                   -- result in $ per oz (close only)
  pnl_usd double precision,               -- result in account money at the suggested size (close only)
  reason text,
  created_at timestamptz not null         -- when the bot recorded it
);

create index if not exists signals_time on public.signals (created_at desc);

-- Security: the website may only READ; only the bot (secret key) can add signals, and nothing can
-- edit or delete them from the website.
alter table public.signals enable row level security;

drop policy if exists "Website can read signals" on public.signals;
create policy "Website can read signals" on public.signals for select to anon, authenticated using (true);

grant select on public.signals to anon, authenticated;

-- New signals appear on the website instantly
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signals') then
    alter publication supabase_realtime add table public.signals;
  end if;
end $$;
