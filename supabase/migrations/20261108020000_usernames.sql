-- Username + password accounts.
--
-- Supabase Auth needs an email per user, so the app signs people up with a
-- synthetic, undeliverable address: `<username>@users.double-take.invalid`
-- (`.invalid` is reserved by RFC 2606 and never resolves). "Confirm email" is
-- off for the project, so no email is ever sent. The username is the handle.
--
-- New users must be one of:
--   - a username account: the handle is exactly the address's local part, and
--     sign-up fails if that handle is taken (the app checks first; this covers
--     a race);
--   - a dev test account (`app_metadata.test_account`, created with the secret
--     key by the Worker's dev routes), which keeps the old generated handle.
-- Anything else (e.g. an email OTP sign-up with a real address) is refused.
-- Relax this when Apple or Google sign-in arrives.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  email text := lower(coalesce(new.email, ''));
  username text;
  base text;
  candidate text;
  tries int := 0;
begin
  if email like '%@users.double-take.invalid' then
    username := split_part(email, '@', 1);
    -- Letters, digits, _ and single dots; no dot first or last.
    if username !~ '^[a-z0-9_][a-z0-9._]{1,22}[a-z0-9_]$' or username like '%..%' then
      raise exception 'invalid username' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.profiles where handle = username::extensions.citext) then
      raise exception 'username taken' using errcode = 'P0001';
    end if;
    insert into public.profiles (id, handle, display_name)
    values (new.id, username, left(new.raw_user_meta_data ->> 'display_name', 50));
    return new;
  end if;

  if coalesce((new.raw_app_meta_data ->> 'test_account')::boolean, false) is not true then
    raise exception 'sign up with a username' using errcode = 'P0001';
  end if;

  -- Dev test accounts: a hint, tried bare and then with four random digits.
  base := lower(coalesce(new.raw_user_meta_data ->> 'handle_hint', split_part(email, '@', 1)));
  base := left(regexp_replace(base, '[^a-z0-9._]', '', 'g'), 19);
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

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Handles are usernames now, so they can't be changed (that would orphan the
-- sign-in address). Display names still can.
revoke update (handle) on public.profiles from authenticated;
