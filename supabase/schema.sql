/*
  Run once in the Supabase SQL editor (SQL Editor -> New query) after
  creating your project.

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
create policy "read own save"
  on public.saves for select
  using (auth.uid() = user_id);

create policy "insert own save"
  on public.saves for insert
  with check (auth.uid() = user_id);

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
create policy "board is public"
  on public.leaderboard for select
  using (true);

create policy "insert own entry"
  on public.leaderboard for insert
  with check (auth.uid() = user_id);

create policy "update own entry"
  on public.leaderboard for update
  using (auth.uid() = user_id);

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
  Also let the plain (unauthenticated) anon role run a select -- needed so
  the GitHub Actions keep-alive ping (which holds only the publishable key,
  no signed-in user) can touch the database with a clean 200 instead of
  being rejected before RLS even runs. Harmless: RLS still requires
  auth.uid() = user_id, so an anon request always sees zero rows.
*/
grant select on public.saves to anon;
