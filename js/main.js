// main.js — boot the game: load state, render, wire input and persistence.

import { initState, save, gameState } from './state.js';
import { careFor, tick, rescueHorse, shareUpdate } from './game.js';
import {
  renderAll, renderHUD, renderActions, updateHorseCard,
  showCareFeedback, showToast, showMoneyPop, changePaddock, resetPaddockView,
  showDonateBanner, hideDonateBanner, showNudgePopup, hideNudgePopup,
  renderShopButton, openShopModal, closeShopModal, renderShopModal, shopDecorPaddock,
} from './render.js';
import { buyDecorIn, buyWardrobe } from './shop.js';
import { syncOnLoad, pushCloudSave } from './cloud.js';
import './audio.js';

// Visit index.html?reset to discard the save during development.
const reset = new URLSearchParams(location.search).has('reset');
const state = initState({ reset });

// Captured before save() stamps a fresh time: how long ago the last session was.
const lastPlayedAt = state.savedAt;

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
// playful arrow pointing at its button. Shown one at a time in this order, and
// snoozed for the session once dismissed so they never nag -- they reappear next
// visit only while their goal is still outstanding.
const NUDGES = {
  share: {
    emoji: '💛', dir: 'down',
    text: 'You can raise money for the rescue! Tap “Share an update” below to tell your supporters how the horses are doing.',
  },
  rescue: {
    emoji: '🐴', dir: 'down',
    text: 'No horse should be alone. When you can afford it, tap “Rescue another horse” below to bring in a new friend.',
  },
  shop: {
    emoji: '🛍️', dir: 'up',
    text: 'The shop is open! Tap the Shop button up top to dress your horses and decorate the paddock.',
  },
};

let onboardingSnoozed = false; // dismissed for this session

/** The highest-priority onboarding goal still outstanding, or null. */
function pendingNudge() {
  const m = state.milestones;
  if (state.unlocks.moneyUI && !m.hasSharedUpdate) return 'share';
  if (state.unlocks.rescue && !m.hasRescuedAgain) return 'rescue';
  if (state.unlocks.moneyUI && m.hasSharedUpdate && !m.shopIntroDone) return 'shop';
  return null;
}

function updateOnboardingNudges() {
  const id = onboardingSnoozed ? null : pendingNudge();
  if (id) showNudgePopup(id, NUDGES[id]);
  else hideNudgePopup();
}

document.getElementById('nudge-dismiss').addEventListener('click', () => {
  onboardingSnoozed = true;
  hideNudgePopup();
});
document.getElementById('nudge-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'nudge-overlay') { onboardingSnoozed = true; hideNudgePopup(); }
});

// Re-assert the onboarding nudge on load: a player who unlocked money but never
// shared (or found the shop, or grew the herd) still gets the prompt on return.
updateOnboardingNudges();

function persist() {
  save();
  pushCloudSave();
}

function processEvents(events) {
  if (!events.length) return;
  events.forEach((e) => showToast(e.message));
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
    const { ok, events } = rescueHorse();
    if (ok) {
      state.milestones.hasRescuedAgain = true; // resolves the rescue nudge
      resetPaddockView(); // always show the new arrival
      renderAll(state);
      processEvents(events);
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
