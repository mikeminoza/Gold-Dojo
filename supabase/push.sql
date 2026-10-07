-- Gold Dojo web push: phone / desktop notifications from the website, even when it's closed.
-- Run once in Supabase -> SQL Editor -> New query -> Run. Safe to run again.
-- The website's server saves each browser's subscription; the bot reads them to send alerts.

create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  strategies text[] not null default array['trend', 'h4'],  -- which strategies' alerts: trend, h4
  created_at timestamptz not null default now()
);

-- Only the website's server and the bot (secret key) read and write it
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Broker price check: what your broker actually filled you at, next to the bot's paper entry
alter table public.taken_trades add column if not exists broker_price double precision
  check (broker_price is null or (broker_price > 0 and broker_price < 100000));
