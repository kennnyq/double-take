-- Prepared check results for stage demos, so a live demo can't go wrong:
-- uploading a prepared file (matched by its SHA-256) or pasting a prepared
-- link (matched by its normalized URL) shows the stored result at once.
-- Written only by scripts/demo/import-demo-checks.ts with the secret key;
-- anyone can read. The videos live in the public `demo-media` bucket.

create table public.demo_checks (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  kind text not null check (kind in ('file', 'link')),
  sha256 text unique check (sha256 ~ '^[0-9a-f]{64}$'),
  normalized_url text unique check (char_length(normalized_url) between 1 and 2048),
  label text not null default '' check (char_length(label) <= 200),
  -- The public job result JSON (with its investigation, replay = true).
  result jsonb not null,
  -- Object path in the demo-media bucket, e.g. "<id>/clip.mp4".
  media_path text check (char_length(media_path) between 1 and 512),
  created_at timestamptz not null default now(),
  check ((kind = 'file' and sha256 is not null) or (kind = 'link' and normalized_url is not null))
);

alter table public.demo_checks enable row level security;
create policy "demo checks are public" on public.demo_checks for select to anon, authenticated using (true);
grant select on public.demo_checks to anon, authenticated;
revoke insert, update, delete on public.demo_checks from anon, authenticated;

-- Public read (objects are served by URL); uploads only with the secret key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('demo-media', 'demo-media', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
