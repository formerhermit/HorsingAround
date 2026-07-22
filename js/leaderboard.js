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
import { isConfigured, getClient } from './cloud.js';

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
  const { data: { session } } = await client.auth.getSession();
  return session ? { client, session } : null;
}

/** Upsert this player's row for the current month. Fire-and-forget. */
export async function pushScore() {
  const lb = gameState.leaderboard;
  if (!lb.optedIn || !lb.name) return;
  try {
    const ctx = await getSession();
    if (!ctx) return;
    rolloverIfNeeded();
    await ctx.client.from('leaderboard').upsert({
      user_id: ctx.session.user.id,
      month: lb.month,
      display_name: lb.name,
      rescues: lb.rescues,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Leaderboard push failed, will retry on next rescue:', err);
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
