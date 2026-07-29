# Analytics — what we measure, and how (issue #161)

## The launch cutoff

**2026-07-29** is the day the game went out to ARCH. Every identity created before
that date is us testing, and would badly distort the baseline — a handful of test
players against a real audience of unknown size.

So the rule for every query below is: **count only identities whose
`auth.users.created_at >= '2026-07-29'`.** That excludes the test accounts once,
permanently, from every metric — rather than trying to remember to subtract them.

The date appears as a `launch` CTE at the top of each query so there's one place to
change it if the real launch date turns out to be different.

---

## Why not a third-party analytics service

We looked at GoatCounter, Cloudflare Web Analytics and GA4 (see the discussion in
issue #161). The decision was to use what we already store, because:

- The privacy notice promises **"No ads, no tracking, no analytics"** in bold. Querying
  records we already hold and already disclose is reporting, not tracking — so that
  promise stays intact and honest.
- Client-side analytics is blocked by adblockers, Brave, and Firefox strict mode, so
  it undercounts by an unpredictable margin. Our own data has no such gap.
- No new third party, no new processor, no new data collected, nothing added to the page.

What we give up is **referrer** — we cannot tell how people found the game. If that
ever becomes the question we most need answered, revisit GoatCounter then, and update
the privacy copy in the same change (see the note at the top of the privacy section
in `js/main.js`).

---

## Available now — no code change

Run these in the Supabase dashboard's SQL editor. They need the dashboard's own
privileges: `auth.users` is not reachable from the client, and RLS hides other
players' `saves` rows from the anon key, both by design.

### New players per day

`auth.users.created_at` is never overwritten, so this is a true historical series and
works retroactively.

```sql
with launch as (select timestamptz '2026-07-29 00:00:00+00' as at)
select u.created_at::date as day, count(*) as new_players
from auth.users u, launch
where u.created_at >= launch.at
group by 1
order by 1 desc;
```

### Totals since launch

```sql
with launch as (select timestamptz '2026-07-29 00:00:00+00' as at)
select
  count(*)                                                            as players_ever,
  count(*) filter (where s.updated_at > now() - interval '24 hours')  as active_24h,
  count(*) filter (where s.updated_at > now() - interval '7 days')    as active_7d
from auth.users u
join saves s on s.user_id = u.id, launch
where u.created_at >= launch.at;
```

### Engagement and the donate funnel

Everything below already lives in the `game_state` JSON and is already disclosed in the
privacy notice. `donatedForReal` is the number that tells ARCH whether the game is
actually sending people to Donorbox.

```sql
with launch as (select timestamptz '2026-07-29 00:00:00+00' as at)
select
  count(*)                                                                      as players,
  count(*) filter (where (s.game_state->'milestones'->>'donatedForReal')::boolean) as clicked_donate,
  count(*) filter (where (s.game_state->'milestones'->>'sharedForReal')::boolean)  as shared,
  count(*) filter (where (s.game_state->'stats'->>'horsesRescued')::int >= 5)      as reached_5_rescues,
  count(*) filter (where (s.game_state->'stats'->>'horsesRescued')::int >= 25)     as reached_25_rescues,
  round(avg((s.game_state->'stats'->>'playSeconds')::numeric) / 60, 1)             as avg_minutes_played
from auth.users u
join saves s on s.user_id = u.id, launch
where u.created_at >= launch.at;
```

---

## What we cannot get retroactively

`saves.updated_at` and `auth.users.last_sign_in_at` are **overwritten** on every visit.
So "how many were active in the last 24 hours" works, but "how many were active on
3rd August" cannot be reconstructed after the fact — a player active in August and
again today only shows today.

Fixing that needs a daily snapshot, which is the proposal below.

---

## Proposed: a daily snapshot (issue #161)

Add a `daily_stats` table holding **two integers per day and nothing else** — no
per-visitor rows, no identifiers, nothing to leak or disclose:

```sql
create table if not exists public.daily_stats (
  day date primary key,
  new_players integer not null default 0,
  active_24h integer not null default 0,
  recorded_at timestamptz not null default now()
);

alter table public.daily_stats enable row level security;
-- Deliberately no policies: only the dashboard (service role) reads this.
-- The cron reaches it solely through the function below.
```

The existing keep-alive workflow already pings Supabase on a schedule with the anon
key. It cannot read `auth.users` or other players' saves — correctly — so the snapshot
goes through a `security definer` function, exactly the pattern the save-code functions
in `supabase/schema.sql` already use:

```sql
create or replace function public.record_daily_stats()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  launch constant timestamptz := timestamptz '2026-07-29 00:00:00+00';
begin
  insert into public.daily_stats (day, new_players, active_24h, recorded_at)
  select
    current_date,
    (select count(*) from auth.users u
      where u.created_at >= launch and u.created_at::date = current_date),
    (select count(*) from auth.users u join public.saves s on s.user_id = u.id
      where u.created_at >= launch and s.updated_at > now() - interval '24 hours'),
    now()
  on conflict (day) do update
    set new_players = excluded.new_players,
        active_24h  = excluded.active_24h,
        recorded_at = excluded.recorded_at;
end;
$$;

grant execute on function public.record_daily_stats() to anon;
```

Granting `anon` execute is safe: the function takes no arguments, returns nothing,
reveals nothing to its caller, and upserts on `day`, so the worst a stranger can do is
make today's row recompute to the same numbers.

### Workflow change

`.github/workflows/keepalive.yml` currently runs every 3 days and pings a URL. It needs
to run **daily** (a day it doesn't run is a day with no data point) and call the RPC.
The call doubles as the keep-alive ping, so it replaces the existing curl rather than
adding to it:

```yaml
    - cron: '0 6 * * *'   # daily; also keeps Supabase awake
```

```yaml
      - name: Record daily stats (also keeps Supabase awake)
        run: |
          curl -sf -X POST "${{ secrets.SUPABASE_URL }}/rest/v1/rpc/record_daily_stats" \
            -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Content-Type: application/json" \
            -o /dev/null
```

Note GitHub's scheduled runners can be delayed or skipped under load, so treat the
series as "near-daily" rather than guaranteed.

---

## Caveats worth remembering when quoting these numbers

- **Browsers, not people.** An identity is per-browser-storage. Clearing storage, using
  a private window, or switching device creates a new one — so `new_players` runs
  somewhat high versus real humans.
- **No bounces.** Someone who closes the tab before the JS runs is never counted.
- **No referrer.** We cannot say how anyone found the game.
- **Test identities.** Excluded by the launch cutoff above, not deleted — a few
  pre-launch rows still exist in `saves` and will show up in any query that forgets the
  `created_at >= launch` filter.
