-- Golden Skibidi trade analysis: run once in Supabase -> SQL Editor -> New query -> Run. Safe to run again.
-- How far each trade went in its favour (mfe_r) and against it (mae_r) before closing, in R
-- (1R = the stop distance). Saved by the bot on every close from now on.
alter table public.signals add column if not exists mfe_r double precision;
alter table public.signals add column if not exists mae_r double precision;
