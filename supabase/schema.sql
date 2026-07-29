/*
  Run in the Supabase SQL editor (SQL Editor -> New query) after creating your
  project, and again whenever this file gains something new.

  The whole file is safe to re-run: every statement is guarded. Note that
  Postgres has no CREATE POLICY IF NOT EXISTS, so each policy is preceded by a
  DROP POLICY IF EXISTS instead. Without those, a re-run aborts on the first
  policy with "42710: policy already exists" and everything after it is skipped,
  which looks a lot like the whole file having run fine.

  Also enable anonymous sign-ins, which is a dashboard toggle, not SQL:
  Authentication -> Sign In / Providers -> Anonymous Sign-Ins -> on.
*/

create table if not exists public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  game_state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;

/*
  Every playtester is an anonymous auth user; RLS scopes each row to its
  own owner so one player can never read or overwrite another's save.
*/
drop policy if exists "read own save" on public.saves;
create policy "read own save"
  on public.saves for select
  using (auth.uid() = user_id);

drop policy if exists "insert own save" on public.saves;
create policy "insert own save"
  on public.saves for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own save" on public.saves;
create policy "update own save"
  on public.saves for update
  using (auth.uid() = user_id);

/*
  Self-service erasure: the privacy popup's "delete everything" button removes
  the player's own saves row directly from the browser. (The anonymous
  auth.users row itself can only be deleted with the service-role key -- it
  holds no personal data, just a UUID, so orphaning it is acceptable until
  email linking exists and an Edge Function takes over full deletion.)

  If your project predates this policy, run these two statements in the SQL
  editor to enable the delete button.
*/
drop policy if exists "delete own save" on public.saves;
create policy "delete own save"
  on public.saves for delete
  using (auth.uid() = user_id);

/*
  Explicit table-level grant, independent of the project's "Automatically
  expose new tables" setting, and works whether that's left on or (per
  Supabase's own recommendation) switched off. RLS above still governs
  which rows are actually reachable.
*/
grant select, insert, update, delete on public.saves to authenticated;

/*
  Monthly "Top rescuers" leaderboard (issue #15). Rows are keyed
  (user_id, month) so the board "resets" at midnight on the 1st simply by
  querying the new month: nothing is deleted, and past months are kept.
  Months follow Europe/Madrid time (ARCH's clock). Identity is the anonymous
  auth user; display_name is only a label the player chose from the
  name generator.

  Run this whole block in the SQL editor when deploying the leaderboard.
*/
create table if not exists public.leaderboard (
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null,
  display_name text not null check (char_length(display_name) between 3 and 40),
  rescues integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.leaderboard enable row level security;

/* Publicly readable -- that's the point of a leaderboard -- but each player
   can only write their own rows. */
drop policy if exists "board is public" on public.leaderboard;
create policy "board is public"
  on public.leaderboard for select
  using (true);

drop policy if exists "insert own entry" on public.leaderboard;
create policy "insert own entry"
  on public.leaderboard for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own entry" on public.leaderboard;
create policy "update own entry"
  on public.leaderboard for update
  using (auth.uid() = user_id);

drop policy if exists "delete own entry" on public.leaderboard;
create policy "delete own entry"
  on public.leaderboard for delete
  using (auth.uid() = user_id);

/* One stable name per month, case-insensitively; the client rerolls the
   generator when it hits this. */
create unique index if not exists leaderboard_month_name
  on public.leaderboard (month, lower(display_name));

grant select on public.leaderboard to anon;
grant select, insert, update, delete on public.leaderboard to authenticated;

/*
  Save codes (issue #25): a no-email way to carry a save to another device.
  A short code is minted for the current save; typing it in on a new device
  copies that save (and leaderboard rows) onto the new device's own anonymous
  identity. It's a one-time transfer, not a sign-in -- the two devices are
  independent accounts again afterwards, same as any other pair of players.

  The table itself is never readable or writable directly by anon/authenticated
  (no policies grant that) -- it's reachable only through the two
  security-definer functions below, which enforce their own checks. The code
  is hashed (pgcrypto's bf/blowfish), same as a password would be, since
  possession of it is enough to copy someone's save.

  Run this whole block in the SQL editor when deploying save codes.
*/
create extension if not exists pgcrypto;

create table if not exists public.save_codes (
  code_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour')
);

alter table public.save_codes enable row level security;
-- Deliberately no policies: RLS with zero policies denies every direct
-- request from anon/authenticated. All access goes through the functions
-- below, which run as the function owner and bypass RLS internally.

/* Mint a fresh code for the caller's save. Replaces any code they already
   had outstanding -- only one live code per save at a time keeps this simple
   to reason about and to explain in the UI ("getting a new code cancels the
   old one"). Returns the plain code; that's the only moment it's ever visible
   in plaintext. */
create or replace function public.create_save_code()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  plain_code text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  plain_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' ||
                upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' ||
                upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));

  delete from public.save_codes where user_id = auth.uid();
  insert into public.save_codes (code_hash, user_id)
    values (crypt(plain_code, gen_salt('bf')), auth.uid());

  return plain_code;
end;
$$;

grant execute on function public.create_save_code() to authenticated;

/* Read-only lookup for the "restore" confirmation step: given a code, return
   the save it points to, without touching anything. Lets the game show
   "found your paddock -- N horses" before the player commits, and means
   cancelling at that point has genuinely changed nothing. Does not burn the
   code -- only confirm_save_code() below does that. */
create or replace function public.preview_save_code(input_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_user uuid;
  result jsonb;
begin
  select user_id into target_user
  from public.save_codes
  where expires_at > now() and crypt(input_code, code_hash) = code_hash
  limit 1;

  if target_user is null then
    raise exception 'invalid or expired code';
  end if;

  select game_state into result from public.saves where user_id = target_user;
  return result;
end;
$$;

grant execute on function public.preview_save_code(text) to authenticated;

/* The actual transfer, called once the player has seen the preview and
   confirmed. Copies the target save (and any leaderboard rows) onto the
   caller's own identity, then consumes the code so it can't be reused. A
   leaderboard name that happens to collide with someone else's this month is
   swallowed (the save copy is the part that matters -- don't fail the whole
   restore over a stable name). */
create or replace function public.confirm_save_code(input_code text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_user uuid;
  matched_hash text;
  new_user uuid := auth.uid();
begin
  if new_user is null then
    raise exception 'not signed in';
  end if;

  select user_id, code_hash into target_user, matched_hash
  from public.save_codes
  where expires_at > now() and crypt(input_code, code_hash) = code_hash
  limit 1;

  if target_user is null then
    raise exception 'invalid or expired code';
  end if;

  insert into public.saves (user_id, game_state, updated_at)
    select new_user, game_state, now() from public.saves where user_id = target_user
    on conflict (user_id) do update
      set game_state = excluded.game_state, updated_at = excluded.updated_at;

  begin
    insert into public.leaderboard (user_id, month, display_name, rescues, updated_at)
      select new_user, month, display_name, rescues, updated_at
      from public.leaderboard where user_id = target_user
      on conflict (user_id, month) do update
        set display_name = excluded.display_name, rescues = excluded.rescues, updated_at = excluded.updated_at;
  exception when unique_violation then
    null; -- display-name clash on this month's board; the save copy above still landed
  end;

  delete from public.save_codes where code_hash = matched_hash;
end;
$$;

grant execute on function public.confirm_save_code(text) to authenticated;

/*
  Also let the plain (unauthenticated) anon role run a select -- needed so
  the GitHub Actions keep-alive ping (which holds only the publishable key,
  no signed-in user) can touch the database with a clean 200 instead of
  being rejected before RLS even runs. Harmless: RLS still requires
  auth.uid() = user_id, so an anon request always sees zero rows.
*/
grant select on public.saves to anon;

/*
  Daily player stats (issue #161). We report from data the game already stores
  rather than adding a third-party analytics service, so the privacy notice's
  "no ads, no tracking, no analytics" promise stays true and adblockers can't
  undercount us. See docs/analytics.md for the reasoning and the queries.

  This table holds two integers per day and nothing else: no per-visitor rows,
  no identifiers, nothing that could identify anyone. It exists because
  saves.updated_at is OVERWRITTEN on every visit -- so "active in the last 24
  hours" can be read right now but can never be reconstructed for a past date.
  new_players needs no snapshot (auth.users.created_at is never overwritten and
  so stays queryable retroactively), but it's recorded here too so one table
  answers the whole question.

  Run this whole block in the SQL editor when deploying daily stats.
*/
create table if not exists public.daily_stats (
  day date primary key,
  new_players integer not null default 0,
  -- Nullable on purpose: null means "not measured" (a backfilled day predating
  -- the snapshot job), which is a different thing from a measured zero.
  active_24h integer,
  recorded_at timestamptz not null default now()
);

alter table public.daily_stats enable row level security;
/*
  Deliberately no policies: nothing reads this from the browser. The dashboard
  (service role) bypasses RLS to read it, and the cron only ever reaches it
  through the security-definer function below.
*/

/*
  Snapshot one day's figures. Called by the GitHub Actions cron.

  Records the day that has just FINISHED, not the one in progress: the cron runs
  early each morning, so writing current_date would freeze a row holding only the
  first few hours of a day that hasn't happened yet.

  Dates are bucketed explicitly in UTC rather than relying on the session's
  timezone, so the series doesn't shift if that ever differs.
*/
create or replace function public.record_daily_stats()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  -- The day the game went out to ARCH. Anything before this is us testing, and
  -- would distort the baseline. Keep in step with docs/analytics.md.
  launch constant timestamptz := timestamptz '2026-07-29 00:00:00+00';
  target constant date := ((now() at time zone 'UTC')::date - 1);
begin
  /*
    The function is granted to anon (so the cron can use the same publishable
    key the keep-alive ping already holds), which means a stranger could call
    it. Once the day's row is fresh there's nothing to recompute, so bail out --
    that takes the sting out of anyone hammering it. A manual re-run within the
    window is a no-op for the same reason.
  */
  if exists (
    select 1 from public.daily_stats
    where day = target and recorded_at > now() - interval '12 hours'
  ) then
    return;
  end if;

  insert into public.daily_stats (day, new_players, active_24h, recorded_at)
  select
    target,
    (select count(*) from auth.users u
      where u.created_at >= launch
        and (u.created_at at time zone 'UTC')::date = target),
    /*
      A rolling window ending now, not a calendar day: a player who was here
      yesterday AND today has had their updated_at overwritten to today, so
      bucketing by date would lose them. Running daily makes this window line up
      with `target` closely enough to read as "yesterday".
    */
    (select count(*) from auth.users u
      join public.saves s on s.user_id = u.id
      where u.created_at >= launch
        and s.updated_at > now() - interval '24 hours'),
    now()
  on conflict (day) do update
    set new_players = excluded.new_players,
        active_24h  = excluded.active_24h,
        recorded_at = excluded.recorded_at;
end;
$$;

grant execute on function public.record_daily_stats() to anon;

/*
  One-off backfill: new_players is recoverable for every day since launch,
  because auth.users.created_at is never overwritten. active_24h is left null
  on these rows -- it was never measured and cannot be recovered. Safe to re-run.
*/
insert into public.daily_stats (day, new_players, recorded_at)
select (u.created_at at time zone 'UTC')::date, count(*), now()
from auth.users u
where u.created_at >= timestamptz '2026-07-29 00:00:00+00'
group by 1
on conflict (day) do update set new_players = excluded.new_players;
