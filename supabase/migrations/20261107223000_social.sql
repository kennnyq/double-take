-- Social schema: profiles, per-user clip lists (likes, saves, reposts, sends),
-- follows, comments and comment likes, plus trigger-maintained public counts.
--
-- Clips are keyed by `clip_key`, the media Worker's clip id (`Clip.sourceId`).
-- Guests are signed out (the `anon` role) and can only read public data. Every
-- write needs a real member: a uid on a non-anonymous JWT (`is_member()`).

create extension if not exists citext with schema extensions;

-- ---- helpers -------------------------------------------------------------------

create or replace function public.is_member() returns boolean
language sql stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
$$;

-- ---- profiles ------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  handle extensions.citext unique not null check (handle ~ '^[a-z0-9._]{3,24}$'),
  display_name text check (char_length(display_name) <= 50),
  created_at timestamptz not null default now()
);

-- A profile for every new user, with a generated handle: a hint from the sign-up
-- metadata (`handle_hint`) or the email's local part, tried bare and then with
-- four random digits until one is free.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  tries int := 0;
begin
  base := lower(coalesce(new.raw_user_meta_data ->> 'handle_hint', split_part(coalesce(new.email, ''), '@', 1)));
  base := regexp_replace(base, '[^a-z0-9._]', '', 'g');
  base := left(base, 19);
  if char_length(base) < 3 then
    base := 'user';
  end if;
  candidate := base;
  while exists (select 1 from public.profiles where handle = candidate::extensions.citext) loop
    tries := tries + 1;
    if tries > 20 then
      raise exception 'could not pick a free handle for %', base;
    end if;
    candidate := base || lpad((floor(random() * 10000))::int::text, 4, '0');
  end loop;
  insert into public.profiles (id, handle, display_name)
  values (new.id, candidate, left(new.raw_user_meta_data ->> 'display_name', 50));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- per-user clip lists ---------------------------------------------------------

create table public.likes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  clip_key text not null check (char_length(clip_key) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (user_id, clip_key)
);

create table public.saves (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  clip_key text not null check (char_length(clip_key) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (user_id, clip_key)
);

create table public.reposts (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  clip_key text not null check (char_length(clip_key) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (user_id, clip_key)
);

-- Sending again bumps `created_at` (an upsert), so the profile's Shared tab
-- keeps the latest send first.
create table public.sends (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  clip_key text not null check (char_length(clip_key) between 1 and 64),
  recipients int not null default 1 check (recipients between 1 and 50),
  created_at timestamptz not null default now(),
  primary key (user_id, clip_key)
);

create table public.follows (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  author_handle extensions.citext not null check (char_length(author_handle::text) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (user_id, author_handle)
);

-- ---- comments --------------------------------------------------------------------

create table public.comments (
  -- Client-generated, so the optimistic comment keeps its id after the insert.
  id uuid primary key,
  -- References profiles (which cascades from auth.users) so reads can embed the handle.
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  clip_key text not null check (char_length(clip_key) between 1 and 64),
  -- A reply to a real comment, or to one of the app's stand-in comments.
  parent_id uuid references public.comments on delete cascade,
  stand_in_parent text check (char_length(stand_in_parent) <= 96),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  check (parent_id is null or stand_in_parent is null)
);

-- A comment id: a real comment's uuid or a stand-in comment's id.
create table public.comment_likes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  comment_ref text not null check (char_length(comment_ref) between 1 and 96),
  created_at timestamptz not null default now(),
  primary key (user_id, comment_ref)
);

-- No more than 10 comments a minute per user.
create or replace function public.limit_comment_rate() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.comments
    where user_id = new.user_id and created_at > now() - interval '1 minute'
  ) >= 10 then
    raise exception 'too many comments, try again in a minute' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger comments_rate_limit
  before insert on public.comments
  for each row execute function public.limit_comment_rate();

-- ---- public counts ---------------------------------------------------------------

create table public.clip_stats (
  clip_key text primary key,
  likes int not null default 0,
  reposts int not null default 0,
  comments int not null default 0
);

create or replace function public.bump_clip_stats() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  k text := coalesce(new.clip_key, old.clip_key);
  d int := case when tg_op = 'INSERT' then 1 else -1 end;
begin
  insert into public.clip_stats as s (clip_key, likes, reposts, comments)
  values (
    k,
    greatest(0, case when tg_table_name = 'likes' then d else 0 end),
    greatest(0, case when tg_table_name = 'reposts' then d else 0 end),
    greatest(0, case when tg_table_name = 'comments' then d else 0 end)
  )
  on conflict (clip_key) do update set
    likes = greatest(0, s.likes + case when tg_table_name = 'likes' then d else 0 end),
    reposts = greatest(0, s.reposts + case when tg_table_name = 'reposts' then d else 0 end),
    comments = greatest(0, s.comments + case when tg_table_name = 'comments' then d else 0 end);
  return null;
end;
$$;

create trigger likes_stats after insert or delete on public.likes
  for each row execute function public.bump_clip_stats();
create trigger reposts_stats after insert or delete on public.reposts
  for each row execute function public.bump_clip_stats();
create trigger comments_stats after insert or delete on public.comments
  for each row execute function public.bump_clip_stats();

-- Trigger functions are not part of the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.limit_comment_rate() from public, anon, authenticated;
revoke execute on function public.bump_clip_stats() from public, anon, authenticated;

-- ---- indexes -----------------------------------------------------------------------

create index likes_clip_key on public.likes (clip_key);
create index reposts_clip_key on public.reposts (clip_key);
create index follows_author on public.follows (author_handle);
create index comments_clip on public.comments (clip_key, created_at desc);
create index comments_user on public.comments (user_id, created_at desc);
create index comments_parent on public.comments (parent_id);

-- ---- row level security ---------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.likes enable row level security;
alter table public.saves enable row level security;
alter table public.reposts enable row level security;
alter table public.sends enable row level security;
alter table public.follows enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.clip_stats enable row level security;

-- Public reads: profiles, likes, reposts, follows, comments, counts.
create policy "profiles are public" on public.profiles for select to anon, authenticated using (true);
create policy "likes are public" on public.likes for select to anon, authenticated using (true);
create policy "reposts are public" on public.reposts for select to anon, authenticated using (true);
create policy "follows are public" on public.follows for select to anon, authenticated using (true);
create policy "comments are public" on public.comments for select to anon, authenticated using (true);
create policy "counts are public" on public.clip_stats for select to anon, authenticated using (true);

-- Private reads: saves, sends, comment likes.
create policy "own saves" on public.saves for select to authenticated using (user_id = (select auth.uid()));
create policy "own sends" on public.sends for select to authenticated using (user_id = (select auth.uid()));
create policy "own comment likes" on public.comment_likes for select to authenticated using (user_id = (select auth.uid()));

-- Writes: members only, own rows only.
create policy "update own profile" on public.profiles for update to authenticated
  using (public.is_member() and id = (select auth.uid()))
  with check (public.is_member() and id = (select auth.uid()));

create policy "add own like" on public.likes for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));
create policy "remove own like" on public.likes for delete to authenticated
  using (public.is_member() and user_id = (select auth.uid()));

create policy "add own save" on public.saves for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));
create policy "remove own save" on public.saves for delete to authenticated
  using (public.is_member() and user_id = (select auth.uid()));

create policy "add own repost" on public.reposts for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));
create policy "remove own repost" on public.reposts for delete to authenticated
  using (public.is_member() and user_id = (select auth.uid()));

create policy "add own send" on public.sends for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));
create policy "bump own send" on public.sends for update to authenticated
  using (public.is_member() and user_id = (select auth.uid()))
  with check (public.is_member() and user_id = (select auth.uid()));
create policy "remove own send" on public.sends for delete to authenticated
  using (public.is_member() and user_id = (select auth.uid()));

create policy "add own follow" on public.follows for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));
create policy "remove own follow" on public.follows for delete to authenticated
  using (public.is_member() and user_id = (select auth.uid()));

create policy "add own comment" on public.comments for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));
create policy "remove own comment" on public.comments for delete to authenticated
  using (public.is_member() and user_id = (select auth.uid()));

create policy "add own comment like" on public.comment_likes for insert to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));
create policy "remove own comment like" on public.comment_likes for delete to authenticated
  using (public.is_member() and user_id = (select auth.uid()));

-- ---- grants (RLS still decides which rows) ---------------------------------------

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.likes, public.reposts, public.follows, public.comments, public.clip_stats
  to anon, authenticated;
grant select on public.saves, public.sends, public.comment_likes to authenticated;
grant update (handle, display_name) on public.profiles to authenticated;
grant insert, delete on public.likes, public.saves, public.reposts, public.follows, public.comments, public.comment_likes
  to authenticated;
grant insert, update, delete on public.sends to authenticated;
grant execute on function public.is_member() to anon, authenticated;
