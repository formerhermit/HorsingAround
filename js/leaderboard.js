// leaderboard.js — the monthly "Top rescuers" board (issue #15).
//
// Identity is always the anonymous auth user (auth.uid()); the stable name is
// only a display label, never a credential. Rows are keyed (user_id, month),
// so the board "resets" at midnight on the 1st simply by querying the new
// month — nothing is deleted, and past months survive for posterity.
//
// Like cloud saves, everything here is fire-and-forget and optional: the game
// never blocks on the board, and a player who never opts in sends nothing.

import { gameState } from './state.js';
import { isConfigured, getClient, getValidSession } from './cloud.js';

// Months follow ARCH's clock (Europe/Madrid), so the board rolls over at the
// same moment for everyone, wherever they play.
export function monthKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit',
  }).format(date); // "2026-07"
}

export function monthLabel(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', month: 'long', year: 'numeric',
  }).format(date); // "July 2026"
}

/** The previous month's key: "2026-06" while it's July. */
export function prevMonthKey(date = new Date()) {
  const [y, m] = monthKey(date).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Human label for the previous month ("June 2026"). */
export function prevMonthLabel(date = new Date()) {
  const [y, m] = prevMonthKey(date).split('-').map(Number);
  return monthLabel(new Date(Date.UTC(y, m - 1, 15)));
}

// ---- stable names ----
// Generated, never typed: no real names, no moderation burden, nothing for a
// child to overshare. Uniqueness is enforced by the database per month; on a
// collision the caller rerolls, falling back to a numbered variant.

const ADJECTIVES = [
  'Velvet', 'Dappled', 'Merry', 'Sunny', 'Breezy', 'Chestnut', 'Willow',
  'Clover', 'Amber', 'Bramble', 'Gentle', 'Dusty', 'Misty', 'Maple', 'Honey',
  'Pepper', 'Hazel', 'Rusty', 'Shady', 'Copper', 'Golden', 'Silver',
  'Speckled', 'Starlit', 'Meadow', 'Mellow', 'Nimble', 'Patchwork', 'Pebble',
  'Saffron', 'Toffee', 'Tumbling', 'Whistling', 'Woolly', 'Barley',
  'Cinnamon', 'Daisy', 'Fern', 'Ginger', 'Marigold',
];

const NOUNS = [
  'Canter', 'Gallop', 'Whinny', 'Trot', 'Mane', 'Fetlock', 'Paddock',
  'Hoofbeat', 'Nicker', 'Prance', 'Muzzle', 'Bridle', 'Saddle', 'Stirrup',
  'Halter', 'Forelock', 'Neigh', 'Snuffle', 'Clipclop', 'Haybale', 'Nosebag',
  'Pony', 'Filly', 'Farrier', 'Gambol', 'Frolic', 'Sugarlump', 'Horseshoe',
  'Meadowsweet', 'Bluebell',
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function generateName() {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

// ---- the month counter ----

/** Make the local counter belong to the current month; a stale counter from
 *  last month starts over at zero. Call before reading or bumping it. */
export function rolloverIfNeeded() {
  const lb = gameState.leaderboard;
  const now = monthKey();
  if (lb.month !== now) {
    lb.month = now;
    lb.rescues = 0;
  }
}

/** Count one rescue toward this month, and (if the player is on the board)
 *  sync it up. Called from the rescue action; cheap when opted out. */
export function recordRescue() {
  rolloverIfNeeded();
  gameState.leaderboard.rescues += 1;
  if (gameState.leaderboard.optedIn) pushScore();
}

// ---- cloud calls ----

async function getSession() {
  if (!isConfigured()) return null;
  const client = await getClient();
  // getValidSession refreshes a stale token before we write, so a long-lived
  // or just-woken tab doesn't silently drop leaderboard updates (see cloud.js).
  const session = await getValidSession(client);
  return session ? { client, session } : null;
}

/** Upsert this player's row for the current month. Fire-and-forget, but
 *  self-healing (issue #66): the old version never even looked at the upsert's
 *  error, so a push that failed — typically a display-name collision after a
 *  save crossed devices, since board rows are keyed per anonymous identity
 *  while the name travels inside the synced save — just froze that player's
 *  score on the board forever, silently. */
export async function pushScore() {
  const lb = gameState.leaderboard;
  if (!lb.optedIn || !lb.name) return;
  try {
    const ctx = await getSession();
    if (!ctx) return;
    rolloverIfNeeded();
    // The board never forgets: if our own cloud row already shows more
    // rescues than the local counter (a synced save can lag behind or have
    // regressed, see #67), adopt the higher number instead of writing the
    // score backwards.
    const { data: mine } = await ctx.client.from('leaderboard')
      .select('rescues')
      .eq('user_id', ctx.session.user.id).eq('month', lb.month)
      .maybeSingle();
    if (mine && mine.rescues > lb.rescues) lb.rescues = mine.rescues;

    const row = {
      user_id: ctx.session.user.id,
      month: lb.month,
      display_name: lb.name,
      rescues: lb.rescues,
      updated_at: new Date().toISOString(),
    };
    const { error } = await ctx.client.from('leaderboard').upsert(row);
    if (error && error.code === '23505') {
      // Our name is held by a different identity this month (usually our own
      // save arriving on a new device via a save code or an old sync mishap).
      // Reroll a fresh name for this identity and retry, so the score
      // unsticks instead of failing on every rescue for the rest of the month.
      for (let attempt = 0; attempt < 4; attempt++) {
        lb.name = attempt < 2 ? generateName() : `${generateName()} ${2 + Math.floor(Math.random() * 97)}`;
        const retry = await ctx.client.from('leaderboard').upsert({ ...row, display_name: lb.name });
        if (!retry.error) return;
        if (retry.error.code !== '23505') throw retry.error;
      }
    } else if (error) {
      throw error;
    }
  } catch (err) {
    console.warn('Leaderboard push failed, will retry on next rescue:', err);
  }
}

/** Last month's winner ({ name, rescues }), or null if that board was empty
 *  or unreachable. The reigning champion wears the rosette on this month's
 *  board until the next winner is crowned. */
export async function fetchChampion() {
  try {
    const ctx = await getSession();
    if (!ctx) return null;
    const { data, error } = await ctx.client
      .from('leaderboard')
      .select('display_name, rescues')
      .eq('month', prevMonthKey())
      .order('rescues', { ascending: false })
      .order('updated_at', { ascending: true }) // ties: first to the score wins
      .limit(1);
    if (error) throw error;
    return data?.[0] ? { name: data[0].display_name, rescues: data[0].rescues } : null;
  } catch (err) {
    console.warn('Could not load last month\'s champion:', err);
    return null;
  }
}

/**
 * Try to join this month's board under `name`. Distinguishes "that name is
 * taken this month" (caller should reroll) from real failures.
 * Returns 'ok' | 'taken' | 'error'.
 */
export async function joinBoard(name) {
  try {
    const ctx = await getSession();
    if (!ctx) return 'error';
    rolloverIfNeeded();
    const lb = gameState.leaderboard;
    // Upsert on the (user_id, month) key, so re-joining after leaving works;
    // a 23505 that still escapes is the per-month unique *name* index.
    const { error } = await ctx.client.from('leaderboard').upsert({
      user_id: ctx.session.user.id,
      month: lb.month,
      display_name: name,
      rescues: lb.rescues,
      updated_at: new Date().toISOString(),
    });
    if (error) return error.code === '23505' ? 'taken' : 'error';
    lb.optedIn = true;
    lb.name = name;
    return 'ok';
  } catch (err) {
    console.warn('Could not join the leaderboard:', err);
    return 'error';
  }
}

/** Fetch this month's top rows (plus whether each is the viewing player).
 *  Returns null when the board can't be reached. */
export async function fetchBoard(limit = 20) {
  try {
    const ctx = await getSession();
    if (!ctx) return null;
    const { data, error } = await ctx.client
      .from('leaderboard')
      .select('user_id, display_name, rescues')
      .eq('month', monthKey())
      .order('rescues', { ascending: false })
      .order('updated_at', { ascending: true }) // ties: first to the score wins
      .limit(limit);
    if (error) throw error;
    return data.map((row) => ({
      name: row.display_name,
      rescues: row.rescues,
      you: row.user_id === ctx.session.user.id,
    }));
  } catch (err) {
    console.warn('Could not load the leaderboard:', err);
    return null;
  }
}

/** Did THIS identity top last month's board? Returns { month, name, rescues }
 *  or null. Drives the once-per-won-month champion popup (issue #73). */
export async function fetchMyChampionship() {
  try {
    const ctx = await getSession();
    if (!ctx) return null;
    const { data, error } = await ctx.client
      .from('leaderboard')
      .select('user_id, display_name, rescues')
      .eq('month', prevMonthKey())
      .order('rescues', { ascending: false })
      .order('updated_at', { ascending: true }) // ties: first to the score wins
      .limit(1);
    if (error) throw error;
    const top = data?.[0];
    return top && top.user_id === ctx.session.user.id
      ? { month: prevMonthKey(), name: top.display_name, rescues: top.rescues }
      : null;
  } catch (err) {
    console.warn('Could not check last month\'s champion:', err);
    return null;
  }
}

/** Leave the board: delete every row (all months) and forget the name.
 *  The local month counter is kept, so re-joining credits the month so far. */
export async function leaveBoard() {
  try {
    const ctx = await getSession();
    if (!ctx) return false;
    const { error } = await ctx.client
      .from('leaderboard').delete().eq('user_id', ctx.session.user.id);
    if (error) throw error;
    const lb = gameState.leaderboard;
    lb.optedIn = false;
    lb.name = null;
    return true;
  } catch (err) {
    console.warn('Could not leave the leaderboard:', err);
    return false;
  }
}
