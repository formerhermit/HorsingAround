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
  Also let the plain (unauthenticated) anon role run a select -- needed so
  the GitHub Actions keep-alive ping (which holds only the publishable key,
  no signed-in user) can touch the database with a clean 200 instead of
  being rejected before RLS even runs. Harmless: RLS still requires
  auth.uid() = user_id, so an anon request always sees zero rows.
*/
grant select on public.saves to anon;
