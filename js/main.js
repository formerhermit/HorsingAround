// main.js — boot the game: load state, render, wire input and persistence.

import { initState, save, gameState, adoptCloudState, DONATE_MILESTONE, SAVE_KEY, disableSaving } from './state.js';
import { careFor, tick, rescueHorse, shareUpdate, rescueCost, acceptRehome, declineRehome, collectOfflineEarnings, collectDuePostcards, collectDueStatues, markPostcardsRead, fulfilWant, grantUnicorn, hasUnicorn } from './game.js';
import {
  renderAll, renderHUD, renderActions, updateHorseCard,
  showCareFeedback, showTipPop, showToast, showMoneyPop, showSupporterPop, changePaddock, resetPaddockView,
  showNudgePopup, hideNudgePopup, showDialog,
  renderShopButton, openShopModal, closeShopModal, renderShopModal, shopDecorPaddock, shopWardrobeHorse,
  renderPostcardButton, openPostcardAlbum, closePostcardAlbum,
  renderWantBubbles, showWantFulfilled,
  renderCollectionButton, openCollection, closeCollection, renderStats,
  formatDate,
} from './render.js';
import {
  buyDecorIn, buyWardrobe, placeDecor, removeDecor, placeWardrobe, removeWardrobe,
  hasNewAffordableItem,
} from './shop.js';
import { syncOnLoad, pushCloudSave, getCloudUserId, deleteCloudData } from './cloud.js';
import { createSaveCode, previewSaveCode, confirmSaveCode } from './saveCode.js';
import { linkGoogle, signInWithGoogle, isGoogleLinked } from './google.js';
import {
  monthLabel, generateName, rolloverIfNeeded, recordRescue,
  pushScore, joinBoard, fetchBoard, leaveBoard,
} from './leaderboard.js';
import { initShare } from './share.js';
import './audio.js';

// Wrap a key figure (a count, a € amount, a supporter tally) so it renders bold
// and green in a popup -- see the .fig rule and showDialog's innerHTML. Values
// are always numbers/short strings authored in-code, so plain interpolation is safe.
const fig = (v) => `<span class="fig">${v}</span>`;

// Visit index.html?reset to discard the save during development.
const reset = new URLSearchParams(location.search).has('reset');
const state = initState({ reset });

// Which Google flow (if any) we're returning from, per the ?google= marker
// google.js adds to its redirect URL -- see js/google.js for why this is
// simpler than timing an onAuthStateChange listener against Supabase's own
// URL-token parsing on boot. Read once, then scrub it from the address bar.
// Supabase appends its own error/error_description on a failed link -- check
// both query and hash, since which one depends on the OAuth flow type.
const googleQuery = new URLSearchParams(location.search);
const googleHash = new URLSearchParams(location.hash.replace(/^#/, ''));
const googleReturn = googleQuery.get('google');
const googleError = googleQuery.get('error_description') || googleQuery.get('error')
  || googleHash.get('error_description') || googleHash.get('error');
if (googleReturn) history.replaceState(null, '', location.pathname);

// Captured before save() stamps a fresh time: how long ago the last session was.
const lastPlayedAt = state.savedAt;

// Credit anything the rescue earned while the game was closed, before the first
// paint, so the HUD already shows the boosted totals. The summary (or null) is
// held for the welcome-back popup, shown once the dialog plumbing is set up.
const offlineSummary = collectOfflineEarnings(lastPlayedAt);

renderAll(state);
save(); // persist immediately so the save shape exists from first load

// ---- intro popup ----
// Brand-new players don't know clicking a horse does anything. A small toast
// was too easy to miss, so this is a big centred welcome card (the same modal
// as the other event dialogs) that introduces the rescue and points them at
// Biscuit. Shown once ever, a couple of seconds after load so the paddock has
// painted first, then dismissed with a single obvious button.
if (!state.milestones.introToastShown) {
  state.milestones.introToastShown = true;
  save();
  const first = state.horses[0]?.name ?? 'Biscuit';
  setTimeout(() => enqueueDialog({
    emoji: '🐴',
    text: `Welcome to your little horse rescue! This is ${fig(first)}, your very first rescue. He arrived tired and hungry, and needs some care to recover. Tap him to look after him, and watch him perk up 💛`,
    buttons: [{ label: `Let's help ${first}!`, variant: 'primary' }],
  }), 2000);
}

// (Onboarding nudges are re-asserted on load once their definitions below have
// run -- see the updateOnboardingNudges() call after the dismiss wiring.)

// ---- real-donation banner ----
// A permanent fixture at the foot of the screen (markup in index.html): always
// shown, never dismissible. Its "Donate to ARCH" link doubles as a way to earn
// the unicorn while it's unclaimed (see wireDonateButtons below).

// ---- the donation unicorn ----
// Well into the rescue (around DONATE_MILESTONE horses saved), offer a magical
// friend as a thank-you for donating to the real ARCH horses. Honor-based on
// the Donate click, since there's no way to verify the donation itself. This is
// the same beat as the 10-rescue "donate to ARCH" popup (see handleEvent), so
// the player only ever gets one donate prompt there, not two.
//
// The offer surfaces two ways: automatically once per session (maybeOfferUnicorn),
// and on demand whenever the player taps a Donate button while the unicorn is
// still unclaimed (see wireDonateButtons). Either way the magical friend stays
// winnable, so the auto-popup is never the single missable chance to get it.
let unicornSnoozed = false;

/** Open the real donation page and, honor-based, grant the unicorn as thanks. */
function claimUnicorn() {
  window.open(DONATE_URL, '_blank', 'noopener');
  const unicorn = grantUnicorn();
  if (unicorn) {
    resetPaddockView();
    renderAll(state);
    refreshUI();
    persist();
    setTimeout(() => showToast(`🦄 Thank you for helping the real horses. Say hello to ${unicorn.name}, your magical friend 💛`), 600);
  }
}

/** Show the magical-friend offer. Always shows (used for the on-demand Donate
 *  tap); the snooze/milestone gating lives in maybeOfferUnicorn. */
function offerUnicorn() {
  enqueueDialog({
    emoji: '🦄',
    text: 'The horses here are pretend, but the ones at ARCH are real, and they need help. Donate to the rescue and a magical friend will come to live in your paddock 💛',
    buttons: [
      { label: 'Donate 💛', variant: 'primary', onClick: claimUnicorn },
      { label: 'Not now', variant: 'ghost' },
    ],
  });
}

function maybeOfferUnicorn() {
  if (state.stats.horsesRescued < DONATE_MILESTONE || hasUnicorn(state)
      || state.milestones.donateOptOut || unicornSnoozed) return;
  unicornSnoozed = true; // one gentle ask per session
  offerUnicorn();
}

// The Donate buttons at the foot of the screen (the footer credit link and the
// donation banner) double as a way to earn the unicorn. While it's unclaimed, a
// tap opens the magical-friend offer instead of jumping straight to the donation
// page, so the reward is discoverable from every donate entry point. Once the
// unicorn is home, the links behave as plain donation links again.
function wireDonateButtons() {
  document.querySelectorAll('[data-donate]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (hasUnicorn(state)) return; // already won: let the link open normally
      e.preventDefault();
      offerUnicorn();
    });
  });
}

wireDonateButtons();

// Cloud sync is a background enhancement, never a blocker on first paint —
// Biscuit is already on screen and clickable before this resolves.
syncOnLoad().then((adopted) => {
  if (adopted) {
    resetPaddockView();
    renderAll(state);
    save();
  }
  // Whichever save won, make sure its leaderboard row is current (and rolled
  // over to the right month) once the session exists.
  pushScore();
  // Returning from a Google redirect. "linked" is the default action for the
  // one Google button -- if it failed, the near-universal reason is that this
  // Google account already has a save of its own elsewhere, so offer the
  // explicit switch rather than silently doing anything with what's here.
  // A successful link never changes local state (same account, same save),
  // so it's just a toast. "signin" is that explicit switch completing --
  // reconciliation above may have just adopted the other account's save.
  if (googleReturn === 'linked') {
    if (googleError) {
      openPrivacy().then(() => { document.getElementById('google-conflict').hidden = false; });
    } else {
      showToast('Google connected — this save can follow you now 💛', 'ok');
    }
  } else if (googleReturn === 'signin') {
    showToast(adopted ? 'Welcome back! Your Google save is here 💛' : 'Signed in with Google 💛', 'ok');
  }
});

// ---- input: click (or Enter/Space) on a horse = one care action ----

function refreshUI() {
  renderHUD(state);
  renderActions(state);
  renderShopButton(state);
  updateOnboardingNudges();
  updateRestoreWhisper();
}

// Three big centred call-to-action popups that teach the core loop, each with a
// playful arrow pointing at its button. Shown one at a time; each is snoozed
// individually once dismissed (so it doesn't nag), but dismissing one never
// hides the others -- the rescue and shop prompts still fire when their button
// goes live. Snoozes reset next visit while a goal is still outstanding.
/** The popup shown for a given onboarding goal. Rescue reads the first horse's
 *  name so it lands as "Biscuit wants a friend", not a generic prompt. */
function nudgeConfig(id) {
  if (id === 'share') return {
    emoji: '💛', dir: 'down',
    text: 'You can raise money for the rescue! Tap “Share an update” below to chat with your supporters on social media.',
  };
  if (id === 'rescue') {
    const first = state.horses[0]?.name ?? 'your horse';
    return {
      emoji: '🐴', dir: 'down',
      text: `You've saved enough to help another horse: tap “Rescue another horse” below to get ${first} a friend.`,
    };
  }
  if (id === 'collection') return {
    emoji: '📖', dir: 'up-right',
    text: "You've rescued a whole paddock! Tap the book up top to see every horse type there is, and which you've collected so far.",
  };
  if (id === 'left-behind') return {
    emoji: '🧣', dir: 'up-right',
    text: `${leftBehindHorseName} has gone to their new home, but left their outfit behind. It's waiting in your Tack room up top, ready for another horse.`,
  };
  if (id === 'leaderboard') return {
    emoji: '🏆', dir: 'up-right',
    text: "Rescuers like you are on this month's Top rescuers board. It lives in the book up top, if you'd like to join in.",
  };
  return {
    emoji: '🛍️', dir: 'up-right',
    text: 'The Tack room is open! Tap the button up top to dress your horses and decorate the paddock.',
  };
}

const snoozedNudges = new Set(); // nudge ids dismissed this session
// A rehomed horse's clothes have just landed in the stores; show the one-time
// explainer on the next nudge sweep. Cleared (and never repeated) once seen.
let leftBehindPending = false;
let leftBehindHorseName = '';

/** The highest-priority onboarding goal that's outstanding and not snoozed, or
 *  null. Rescue and shop only surface once they're actually actionable -- enough
 *  money for the first rescue, or an affordable item in the shop -- so their
 *  arrow always points at a button the player can use right now. */
function pendingNudge() {
  const m = state.milestones;
  const candidates = [];
  if (leftBehindPending && !m.leftBehindShown) candidates.push('left-behind');
  // Armed by collecting a rescue milestone, then persisted. It outranks the
  // shop/collection nudges: those re-assert themselves every session until
  // resolved, whereas this introduction belongs to the milestone moment --
  // behind the shop nudge it would wait forever for a player who never opens
  // the Tack room. (Share/rescue can't collide: both are long done by the
  // time a milestone is collectable.)
  if (m.leaderboardNudgeQueued && !m.leaderboardNudgeShown && !state.leaderboard.optedIn) candidates.push('leaderboard');
  if (state.unlocks.moneyUI && !m.hasSharedUpdate) candidates.push('share');
  if (state.unlocks.rescue && !m.hasRescuedAgain && state.coins >= rescueCost(state)) candidates.push('rescue');
  if (state.unlocks.moneyUI && !m.shopIntroDone && hasNewAffordableItem(state)) candidates.push('shop');
  if (state.stats.horsesRescued >= 8 && !m.collectionIntroDone) candidates.push('collection');
  return candidates.find((id) => !snoozedNudges.has(id)) ?? null;
}

function updateOnboardingNudges() {
  const id = pendingNudge();
  if (id) showNudgePopup(id, nudgeConfig(id));
  else hideNudgePopup();
}

// Only the "Got it!" button dismisses -- clicking the dimmed background does
// nothing, so a player can't skip past the prompt by accident. Snoozes just the
// popup that's showing, so a later prompt still fires when its button goes live.
document.getElementById('nudge-dismiss').addEventListener('click', () => {
  const id = document.getElementById('nudge-overlay').dataset.nudge;
  if (id) snoozedNudges.add(id);
  if (id === 'collection') { state.milestones.collectionIntroDone = true; save(); }
  if (id === 'left-behind') { state.milestones.leftBehindShown = true; leftBehindPending = false; save(); }
  if (id === 'leaderboard') { state.milestones.leaderboardNudgeShown = true; save(); }
  hideNudgePopup();
});

// Re-assert the onboarding nudge on load: a player who unlocked money but never
// shared (or found the shop, or grew the herd) still gets the prompt on return.
updateOnboardingNudges();

function persist() {
  save();
  pushCloudSave();
}

// Modal event dialogs (rehoming offers, milestone rewards) show one at a time.
const dialogQueue = [];
let dialogActive = false;

function enqueueDialog(spec) {
  dialogQueue.push(spec);
  pumpDialogs();
}

function pumpDialogs() {
  if (dialogActive || dialogQueue.length === 0) return;
  // Don't interrupt the open shop (the "tack room"): a rehome offer popping up
  // over it is confusing -- you could adopt a horse that's still listed for
  // dressing in the shop. Hold queued dialogs; closing the shop re-pumps them.
  if (!document.getElementById('shop-overlay').hidden) return;
  dialogActive = true;
  const spec = dialogQueue.shift();
  showDialog({
    ...spec,
    buttons: spec.buttons.map((b) => ({
      ...b,
      onClick: () => { b.onClick?.(); dialogActive = false; pumpDialogs(); },
    })),
  });
}

// ---- welcome back ----
// A warm summary of what the rescue earned while the game was closed. The money
// and supporters were already credited at boot; this just tells the story.

/** "2h 14m", "45m" — the human-friendly length of a trip away. */
function formatAway(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function showWelcomeBack(summary) {
  const money = Math.floor(summary.income);
  const parts = [`your supporters donated ${fig(`€${money}`)}`];
  if (summary.newSupporters > 0) {
    parts.push(summary.newSupporters === 1
      ? `${fig('1')} new supporter found the rescue`
      : `${fig(summary.newSupporters)} new supporters found the rescue`);
  }
  // A random horse "missed you" — the personal touch that makes it warm.
  const horse = state.horses[Math.floor(Math.random() * state.horses.length)];
  const earnings = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0];
  enqueueDialog({
    emoji: '💛',
    text: `Welcome back! While you were away (${formatAway(summary.awaySeconds)}), ${earnings}. ${horse.name} missed you 🐴`,
    buttons: [{ label: 'Lovely!', variant: 'primary' }],
  });
}

if (offlineSummary) showWelcomeBack(offlineSummary);

// ---- postcards ----
// Deliver any postcards that have come due (checked on load and each tick, so
// ones that matured while the game was closed are waiting on return) and toast
// them. The first one explains the album; later ones just announce themselves.
function deliverPostcards(due) {
  if (!due.length) return;
  const first = !state.milestones.firstPostcardShown;
  state.milestones.firstPostcardShown = true;
  if (due.length === 1) {
    showToast(first
      ? `💌 ${due[0].name} sent a postcard from their new home. Find it in your album up top!`
      : `💌 A postcard arrived from ${due[0].name}!`);
  } else {
    showToast(`💌 ${due.length} postcards arrived from horses you've rehomed!`);
  }
  renderPostcardButton(state);
  persist();
}

// A postcard milestone may have earned a keepsake statue. Runs after every
// delivery and once on load (catching up returning players), independent of
// whether any new postcards arrived this time.
function grantStatues() {
  const granted = collectDueStatues(state);
  if (!granted.length) return;
  if (granted.length === 1) {
    const s = granted[0];
    showToast(s.placed
      ? `🏆 A ${s.name.toLowerCase()} arrived in your paddock, a keepsake for the horses you've rehomed 💛`
      : `🏆 A ${s.name.toLowerCase()} is waiting in your Tack room, a keepsake for the horses you've rehomed 💛`);
  } else {
    showToast(`🏆 ${granted.length} keepsake statues arrived for the horses you've rehomed. Check your paddock and Tack room 💛`);
  }
  if (granted.some((s) => s.placed)) renderAll(state); // show any auto-placed statue
  refreshUI(); // badge the Tack room for any that went to the stores
  persist();
}

deliverPostcards(collectDuePostcards());
grantStatues();

const DONATE_URL = 'https://donorbox.org/donate-to-arch?amount=10';

/** Turn one event into either a toast or a queued modal dialog. */
function handleEvent(e) {
  if (e.type === 'rehome-offer') {
    enqueueDialog({
      emoji: '🏡',
      text: `${e.horseName} is ready for rehoming. Agree to adoption for ${fig(`€${e.income}`)}?`,
      buttons: [
        { label: 'Yes please!', variant: 'primary', onClick: () => {
          const res = acceptRehome();
          if (res) {
            if (res.leftBehind && !state.milestones.leftBehindShown) {
              leftBehindHorseName = res.horse.name;
              leftBehindPending = true; // refreshUI's nudge sweep will surface it
            }
            resetPaddockView(); renderAll(state); refreshUI(); persist();
          }
        } },
        { label: 'Not now', variant: 'ghost', onClick: () => declineRehome() },
      ],
    });
  } else if (e.type === 'rescue-milestone') {
    enqueueDialog({
      emoji: '🎉', share: true,
      text: `You have rescued ${fig(e.count)} horses. What an amazing job you're doing! Here's ${fig(`€${e.bonus}`)} extra to keep up the good work.`,
      buttons: [{ label: 'Collect', variant: 'primary', onClick: () => {
        // First rescue milestone doubles as the leaderboard's introduction.
        // Queued persistently: if another onboarding nudge holds the slot
        // right now, this one shows at a later sweep instead of being lost.
        if (!state.milestones.leaderboardNudgeShown && !state.leaderboard.optedIn) {
          state.milestones.leaderboardNudgeQueued = true;
          save();
          updateOnboardingNudges();
        }
      } }],
    });
  } else if (e.type === 'rehome-milestone') {
    enqueueDialog({
      emoji: '🎉', share: true,
      text: `You have re-homed ${fig(e.count)} horses. What an amazing job you're doing! Here's ${fig(`€${e.bonus}`)} extra to keep up the good work.`,
      buttons: [{ label: 'Collect', variant: 'primary' }],
    });
  } else if (e.type === 'gift-horse') {
    // A magical gift horse (rainbow at 50, golden at 100). It's already in the
    // herd; show it, then a congratulations popup.
    resetPaddockView();
    renderAll(state);
    const kind = e.coat === 'golden' ? 'golden horse 🌟' : 'rainbow horse 🌈';
    enqueueDialog({
      emoji: e.coat === 'golden' ? '🌟' : '🌈', confetti: true, share: true,
      text: `You've saved ${fig(e.count)} horses! 🎉 That's an incredible thing to have done, so here's a gift: a magical ${kind} has come to live in your paddock. Say hello to ${e.name}!`,
      buttons: [{ label: 'Wonderful!', variant: 'primary' }],
    });
  } else if (e.type === 'donate-milestone') {
    // The 10-rescue donate beat. If the unicorn's still unclaimed, this is where
    // it's offered (the magical-friend ask, with confetti); once it's home the
    // same beat becomes a plain thank-you donate nudge.
    if (hasUnicorn(state)) {
      enqueueDialog({
        emoji: '💛', confetti: true,
        text: `You have rescued ${fig(e.count)} horses. If you're enjoying this game, why not donate to ARCH to help our real horses too?`,
        buttons: [
          { label: 'Donate', variant: 'primary', onClick: () => window.open(DONATE_URL, '_blank', 'noopener') },
          { label: "Don't ask again", variant: 'ghost', onClick: () => { state.milestones.donateOptOut = true; save(); } },
        ],
      });
    } else {
      unicornSnoozed = true; // this beat is the session's unicorn offer; don't double up
      enqueueDialog({
        emoji: '🦄', confetti: true,
        text: `You've rescued ${fig(e.count)} horses! The ones here are pretend, but the horses at ARCH are real, and they need help. Donate to the rescue and a magical friend will come to live in your paddock 💛`,
        buttons: [
          { label: 'Donate 💛', variant: 'primary', onClick: claimUnicorn },
          { label: "Don't ask again", variant: 'ghost', onClick: () => { state.milestones.donateOptOut = true; save(); } },
        ],
      });
    }
  } else if (e.type === 'supporter-quiet') {
    showSupporterPop(e.count); // subtle chip pop, not a toast
  } else if (e.type === 'supporter-milestone') {
    showToast(`🎉 ${e.count} people now follow the rescue 💛`);
  } else {
    showToast(e.message);
  }
}

function processEvents(events) {
  if (!events.length) return;
  events.forEach(handleEvent);
  // The unicorn offer isn't fired here: the 10-rescue 'donate-milestone' event
  // (handled above) is the single trigger for the crossing, and maybeOfferUnicorn
  // on load covers returning players. Firing it here too would double the popup.
  refreshUI();
  persist(); // story beats are worth persisting immediately
}

function handleCare(card, event) {
  const horse = state.horses.find((h) => h.id === card.dataset.horseId);
  if (!horse) return;
  // A tap on a horse that wants something tends the want; otherwise it's a
  // normal care click. Either way the tap still cares for the horse.
  const want = fulfilWant(horse.id);
  const { message, crit, tip, events } = careFor(horse);
  updateHorseCard(horse);
  if (want) {
    showWantFulfilled(card, want, event); // its own flavour + supporter-burst pops
    renderWantBubbles(state);             // clear the tended bubble
    renderHUD(state);                     // supporters jumped
    persist();
  } else {
    showCareFeedback(card, message, event, { crit });
  }
  if (tip) {
    showTipPop(card, tip);
    renderHUD(state); // the tip lands in the fund right away
    persist();        // money changed — tips are rare enough to save on the spot
  }
  processEvents(events);
}

const horsesEl = document.getElementById('horses');

horsesEl.addEventListener('click', (event) => {
  const card = event.target.closest('.horse');
  if (card) handleCare(card, event);
});

document.getElementById('actions').addEventListener('click', (event) => {
  if (event.target.closest('#share-btn')) {
    const { amount } = shareUpdate();
    showMoneyPop(amount);
    if (!state.milestones.hasSharedUpdate) {
      state.milestones.hasSharedUpdate = true;
      save();
    }
    refreshUI(); // dismisses the share nudge, then surfaces the shop nudge
    return;
  }
  if (event.target.closest('#rescue-btn')) {
    const { ok, reason, events } = rescueHorse();
    if (ok) {
      recordRescue(); // count it toward this month's leaderboard
      state.milestones.hasRescuedAgain = true; // resolves the rescue nudge
      resetPaddockView(); // always show the new arrival
      renderAll(state);
      processEvents(events);
    } else if (reason === 'needs-care') {
      showToast('You still have horses which need help', 'alert');
    }
  }
});

document.getElementById('nav-older').addEventListener('click', () => changePaddock(1, state));
document.getElementById('nav-newer').addEventListener('click', () => changePaddock(-1, state));

// ---- shop ----

document.getElementById('shop-btn').addEventListener('click', () => {
  if (!state.milestones.shopIntroDone) {
    state.milestones.shopIntroDone = true;
    save();
  }
  updateOnboardingNudges(); // clears the shop nudge if it was up
  openShopModal(state);
});
// Close the shop, then flush any dialogs (rehome offers, milestones) that were
// held back while it was open -- see the guard in pumpDialogs.
function closeShop() {
  closeShopModal();
  pumpDialogs();
}
document.getElementById('shop-close').addEventListener('click', closeShop);
document.getElementById('shop-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'shop-overlay') closeShop();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!document.getElementById('shop-overlay').hidden) closeShop();
  if (!document.getElementById('album-overlay').hidden) closePostcardAlbum();
  if (!document.getElementById('collection-overlay').hidden) closeCollection();
  if (!document.getElementById('privacy-overlay').hidden) closePrivacy();
});

// ---- privacy popup ----
// NOTE: this popup is the game's privacy notice. Any feature that changes what
// data is collected, stored, or shown publicly (email linking, leaderboard,
// analytics, ...) must update its copy in the same change.

function closePrivacy() {
  document.getElementById('privacy-overlay').hidden = true;
}
async function openPrivacy() {
  document.getElementById('privacy-overlay').hidden = false;
  // Fill in the anonymous cloud id so a player can quote it in a deletion
  // request; resolves after the popup is already up, so no waiting.
  const id = await getCloudUserId();
  document.getElementById('privacy-player-id').textContent =
    id ?? 'none: playing locally in this browser only';

  // Once Google's linked, there's no reason to offer linking it again --
  // swap the button for a plain status line instead. The conflict card is
  // only ever revealed right after a real conflict (see googleReturn
  // handling above), so a normal open always starts with it hidden.
  document.getElementById('google-conflict').hidden = true;
  const linked = await isGoogleLinked();
  document.getElementById('google-signin-btn').hidden = linked;
  const status = document.getElementById('google-status');
  status.hidden = !linked;
  if (linked) status.textContent = 'Google is connected to this save.';
}
document.getElementById('privacy-link').addEventListener('click', openPrivacy);
document.getElementById('privacy-close').addEventListener('click', closePrivacy);
document.getElementById('privacy-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'privacy-overlay') closePrivacy();
});

// Data portability: hand the player their whole save as a JSON download.
document.getElementById('privacy-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(gameState, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `horsing-around-save-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Self-service erasure: two taps (the button re-labels itself as the confirm
// step, and disarms after a few seconds), then cloud row + local save are
// wiped and the page reloads into a fresh game. If the cloud half fails, say
// so and delete nothing -- a half-truthful "all gone" would be worse than an
// error.
const deleteBtn = document.getElementById('privacy-delete');
const DELETE_LABEL = deleteBtn.textContent;
let deleteArmedTimer = null;
deleteBtn.addEventListener('click', async () => {
  if (!deleteArmedTimer) {
    deleteBtn.textContent = 'Really delete everything? Tap again';
    deleteBtn.classList.add('is-armed');
    deleteArmedTimer = setTimeout(() => {
      deleteArmedTimer = null;
      deleteBtn.textContent = DELETE_LABEL;
      deleteBtn.classList.remove('is-armed');
    }, 6000);
    return;
  }
  clearTimeout(deleteArmedTimer);
  deleteBtn.disabled = true;
  deleteBtn.textContent = 'Deleting…';
  const cloudGone = await deleteCloudData();
  if (!cloudGone) {
    deleteBtn.disabled = false;
    deleteArmedTimer = null;
    deleteBtn.textContent = 'Couldn’t reach the cloud, nothing deleted. Try again?';
    deleteBtn.classList.remove('is-armed');
    return;
  }
  // The beforeunload/visibilitychange handlers fire during the reload and
  // would write the save straight back -- shut saving off before wiping.
  disableSaving();
  localStorage.removeItem(SAVE_KEY);
  location.replace(location.pathname);
});

// ---- save across devices (issue #25): no-email cross-device transfer ----
// A code minted for this save copies it onto whichever device redeems it.
// Not a sign-in -- see js/saveCode.js for why, and supabase/schema.sql for
// the security-definer functions that do the actual work.

const scGetCodeBtn = document.getElementById('sc-get-code');
const scCodeDisplay = document.getElementById('sc-code-display');
const scCodeValue = document.getElementById('sc-code-value');
const scCodeEntry = document.getElementById('sc-code-entry');
const scCodeInput = document.getElementById('sc-code-input');
const scCodeSubmit = document.getElementById('sc-code-submit');
const scCodeError = document.getElementById('sc-code-error');
const scConfirm = document.getElementById('sc-confirm');
const scConfirmText = document.getElementById('sc-confirm-text');
const scConfirmLoad = document.getElementById('sc-confirm-load');

let scPreviewedState = null; // the game_state previewSaveCode found, awaiting confirm
let scPreviewedCode = null;

function scResetPanels() {
  scCodeDisplay.hidden = true;
  scCodeEntry.hidden = true;
  scConfirm.hidden = true;
  scCodeError.hidden = true;
  scCodeInput.value = '';
  scPreviewedState = null;
  scPreviewedCode = null;
}

scGetCodeBtn.addEventListener('click', async () => {
  scResetPanels();
  scGetCodeBtn.disabled = true;
  scGetCodeBtn.textContent = 'Getting a code…';
  const code = await createSaveCode();
  scGetCodeBtn.disabled = false;
  scGetCodeBtn.textContent = 'Get a code for this device';
  if (!code) {
    showToast('Couldn’t reach the service just now. Try again in a bit.', 'alert');
    return;
  }
  scCodeValue.textContent = code;
  scCodeDisplay.hidden = false;
});

function openSaveCodeEntry() {
  scResetPanels();
  scCodeEntry.hidden = false;
  scCodeInput.focus();
}
document.getElementById('sc-open-entry').addEventListener('click', openSaveCodeEntry);

scCodeSubmit.addEventListener('click', async () => {
  const code = scCodeInput.value.trim();
  if (!code) return;
  scCodeSubmit.disabled = true;
  scCodeSubmit.textContent = 'Looking up…';
  const result = await previewSaveCode(code);
  scCodeSubmit.disabled = false;
  scCodeSubmit.textContent = 'Look it up';
  if (!result.ok) {
    scCodeError.hidden = false;
    scCodeError.textContent = result.reason === 'invalid'
      ? 'That code isn’t valid, or it’s expired. Double-check it, or get a new one on the other device.'
      : 'Couldn’t reach the service just now. Try again in a bit.';
    return;
  }
  scCodeError.hidden = true;
  scPreviewedState = result.gameState;
  scPreviewedCode = code;
  const horseCount = result.gameState?.horses?.length ?? 0;
  const since = result.gameState?.stats?.startedAt ? formatDate(result.gameState.stats.startedAt) : null;
  scConfirmText.textContent = `Found a paddock with ${horseCount} ${horseCount === 1 ? 'horse' : 'horses'}` +
    (since ? `, caring since ${since}` : '') + '. Load it here?';
  scCodeEntry.hidden = true;
  scConfirm.hidden = false;
});

document.getElementById('sc-confirm-cancel').addEventListener('click', scResetPanels);

scConfirmLoad.addEventListener('click', async () => {
  if (!scPreviewedCode || !scPreviewedState) return;
  scConfirmLoad.disabled = true;
  scConfirmLoad.textContent = 'Loading…';
  const result = await confirmSaveCode(scPreviewedCode);
  scConfirmLoad.disabled = false;
  scConfirmLoad.textContent = 'Load it here';
  if (result !== 'ok') {
    showToast(result === 'invalid'
      ? 'That code just expired or was already used. Get a fresh one on the other device.'
      : 'Couldn’t reach the service just now. Try again in a bit.', 'alert');
    return;
  }
  adoptCloudState(scPreviewedState);
  state.milestones.restoreWhisperRetired = true; // they've got their real game now
  scResetPanels();
  closePrivacy();
  resetPaddockView();
  renderAll(state);
  refreshUI();
  save();
  pushCloudSave(); // this device's cloud row should reflect the adopted state too
  showToast('Welcome back! Your paddock is here 💛', 'ok');
});

// Google sign-in: the same two-flow split as save codes, since a single
// button can't tell "attach Google here" from "sign in from elsewhere"
// apart. Both redirect away immediately -- see js/google.js for why the
// feedback toast happens on the *next* load instead of here.
// One button, one safe default: always try to attach Google to this save
// first. If that Google account turns out to already have a save of its own,
// Supabase reports it as an error on the redirect back (see googleReturn
// handling above), and only THEN does the game offer the explicit switch --
// "Load that save here instead" -- as its own confirmed action.
document.getElementById('google-signin-btn').addEventListener('click', () => linkGoogle());
document.getElementById('google-conflict-switch').addEventListener('click', () => signInWithGoogle());
document.getElementById('google-conflict-cancel').addEventListener('click', () => {
  document.getElementById('google-conflict').hidden = true;
});

// The header whisper: quiet, and only ever seen on a brand-new save (see
// updateRestoreWhisper). Jumps straight to the code-entry step, since anyone
// who taps this already knows what they want.
document.getElementById('restore-whisper').addEventListener('click', async () => {
  await openPrivacy();
  openSaveCodeEntry();
});

const RESTORE_WHISPER_MS = 10 * 60 * 1000; // 10 minutes of play retires it
function updateRestoreWhisper() {
  const whisper = document.getElementById('restore-whisper');
  const m = state.milestones;
  if (m.restoreWhisperRetired) {
    whisper.hidden = true;
    return;
  }
  const outgrown = state.stats.horsesRescued > 1 // more than just Biscuit
    || Date.now() - state.stats.startedAt > RESTORE_WHISPER_MS;
  if (outgrown) {
    m.restoreWhisperRetired = true;
    whisper.hidden = true;
    save();
    return;
  }
  whisper.hidden = false;
}
updateRestoreWhisper();

// ---- postcard album ----

document.getElementById('album-btn').addEventListener('click', () => {
  markPostcardsRead(state);   // opening the album clears the unread badge
  openPostcardAlbum(state);
  renderPostcardButton(state);
  persist();
});
document.getElementById('album-close').addEventListener('click', closePostcardAlbum);
document.getElementById('album-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'album-overlay') closePostcardAlbum();
});

// ---- collection book ----

// Switch between the tabs inside the collection modal.
const COLLECTION_TABS = {
  collection:  { tab: 'tab-collection',  panel: 'panel-collection',  title: 'Collection' },
  stats:       { tab: 'tab-stats',       panel: 'panel-stats',       title: 'Stats' },
  leaderboard: { tab: 'tab-leaderboard', panel: 'panel-leaderboard', title: 'Top rescuers' },
};

function showCollectionTab(name) {
  for (const [key, ids] of Object.entries(COLLECTION_TABS)) {
    const active = key === name;
    document.getElementById(ids.panel).hidden = !active;
    const tab = document.getElementById(ids.tab);
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  document.getElementById('collection-title').textContent = COLLECTION_TABS[name].title;
  if (name === 'stats') renderStats(state);
  if (name === 'leaderboard') renderLeaderboardPanel();
}

document.getElementById('collection-btn').addEventListener('click', () => {
  state.collectionSeen = state.collectedCoats.length; // clear the "new" dot
  state.milestones.collectionIntroDone = true;        // they've found it; no nudge needed
  showCollectionTab('collection'); // always open on the Collection tab
  openCollection(state);
  renderCollectionButton(state);
  updateOnboardingNudges(); // clears the collection nudge if it's up
  persist();
});
document.getElementById('tab-collection').addEventListener('click', () => showCollectionTab('collection'));
document.getElementById('tab-stats').addEventListener('click', () => showCollectionTab('stats'));
document.getElementById('tab-leaderboard').addEventListener('click', () => showCollectionTab('leaderboard'));

// ---- monthly leaderboard panel ----

let lbPreviewName = null; // the generated name on offer in the join card

async function renderLeaderboardPanel() {
  rolloverIfNeeded();
  const lb = state.leaderboard;
  // They've found the board; the milestone nudge needn't ever fire.
  if (!state.milestones.leaderboardNudgeShown) {
    state.milestones.leaderboardNudgeShown = true;
    save();
  }
  document.getElementById('leaderboard-intro').textContent =
    `Top rescuers for ${monthLabel()}. The board starts fresh on the 1st of each month.`;
  document.getElementById('leaderboard-join').hidden = lb.optedIn;
  document.getElementById('leaderboard-board').hidden = !lb.optedIn;

  if (!lb.optedIn) {
    lbPreviewName ??= generateName();
    document.getElementById('lb-name-preview').textContent = lbPreviewName;
    return;
  }

  document.getElementById('lb-own-name').textContent = lb.name;
  const list = document.getElementById('lb-list');
  list.innerHTML = '<li class="lb-status">Loading the board…</li>';
  await pushScore(); // our row should be current before we read
  const rows = await fetchBoard();
  if (!rows) {
    list.innerHTML = '<li class="lb-status">Couldn\'t reach the board just now. Try again in a bit.</li>';
    return;
  }
  if (rows.length === 0) {
    list.innerHTML = '<li class="lb-status">Nobody on the board yet this month.</li>';
    return;
  }
  list.innerHTML = '';
  rows.forEach((row, i) => {
    const li = document.createElement('li');
    li.className = 'lb-row' + (row.you ? ' lb-you' : '');
    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    rank.textContent = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`;
    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = row.name + (row.you ? ' (you)' : '');
    const score = document.createElement('span');
    score.className = 'lb-score';
    score.textContent = `${row.rescues} ${row.rescues === 1 ? 'rescue' : 'rescues'}`;
    li.append(rank, name, score);
    list.appendChild(li);
  });
}

document.getElementById('lb-reroll').addEventListener('click', () => {
  lbPreviewName = generateName();
  document.getElementById('lb-name-preview').textContent = lbPreviewName;
});

document.getElementById('lb-join').addEventListener('click', async () => {
  const btn = document.getElementById('lb-join');
  btn.disabled = true;
  btn.textContent = 'Joining…';
  // The database enforces one name per month; on a collision quietly reroll,
  // falling back to a numbered variant so joining never dead-ends.
  let name = lbPreviewName ?? generateName();
  let result = 'error';
  for (let attempt = 0; attempt < 6; attempt++) {
    result = await joinBoard(name);
    if (result !== 'taken') break;
    name = attempt < 3 ? generateName() : `${generateName()} ${2 + Math.floor(Math.random() * 97)}`;
  }
  btn.disabled = false;
  btn.textContent = 'Join the board';
  if (result !== 'ok') {
    showToast('Couldn\'t reach the board just now. Try again in a bit.', 'alert');
    return;
  }
  lbPreviewName = null;
  persist();
  renderLeaderboardPanel();
});

document.getElementById('lb-leave').addEventListener('click', async () => {
  const btn = document.getElementById('lb-leave');
  btn.disabled = true;
  const ok = await leaveBoard();
  btn.disabled = false;
  if (!ok) {
    showToast('Couldn\'t reach the board just now. Try again in a bit.', 'alert');
    return;
  }
  persist();
  renderLeaderboardPanel();
});
document.getElementById('collection-close').addEventListener('click', closeCollection);
document.getElementById('collection-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'collection-overlay') closeCollection();
});

// ---- social sharing ----
// One delegated listener for every [data-share-game] button (postcards +
// collection headers today; anywhere they're added later, for free).
initShare();

document.getElementById('shop-modal').addEventListener('click', (event) => {
  const buy = event.target.closest('.shop-buy-btn');
  const action = event.target.closest('[data-action]');
  if (!buy && !action) return;
  // The target (which horse / which paddock) is chosen once per section, not
  // per item, so every buy/place/remove acts on the current selection.
  const itemId = (buy ?? action).dataset.itemId;
  let ok = false;
  if (buy) {
    if (buy.dataset.cat === 'decor') ({ ok } = buyDecorIn(itemId, shopDecorPaddock(), state));
    else ({ ok } = buyWardrobe(itemId, shopWardrobeHorse(), state));
  } else {
    switch (action.dataset.action) {
      case 'place-decor': ({ ok } = placeDecor(itemId, shopDecorPaddock(), state)); break;
      case 'remove-decor': ({ ok } = removeDecor(itemId, shopDecorPaddock(), state)); break;
      case 'place-wardrobe': ({ ok } = placeWardrobe(itemId, shopWardrobeHorse(), state)); break;
      case 'remove-wardrobe': ({ ok } = removeWardrobe(itemId, shopWardrobeHorse(), state)); break;
    }
  }
  if (!ok) return;
  renderShopModal(state); // refresh owned/stored/afford states within the open modal
  renderAll(state); // wardrobe/decor changes show up on the horses/paddock immediately
  persist();
});

horsesEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.horse');
  if (card) {
    event.preventDefault();
    handleCare(card, null);
  }
});

// A returning player who's already past the 10-rescue mark (but hasn't got the
// unicorn) gets the offer on load too, after any welcome-back / postcard beats.
maybeOfferUnicorn();

// ---- simulation tick: supporter income + arrivals ----

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  // Clamp dt so a throttled background tab doesn't dump a huge jump;
  // proper offline earnings are a later feature.
  const dt = Math.min((now - lastTick) / 1000, 2);
  lastTick = now;
  state.stats.playSeconds += dt; // clamped dt keeps a backgrounded tab from inflating this
  const events = tick(dt);
  state.horses.forEach(updateHorseCard); // tick can change sponsor lines (and later, wellbeing)
  refreshUI();
  processEvents(events);
  deliverPostcards(collectDuePostcards(now)); // same-visit postcards land here
  grantStatues();                             // ...and any statue they just earned
  renderWantBubbles(state); // show/hide the little-needs bubble as wants come and go
}, 1000);

// ---- persistence ----

setInterval(persist, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
});

// The paddock cap is viewport-dependent (fewer horses per paddock on mobile),
// so crossing that breakpoint -- rotating a phone, resizing a window -- changes
// how the herd splits. Re-render from the home paddock so the newest arrivals
// stay in view rather than leaving a stale, half-off-screen layout behind.
window.matchMedia('(max-width: 560px)').addEventListener('change', () => {
  resetPaddockView();
  renderAll(state);
});
window.addEventListener('beforeunload', save); // no time for a network call here

// Handy in the console while developing.
window.HorsingAround = { get state() { return gameState; }, save, pushCloudSave };
