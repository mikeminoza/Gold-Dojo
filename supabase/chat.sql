-- Golden Skibidi live chat: run this once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again.

-- Chats ("rooms"). Anyone signed in to the site can add one.
create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 40),
  created_by text not null,
  created_at timestamptz not null default now()
);

-- Messages. The author is the name the sender signed in with (set by the website's server).
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  author text not null check (char_length(author) between 1 and 24),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_room_time on public.chat_messages (room_id, created_at desc);

-- The default chat
insert into public.chat_rooms (name, created_by) values ('General', 'Golden Skibidi')
on conflict (name) do nothing;

-- Security: browsers may only READ. Sending goes through the website's server (which checks the
-- sign-in and attaches the sender's name) using the secret key, which bypasses these rules.
alter table public.chat_rooms enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "Website can read chats" on public.chat_rooms;
create policy "Website can read chats" on public.chat_rooms for select to anon, authenticated using (true);

drop policy if exists "Website can read messages" on public.chat_messages;
create policy "Website can read messages" on public.chat_messages for select to anon, authenticated using (true);

grant select on public.chat_rooms, public.chat_messages to anon, authenticated;

-- Push new chats and messages to everyone instantly (Supabase Realtime)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_rooms') then
    alter publication supabase_realtime add table public.chat_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
