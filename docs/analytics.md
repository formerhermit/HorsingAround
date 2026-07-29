# Analytics: what we measure, and how (issue #161)

## The launch cutoff

**2026-07-29** is the day the game went out to ARCH. Every identity created before
that date is us testing, and would badly distort the baseline: a handful of test
players against a real audience of unknown size.

So the rule for every query below is: **count only identities whose
`auth.users.created_at >= '2026-07-29'`.** That excludes the test accounts once,
permanently, from every metric, rather than trying to remember to subtract them.

The date appears as a `launch` CTE at the top of each query so there's one place to
change it if the real launch date turns out to be different.

---

## Why not a third-party analytics service

We looked at GoatCounter, Cloudflare Web Analytics and GA4 (see the discussion in
issue #161). The decision was to use what we already store, because:

- The privacy notice promises **"No ads, no tracking, no analytics"** in bold. Querying
  records we already hold and already disclose is reporting, not tracking, so that
  promise stays intact and honest.
- Client-side analytics is blocked by adblockers, Brave, and Firefox strict mode, so
  it undercounts by an unpredictable margin. Our own data has no such gap.
- No new third party, no new processor, no new data collected, nothing added to the page.

What we give up is **referrer**: we cannot tell how people found the game. If that
ever becomes the question we most need answered, revisit GoatCounter then, and update
the privacy copy in the same change (see the note at the top of the privacy section
in `js/main.js`).

---

## Available now, no code change

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
3rd August" cannot be reconstructed after the fact. A player active in August and
again today only shows today.

Fixing that needs a daily snapshot, which is what the section below sets up.

---

## The daily snapshot (issue #161)

**The SQL lives in `supabase/schema.sql`** (the `daily_stats` block at the end), so
there's one copy rather than two that can drift. Run that block in the Supabase SQL
editor to deploy it. What follows is why it looks the way it does.

A `daily_stats` table holds **two integers per day and nothing else**: no per-visitor
rows, no identifiers, nothing to leak or disclose.

### Design notes

- **`active_24h` is nullable.** Null means "not measured" (a day backfilled before the
  job existed), which is a different thing from a measured zero.
- **It snapshots the day that has just finished**, not the one in progress. The cron
  runs early morning, so recording the current date would freeze a row holding only the
  first few hours of a day that hasn't happened yet.
- **`active_24h` is a rolling 24h window, not a calendar day.** A player here yesterday
  *and* today has had their `updated_at` overwritten to today, so bucketing by date
  would lose them. Running daily keeps the window close enough to read as "yesterday".
- **`new_players` gets backfilled** for every day since launch, because
  `auth.users.created_at` is never overwritten. `active_24h` stays null on those rows:
  it was never measured and can't be recovered.
- **The function is `security definer` and granted to `anon`**, so the cron can use the
  publishable key the keep-alive already holds rather than needing a new service-role
  secret. It takes no arguments, returns nothing, and no-ops if the day's row was
  written in the last 12 hours, so a stranger calling it achieves nothing. That guard
  also means a manual re-run inside the window is a no-op.
- **Dates are bucketed explicitly in UTC** rather than relying on the session timezone,
  so the series can't shift underneath us.

### The cron

`.github/workflows/keepalive.yml` now runs **daily** rather than every 3 days: a day it
doesn't run is a day with no data point, and unlike `new_players` the active count
can't be recovered afterwards.

It keeps the keep-alive ping as its own step, **before** the stats call and separate
from it. Stopping the project from pausing is the critical job, so it must not be able
to fail just because the stats function is missing or broken. The stats step then fails
loudly if the function isn't deployed, because silently recording nothing would look
exactly like nobody playing.

Note GitHub's scheduled runners can be delayed or skipped under load, so treat the
series as "near-daily" rather than guaranteed.

---

## Caveats worth remembering when quoting these numbers

- **Browsers, not people.** An identity is per-browser-storage. Clearing storage, using
  a private window, or switching device creates a new one, so `new_players` runs
  somewhat high versus real humans.
- **No bounces.** Someone who closes the tab before the JS runs is never counted.
- **No referrer.** We cannot say how anyone found the game.
- **Test identities.** Excluded by the launch cutoff above, not deleted. A few
  pre-launch rows still exist in `saves` and will show up in any query that forgets the
  `created_at >= launch` filter.
