// main.js — boot the game: load state, render, wire input and persistence.

import { initState, save, gameState } from './state.js';
import { careFor, tick, rescueHorse, shareUpdate, rescueCost, acceptRehome, declineRehome, collectOfflineEarnings } from './game.js';
import {
  renderAll, renderHUD, renderActions, updateHorseCard,
  showCareFeedback, showToast, showMoneyPop, changePaddock, resetPaddockView,
  showDonateBanner, hideDonateBanner, showNudgePopup, hideNudgePopup, showDialog,
  renderShopButton, openShopModal, closeShopModal, renderShopModal, shopDecorPaddock,
} from './render.js';
import { buyDecorIn, buyWardrobe, hasNewAffordableItem } from './shop.js';
import { syncOnLoad, pushCloudSave } from './cloud.js';
import './audio.js';

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
// One quiet story moment (after the first sponsorship, when the game has
// just taught what steady support means), plus a reprise whenever a player
// comes back after a proper break. Never more than that.

const RETURN_BREAK_MS = 12 * 60 * 60 * 1000;

function maybeOfferDonation() {
  if (!state.milestones.firstSponsorship || state.milestones.donateBannerShown) return;
  state.milestones.donateBannerShown = true;
  // let the sponsorship toast land first
  setTimeout(showDonateBanner, 4000);
}

if (state.unlocks.moneyUI && Date.now() - lastPlayedAt > RETURN_BREAK_MS) {
  state.milestones.donateBannerShown = true; // counts as the one story moment too
  showDonateBanner();
}

document.getElementById('donate-dismiss').addEventListener('click', hideDonateBanner);

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
  const parts = [`your supporters donated €${money}`];
  if (summary.newSupporters > 0) {
    parts.push(summary.newSupporters === 1
      ? '1 new supporter found the rescue'
      : `${summary.newSupporters} new supporters found the rescue`);
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

const DONATE_URL = 'https://donorbox.org/donate-to-arch?amount=10';

/** Turn one event into either a toast or a queued modal dialog. */
function handleEvent(e) {
  if (e.type === 'rehome-offer') {
    enqueueDialog({
      emoji: '🏡',
      text: `${e.horseName} is ready for rehoming. Agree to adoption for €${e.income}?`,
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
      text: `You have rescued ${e.count} horses. What an amazing job you're doing! Have a little extra cash to keep up the good work.`,
      buttons: [{ label: 'Collect', variant: 'primary' }],
    });
  } else if (e.type === 'rehome-milestone') {
    enqueueDialog({
      emoji: '🎉',
      text: `You have re-homed ${e.count} horses. What an amazing job you're doing! Have a little extra cash to keep up the good work.`,
      buttons: [{ label: 'Collect', variant: 'primary' }],
    });
  } else if (e.type === 'donate-milestone') {
    enqueueDialog({
      emoji: '💛', confetti: true,
      text: `You have rescued ${e.count} horses. If you're enjoying this game, why not donate to ARCH to help our real horses too?`,
      buttons: [
        { label: 'Donate', variant: 'primary', onClick: () => window.open(DONATE_URL, '_blank', 'noopener') },
        { label: "Don't ask again", variant: 'ghost', onClick: () => { state.milestones.donateOptOut = true; save(); } },
      ],
    });
  } else {
    showToast(e.message);
  }
}

function processEvents(events) {
  if (!events.length) return;
  events.forEach(handleEvent);
  maybeOfferDonation(); // fires once, on the first sponsorship beat
  refreshUI();
  persist(); // story beats are worth persisting immediately
}

function handleCare(card, event) {
  const horse = state.horses.find((h) => h.id === card.dataset.horseId);
  if (!horse) return;
  const { message, events } = careFor(horse);
  updateHorseCard(horse);
  showCareFeedback(card, message, event);
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
      showToast('You still have horses which need help');
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
  if (event.key === 'Escape' && !document.getElementById('shop-overlay').hidden) closeShopModal();
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
}, 1000);

// ---- persistence ----

setInterval(persist, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
});
window.addEventListener('beforeunload', save); // no time for a network call here

// Handy in the console while developing.
window.HorsingAround = { get state() { return gameState; }, save, pushCloudSave };
