// saveCode.js — carry a save to another device with no email, no third
// party (issue #25). A short code is minted for the current save; typing it
// in on a new device copies that save (and leaderboard rows) onto the new
// device's own anonymous identity. See supabase/schema.sql for the
// create_save_code / preview_save_code / confirm_save_code functions this
// calls -- the actual database work (and the RLS lockdown of the save_codes
// table) lives there, not here.
//
// This is a one-time transfer, not a sign-in: after redeeming, the two
// devices are independent accounts again, same as any other pair of players.

import { isConfigured, getClient } from './cloud.js';

async function getSession() {
  if (!isConfigured()) return null;
  const client = await getClient();
  const { data: { session } } = await client.auth.getSession();
  return session ? { client, session } : null;
}

/** Mint a fresh one-hour code for this device's save. Returns the code, or
 *  null if it couldn't be created (not configured, no session, or an error). */
export async function createSaveCode() {
  try {
    const ctx = await getSession();
    if (!ctx) return null;
    const { data, error } = await ctx.client.rpc('create_save_code');
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('Could not create a save code:', err);
    return null;
  }
}

const isCodeError = (message) => /invalid|expired/i.test(message ?? '');

/** Look up what a code points to, without changing anything -- lets the
 *  caller show a confirmation ("found your paddock, N horses") before
 *  committing. Returns { ok: true, gameState } or { ok: false, reason }
 *  where reason is 'invalid' (bad/expired/already-used code) or 'error'
 *  (couldn't reach the service -- worth retrying). */
export async function previewSaveCode(code) {
  try {
    const ctx = await getSession();
    if (!ctx) return { ok: false, reason: 'error' };
    const { data, error } = await ctx.client.rpc('preview_save_code', { input_code: code.trim() });
    if (error) return { ok: false, reason: isCodeError(error.message) ? 'invalid' : 'error' };
    return { ok: true, gameState: data };
  } catch (err) {
    console.warn('Could not check that save code:', err);
    return { ok: false, reason: 'error' };
  }
}

/** Actually perform the transfer after the player has confirmed the preview.
 *  Returns 'ok' | 'invalid' | 'error'. On 'ok', the caller already has the
 *  game_state from previewSaveCode and should adopt it locally -- no need to
 *  fetch it again. */
export async function confirmSaveCode(code) {
  try {
    const ctx = await getSession();
    if (!ctx) return 'error';
    const { error } = await ctx.client.rpc('confirm_save_code', { input_code: code.trim() });
    if (error) return isCodeError(error.message) ? 'invalid' : 'error';
    return 'ok';
  } catch (err) {
    console.warn('Could not restore that save:', err);
    return 'error';
  }
}
