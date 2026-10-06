-- Gold Lab accounts: run this once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again. Run it AFTER the new website version (sign-in with accounts) is live: from then
-- on only signed-in people can read signals and chat; the old password site stops loading data.
--
-- BEFORE RUNNING: replace YOUR-EMAIL@gmail.com below with the email you'll sign in with (Google or
-- email + password). That account becomes the admin, who can block people on the site's Members page.

-- Everyone who has signed in (added automatically on their first sign-in). Blocked people can't get in.
create table if not exists public.members (
  email text primary key check (email = lower(email)),
  role text not null default 'member' check (role in ('admin', 'member')),
  added_at timestamptz not null default now()
);
alter table public.members add column if not exists blocked boolean not null default false;

-- Each signed-in person's chosen display name (unique, any capitalisation).
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null check (char_length(name) between 1 and 24),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_name_unique on public.profiles (lower(name));

insert into public.members (email, role) values (lower('YOUR-EMAIL@gmail.com'), 'admin')
on conflict (email) do update set role = 'admin', blocked = false;

-- Only the website's server (secret key, which bypasses these rules) reads or changes these two.
alter table public.members enable row level security;
alter table public.profiles enable row level security;
revoke all on public.members, public.profiles from anon, authenticated;

-- "Is the signed-in person a member who isn't blocked?" - used by the rules below.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = lower(coalesce(auth.jwt() ->> 'email', '')) and not blocked);
$$;
revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

-- Signals, bot status and chat: readable by signed-in members only (no longer by anyone with the
-- public key). The bot and the website's server keep writing with the secret key as before.
do $$
declare
  t text;
begin
  foreach t in array array['bot_state', 'signals', 'chat_rooms', 'chat_messages'] loop
    if to_regclass('public.' || t) is null then
      continue; -- e.g. signals.sql not run yet
    end if;
    execute format('drop policy if exists "Website can read bot state" on public.%I', t);
    execute format('drop policy if exists "Website can read signals" on public.%I', t);
    execute format('drop policy if exists "Website can read chats" on public.%I', t);
    execute format('drop policy if exists "Website can read messages" on public.%I', t);
    execute format('drop policy if exists "Members can read" on public.%I', t);
    execute format('create policy "Members can read" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
