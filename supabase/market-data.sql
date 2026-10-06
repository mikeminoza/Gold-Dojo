-- Gold Dojo live market data: run once in Supabase -> SQL Editor -> New query -> Run. Safe to run again.
-- One row per minute of live XAUUSD prices the bot saw, with the real spread - fresh, unseen data for
-- testing future strategy ideas (the 2003-2026 history has been used up by the research).

create table if not exists public.market_minutes (
  minute timestamptz primary key,          -- the minute (UTC) the prices belong to
  bid_open double precision not null,
  bid_high double precision not null,
  bid_low double precision not null,
  bid_close double precision not null,
  ask_close double precision not null,
  spread_avg double precision not null,    -- average ask - bid over the minute ($ per oz)
  spread_max double precision not null,    -- widest spread in the minute
  ticks integer not null,                  -- prices seen in the minute
  paxg_gap double precision                -- PAXG-above-spot shift in use (candles), for reference
);

-- Only the bot (secret key) writes it, and nobody reads it from the website
alter table public.market_minutes enable row level security;
revoke all on public.market_minutes from anon, authenticated;
