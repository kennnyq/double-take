-- App settings that can change without a release, edited by hand in the
-- Supabase table editor. Anyone can read them; no client can write them.
--
--   tells_pipeline: the default tells pipeline ("model") on the public site,
--   as a JSON string, e.g. "main" or "claude". A viewer's own pick in the dev
--   settings still wins; unknown names fall back to main.

create table public.app_config (
  key text primary key check (key ~ '^[a-z0-9_]{1,64}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

create policy "app config is public" on public.app_config for select to anon, authenticated using (true);

grant select on public.app_config to anon, authenticated;
revoke insert, update, delete on public.app_config from anon, authenticated;

-- Keep updated_at honest when a row is edited in the dashboard.
create or replace function public.touch_app_config() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.touch_app_config() from public, anon, authenticated;

create trigger app_config_touch
  before update on public.app_config
  for each row execute function public.touch_app_config();

insert into public.app_config (key, value) values ('tells_pipeline', '"main"');
