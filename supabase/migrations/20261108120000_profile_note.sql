-- A short note on your profile, like Instagram's notes: shown in the bubble
-- above the avatar. Public like the rest of the profile; up to 60 characters;
-- only you can change yours (the "update own profile" policy).
alter table public.profiles
  add column note text check (char_length(note) between 1 and 60);

grant update (note) on public.profiles to authenticated;
