-- Gold Lab: profiles keep your account size, and chat messages remember who sent them (so
-- people can delete their own and admins can delete any). Run once after members.sql, in
-- Supabase -> SQL Editor -> New query -> Run. Safe to run again.

alter table public.profiles add column if not exists balance double precision
  check (balance between 10 and 10000000);
alter table public.profiles add column if not exists risk_percent double precision
  check (risk_percent between 0.1 and 10);

alter table public.chat_messages add column if not exists user_id uuid references auth.users (id) on delete set null;

-- Deleted messages disappear for everyone right away (Realtime sends the delete)
alter table public.chat_messages replica identity full;
