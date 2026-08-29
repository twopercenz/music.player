-- Run this once in the Supabase SQL editor for your project.
--
-- Single shared library table — there's no per-user auth, the whole app sits
-- behind one shared password, so there's no `user_id` column. Only
-- YouTube-sourced tracks are synced here (see lib/types.ts libraryRowToTrack);
-- locally-uploaded files stay device-local in IndexedDB and never reach this table.

create table if not exists library (
  id uuid primary key default gen_random_uuid(),
  video_id text not null unique,
  title text not null,
  artist text not null,
  duration_ms integer not null,
  album_art_url text,
  added_at timestamptz not null default now()
);

create index if not exists library_added_at_idx on library (added_at desc);

-- RLS is enabled with no policies, i.e. the table is only reachable via the
-- secret key from our own server-side API routes (lib/supabase.ts) — never
-- directly from the browser.
alter table library enable row level security;

-- Added after the table already existed elsewhere, so it's a separate
-- `alter` rather than folded into the `create table` above. Postgres has no
-- `add constraint if not exists`, so this is wrapped to be safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'library_duration_positive'
  ) then
    alter table library add constraint library_duration_positive check (duration_ms > 0);
  end if;
end $$;
