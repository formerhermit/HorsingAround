// main.js — boot the game: load state, render, wire input and persistence.

import { initState, save, gameState } from './state.js';
import { careFor, tick, rescueHorse, shareUpdate } from './game.js';
import {
  renderAll, renderHUD, renderActions, updateHorseCard,
  showCareFeedback, showToast, showMoneyPop, changePaddock, resetPaddockView,
  showDonateBanner, hideDonateBanner, showStickyToast, dismissStickyToast,
  renderShopButton, openShopModal, closeShopModal, renderShopModal,
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

// Re-assert the onboarding nudges on load: a player who unlocked money but
// never shared (or found the shop) should still see the prompt on return.
updateOnboardingNudges();

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

// Two sequenced call-to-action nudges that teach the money loop. They persist
// until acted on (share / open shop), and are sequenced -- the shop prompt
// waits for the share prompt to be resolved -- so they never crowd together.
function updateOnboardingNudges() {
  const m = state.milestones;
  if (state.unlocks.moneyUI && !m.hasSharedUpdate) {
    showStickyToast('share', '💛 Did you know you can raise money for the rescue? Share an update below.', 'cta');
  } else {
    dismissStickyToast('share');
  }
  if (state.unlocks.moneyUI && m.hasSharedUpdate && !m.shopIntroDone) {
    showStickyToast('shop', '🛍️ You can now buy accessories at the shop.', 'cta');
  } else {
    dismissStickyToast('shop');
  }
}

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
  dismissStickyToast('shop');
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
  const card = btn.closest('.shop-item');
  let ok;
  if (btn.dataset.decor) {
    const paddockPicker = card.querySelector('.shop-paddock-picker');
    ({ ok } = buyDecorIn(itemId, paddockPicker ? paddockPicker.value : 0, state));
  } else {
    const horsePicker = card.querySelector('.shop-horse-picker');
    ({ ok } = buyWardrobe(itemId, horsePicker.value, state));
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
