// google.js — optional Google sign-in, alongside save codes (issue #25).
//
// The game exposes one "Sign in with Google" button (main.js), which always
// tries linkGoogle() first -- the safe default, since it never discards
// whatever's on this device. Only if that Google account turns out to
// already have a save of its own does the game offer a real choice between
// the two saves, via signInWithGoogle():
//
//  - linkGoogle(): attach Google to THIS device's existing anonymous
//    account, so it can be reached from elsewhere later. The save doesn't
//    change -- the account just gains a second way in. Needs "Allow manual
//    linking" enabled in Supabase's Auth settings, or every attempt fails.
//    If the chosen Google account already belongs to a different Supabase
//    user, Supabase can't know that until the player has picked an account
//    on Google's side -- so this doesn't fail synchronously; it comes back
//    as an error on the redirect (see main.js's googleError handling).
//
//  - signInWithGoogle(marker): sign in fresh. Resolves to whichever account
//    this Google identity belongs to -- an existing one if already linked
//    elsewhere (replacing the local session), or a brand-new empty one if
//    it's never been linked at all. The marker distinguishes the two things
//    main.js does with that outcome: 'signin' just adopts whatever's there
//    ("load that save here instead"); 'override' means the caller stashed
//    this device's save first and intends to push it up in place of
//    whatever the other account had ("keep my progress instead") -- see
//    main.js's googleReturn handling for the stash/restore side of that.
//
// Both are full-page redirects to Google and back; there's nothing to
// return from these calls; the page navigates away immediately. A marker in
// the redirect URL (?google=linked|signin|override) tells main.js which flow
// just finished when the page reloads on return, so it can react accordingly
// -- simpler and more robust than trying to time an onAuthStateChange
// listener against Supabase's own URL-token parsing on boot.

import { isConfigured, getClient } from './cloud.js';

function redirectTarget(marker) {
  return `${location.origin}${location.pathname}?google=${marker}`;
}

export async function linkGoogle() {
  if (!isConfigured()) return;
  const client = await getClient();
  await client.auth.linkIdentity({ provider: 'google', options: { redirectTo: redirectTarget('linked') } });
}

export async function signInWithGoogle(marker = 'signin') {
  if (!isConfigured()) return;
  const client = await getClient();
  await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTarget(marker) } });
}

/** Is the current session's account already linked to Google? Drives the
 *  privacy popup's "Connect Google" vs "Google is connected" state. */
export async function isGoogleLinked() {
  if (!isConfigured()) return false;
  try {
    const client = await getClient();
    const { data: { session } } = await client.auth.getSession();
    return session?.user?.identities?.some((i) => i.provider === 'google') ?? false;
  } catch {
    return false;
  }
}
