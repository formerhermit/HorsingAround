// cloud.js — optional cloud save sync via Supabase.
//
// Local-first: initState() in state.js always renders from localStorage
// immediately, with zero network dependency, so the opening minute is never
// blocked on a request. This module layers cloud sync on top, in the
// background, once the page is already interactive.
//
// Every playtester gets a stable anonymous identity (a Supabase auth user)
// the first time they open the game, tied to their browser; their save
// follows that identity from then on.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { gameState, adoptCloudState } from './state.js';

let clientPromise = null;

// Cloud pushes are held until the boot reconciliation has settled (issue #67):
// the 15-second autosave (or any event save) firing before syncOnLoad() had
// decided could upsert this device's stale local save over a newer cloud one.
// That's the "my progress went backwards after syncing" report in a nutshell.
// syncOnLoad() and pullCloudSave() settle it themselves; the explicit
// keep-my-progress override path calls markSyncSettled() before its push.
let syncSettled = false;
export function markSyncSettled() {
  syncSettled = true;
}

// Shared with leaderboard.js, which talks to its own table over the same
// client and session.
export function isConfigured() {
  return SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR-PROJECT');
}

export function getClient() {
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return clientPromise;
}

/**
 * A session with a fresh-enough access token, ready to authorise a request.
 *
 * The supabase client auto-refreshes its hourly token on a timer, but a tab
 * that was suspended (a locked phone, a sleeping laptop, a discarded tab) can
 * wake with that timer having missed its window and an already-expired token —
 * and then every save and leaderboard write 401s, silently, until the page is
 * reloaded. So before a write we proactively refresh a token that's expired or
 * about to be. Crucially, a *failed* refresh keeps the existing session rather
 * than minting a new anonymous identity (which would orphan the player's cloud
 * save); a brand-new anonymous user is only ever created when there's genuinely
 * no session at all (a true first visit). Returns null only if auth is
 * unavailable.
 */
export async function getValidSession(client) {
  try {
    let { data: { session } } = await client.auth.getSession();
    if (!session) {
      // No identity yet (first visit / cleared storage): mint one. This is the
      // only path that creates a new anonymous user, so it can't lose a save.
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw error;
      return data.session;
    }
    const expiresMs = (session.expires_at ?? 0) * 1000;
    if (expiresMs && expiresMs - Date.now() < 90_000) { // expired, or within 90s
      const { data, error } = await client.auth.refreshSession();
      if (!error && data?.session) session = data.session;
      // A failed refresh falls through with the stale session: the write may
      // still fail (and a reload recovers), but we never swap identities.
    }
    return session;
  } catch (err) {
    console.warn('Could not establish a cloud session:', err);
    return null;
  }
}

/**
 * Ensure an anonymous Supabase session exists for this browser, pull any
 * existing cloud save, and reconcile it against the local one by whichever
 * was played more recently. Call once, after the first local render.
 *
 * `lastPlayedAt` is the local save's timestamp captured at boot, BEFORE the
 * boot save() stamps a fresh one. Comparing against gameState.savedAt here
 * was the heart of issue #67: the fresh stamp made this device's save always
 * look newest, so a device opened with weeks-old progress would "win" and
 * silently push its stale save over the cloud's good one.
 *
 * Returns true if cloud state was adopted (caller should re-render).
 */
export async function syncOnLoad(lastPlayedAt) {
  if (!isConfigured()) {
    console.info('Cloud sync not configured — playing locally only.');
    return false;
  }

  try {
    const client = await getClient();
    let { data: { session } } = await client.auth.getSession();
    if (!session) {
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw error;
      session = data.session;
    }

    const { data: row } = await client
      .from('saves')
      .select('game_state, updated_at')
      .maybeSingle();

    // A pristine local game (fresh default state: no care given, nothing
    // unlocked) never outranks an existing cloud save, whatever its
    // timestamp says — defaultState() is stamped with "now" at creation.
    const pristineLocal = gameState.stats.clicks === 0
      && gameState.stats.horsesRescued <= 1 && !gameState.unlocks.moneyUI;
    const localPlayedAt = lastPlayedAt ?? gameState.savedAt;
    if (row && (pristineLocal || !localPlayedAt || new Date(row.updated_at) > new Date(localPlayedAt))) {
      adoptCloudState(row.game_state);
      return true;
    }

    markSyncSettled(); // reconciliation decided: this device's save stands
    await pushCloudSave(); // first sync, or local was genuinely newer
    return false;
  } catch (err) {
    console.warn('Cloud sync failed, continuing locally:', err);
    return false;
  } finally {
    markSyncSettled(); // however it went, ordinary saves may flow again
  }
}

/**
 * Force-adopt whatever's in the current session's cloud row, ignoring local
 * timestamps entirely -- unlike syncOnLoad()'s "newer wins" reconciliation,
 * which is wrong here: after "Load other save" (js/google.js's signInWithGoogle
 * 'signin' path), the local device is often the one being actively played, so
 * its fresh savedAt would routinely "win" and silently keep the local game
 * instead of loading the other account's, which is the opposite of what an
 * explicit load action should do. Assumes a session already exists (true by
 * the time this runs post-OAuth-redirect); never writes, so it's safe to call
 * even if there's nothing to adopt. Returns true if a row was found and adopted.
 */
export async function pullCloudSave() {
  if (!isConfigured()) return false;
  try {
    const client = await getClient();
    const { data: row, error } = await client
      .from('saves')
      .select('game_state')
      .maybeSingle();
    if (error) throw error;
    if (!row) return false;
    adoptCloudState(row.game_state);
    return true;
  } catch (err) {
    console.warn('Could not load the other account’s save:', err);
    return false;
  } finally {
    markSyncSettled(); // the explicit load decided; ordinary saves may flow
  }
}

/** The anonymous player's cloud identity, for the privacy popup (so a player
 *  can quote it in a deletion request). Null when not configured / no session. */
export async function getCloudUserId() {
  if (!isConfigured()) return null;
  try {
    const client = await getClient();
    const { data: { session } } = await client.auth.getSession();
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Self-service erasure for the privacy popup: delete this player's cloud save
 * and drop the anonymous identity (a fresh one is minted on next visit).
 * Verifies the row is really gone -- a missing RLS delete policy makes
 * delete() silently match zero rows, and "we deleted your data" must never be
 * said on a silent failure. Returns true when the cloud holds nothing.
 */
export async function deleteCloudData() {
  if (!isConfigured()) return true; // nothing in the cloud to delete
  try {
    const client = await getClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) return true;
    const { error } = await client.from('saves').delete().eq('user_id', session.user.id);
    if (error) throw error;
    const { data: remaining } = await client.from('saves').select('user_id').maybeSingle();
    if (remaining) throw new Error('save row still present after delete');
    // Leaderboard entries go too (all months). PGRST205 = the table doesn't
    // exist yet on this deployment, which just means there's nothing to delete.
    const lbDel = await client.from('leaderboard').delete().eq('user_id', session.user.id);
    if (lbDel.error && lbDel.error.code !== 'PGRST205') throw lbDel.error;
    await client.auth.signOut();
    return true;
  } catch (err) {
    console.warn('Cloud delete failed:', err);
    return false;
  }
}

/** Push the current gameState to the cloud. Fire-and-forget; safe to call
 *  before a session exists (e.g. mid-boot) — it just no-ops until one does,
 *  and until the boot reconciliation has settled (see markSyncSettled). */
export async function pushCloudSave() {
  if (!isConfigured() || !syncSettled) return;
  try {
    const client = await getClient();
    const session = await getValidSession(client);
    if (!session) return;
    const { error } = await client.from('saves').upsert({
      user_id: session.user.id,
      game_state: gameState,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error; // previously ignored — a failed save was silent
  } catch (err) {
    console.warn('Cloud save failed, will retry next save:', err);
  }
}
