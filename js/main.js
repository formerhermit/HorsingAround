// main.js — boot the game: load state, render, wire input and persistence.

import { initState, save, gameState, DONATE_MILESTONE } from './state.js';
import { careFor, tick, rescueHorse, shareUpdate, rescueCost, acceptRehome, declineRehome, collectOfflineEarnings, collectDuePostcards, markPostcardsRead, fulfilWant, grantUnicorn, hasUnicorn } from './game.js';
import {
  renderAll, renderHUD, renderActions, updateHorseCard,
  showCareFeedback, showTipPop, showToast, showMoneyPop, showSupporterPop, changePaddock, resetPaddockView,
  showNudgePopup, hideNudgePopup, showDialog,
  renderShopButton, openShopModal, closeShopModal, renderShopModal, shopDecorPaddock,
  renderPostcardButton, openPostcardAlbum, closePostcardAlbum,
  renderWantBubbles, showWantFulfilled,
  renderCollectionButton, openCollection, closeCollection,
} from './render.js';
import { buyDecorIn, buyWardrobe, hasNewAffordableItem } from './shop.js';
import { syncOnLoad, pushCloudSave } from './cloud.js';
import './audio.js';

// Wrap a key figure (a count, a € amount, a supporter tally) so it renders bold
// and green in a popup -- see the .fig rule and showDialog's innerHTML. Values
// are always numbers/short strings authored in-code, so plain interpolation is safe.
const fig = (v) => `<span class="fig">${v}</span>`;

// Visit index.html?reset to discard the save during development.
const reset = new URLSearchParams(location.search).has('reset');
const state = initState({ reset });

// Captured before save() stamps a fresh time: how long ago the last session was.
const lastPlayedAt = state.savedAt;

// Credit anything the rescue earned while the game was closed, before the first
// paint, so the HUD already shows the boosted totals. The summary (or null) is
// held for the welcome-back popup, shown once the dialog plumbing is set up.
const offlineSummary = collectOfflineEarnings(lastPlayedAt);

renderAll(state);
save(); // persist immediately so the save shape exists from first load

// ---- intro nudge ----
// Brand-new players don't know clicking a horse does anything. One cute,
// colourful, one-time toast fixes that -- never shown again after.

if (!state.milestones.introToastShown) {
  state.milestones.introToastShown = true;
  setTimeout(() => showToast('👋 Tap Biscuit to give him some care!', 'intro'), 1200);
  save();
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
  if (!adopted) return;
  resetPaddockView();
  renderAll(state);
  save();
});

// ---- input: click (or Enter/Space) on a horse = one care action ----

function refreshUI() {
  renderHUD(state);
  renderActions(state);
  renderShopButton(state);
  updateOnboardingNudges();
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
  return {
    emoji: '🛍️', dir: 'up-right',
    text: 'The shop is open! Tap the Shop button up top to dress your horses and decorate the paddock.',
  };
}

const snoozedNudges = new Set(); // nudge ids dismissed this session

/** The highest-priority onboarding goal that's outstanding and not snoozed, or
 *  null. Rescue and shop only surface once they're actually actionable -- enough
 *  money for the first rescue, or an affordable item in the shop -- so their
 *  arrow always points at a button the player can use right now. */
function pendingNudge() {
  const m = state.milestones;
  const candidates = [];
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

deliverPostcards(collectDuePostcards());

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
          if (res) { resetPaddockView(); renderAll(state); refreshUI(); persist(); }
        } },
        { label: 'Not now', variant: 'ghost', onClick: () => declineRehome() },
      ],
    });
  } else if (e.type === 'rescue-milestone') {
    enqueueDialog({
      emoji: '🎉',
      text: `You have rescued ${fig(e.count)} horses. What an amazing job you're doing! Here's ${fig(`€${e.bonus}`)} extra to keep up the good work.`,
      buttons: [{ label: 'Collect', variant: 'primary' }],
    });
  } else if (e.type === 'rehome-milestone') {
    enqueueDialog({
      emoji: '🎉',
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
      emoji: e.coat === 'golden' ? '🌟' : '🌈', confetti: true,
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
document.getElementById('shop-close').addEventListener('click', closeShopModal);
document.getElementById('shop-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'shop-overlay') closeShopModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!document.getElementById('shop-overlay').hidden) closeShopModal();
  if (!document.getElementById('album-overlay').hidden) closePostcardAlbum();
  if (!document.getElementById('collection-overlay').hidden) closeCollection();
});

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

document.getElementById('collection-btn').addEventListener('click', () => {
  state.collectionSeen = state.collectedCoats.length; // clear the "new" dot
  state.milestones.collectionIntroDone = true;        // they've found it; no nudge needed
  openCollection(state);
  renderCollectionButton(state);
  updateOnboardingNudges(); // clears the collection nudge if it's up
  persist();
});
document.getElementById('collection-close').addEventListener('click', closeCollection);
document.getElementById('collection-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'collection-overlay') closeCollection();
});

document.getElementById('shop-modal').addEventListener('click', (event) => {
  const btn = event.target.closest('.shop-buy-btn');
  if (!btn) return;
  const itemId = btn.dataset.itemId;
  // The buy target is chosen once per section, not per item.
  let ok;
  if (btn.dataset.cat === 'decor') {
    ({ ok } = buyDecorIn(itemId, shopDecorPaddock(), state));
  } else {
    const horseSelect = document.getElementById('shop-horse-select');
    const horseId = horseSelect ? horseSelect.value : state.horses[state.horses.length - 1]?.id;
    ({ ok } = buyWardrobe(itemId, horseId, state));
  }
  if (!ok) return;
  renderShopModal(state); // refresh owned/afford states within the open modal
  renderAll(state); // new wardrobe/decor shows up on the horses/paddock immediately
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
  const events = tick(dt);
  state.horses.forEach(updateHorseCard); // tick can change sponsor lines (and later, wellbeing)
  refreshUI();
  processEvents(events);
  deliverPostcards(collectDuePostcards(now)); // same-visit postcards land here
  renderWantBubbles(state); // show/hide the little-needs bubble as wants come and go
}, 1000);

// ---- persistence ----

setInterval(persist, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
});
window.addEventListener('beforeunload', save); // no time for a network call here

// Handy in the console while developing.
window.HorsingAround = { get state() { return gameState; }, save, pushCloudSave };
