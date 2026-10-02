-- Golden Skibidi profile pictures: run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again. Pictures are small squares (made in the browser) stored in a public "avatars"
-- bucket; only the website's server (secret key) can upload or delete them.

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = true, file_size_limit = 524288, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];
