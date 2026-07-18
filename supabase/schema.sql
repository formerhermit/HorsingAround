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
  Explicit table-level grant, independent of the project's "Automatically
  expose new tables" setting, and works whether that's left on or (per
  Supabase's own recommendation) switched off. RLS above still governs
  which rows are actually reachable.
*/
grant select, insert, update on public.saves to authenticated;
