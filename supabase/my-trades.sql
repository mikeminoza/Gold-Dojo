-- Gold Lab "I took this trade": run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again. Each person's own list of signals they actually traded, and at what size.

create table if not exists public.taken_trades (
  user_id uuid not null references auth.users (id) on delete cascade,
  trade_id text not null,                 -- the open signal's id (signals.trade_id)
  lots double precision not null check (lots > 0 and lots <= 100),
  created_at timestamptz not null default now(),
  primary key (user_id, trade_id)
);

-- Only the website's server (secret key) reads and writes it, for the signed-in person only
alter table public.taken_trades enable row level security;
revoke all on public.taken_trades from anon, authenticated;
