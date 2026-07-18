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

function isConfigured() {
  return SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR-PROJECT');
}

function getClient() {
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return clientPromise;
}

/**
 * Ensure an anonymous Supabase session exists for this browser, pull any
 * existing cloud save, and reconcile it against the local one by whichever
 * was saved more recently. Call once, after the first local render.
 * Returns true if cloud state was adopted (caller should re-render).
 */
export async function syncOnLoad() {
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

    if (row && (!gameState.savedAt || new Date(row.updated_at) > new Date(gameState.savedAt))) {
      adoptCloudState(row.game_state);
      return true;
    }

    await pushCloudSave(); // first sync, or local was newer — push it up
    return false;
  } catch (err) {
    console.warn('Cloud sync failed, continuing locally:', err);
    return false;
  }
}

/** Push the current gameState to the cloud. Fire-and-forget; safe to call
 *  before a session exists (e.g. mid-boot) — it just no-ops until one does. */
export async function pushCloudSave() {
  if (!isConfigured()) return;
  try {
    const client = await getClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    await client.from('saves').upsert({
      user_id: session.user.id,
      game_state: gameState,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Cloud save failed, will retry next save:', err);
  }
}
