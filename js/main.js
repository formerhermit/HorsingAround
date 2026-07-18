// main.js — boot the game: load state, render, wire input and persistence.

import { initState, save, gameState } from './state.js';
import { careFor, tick, rescueHorse, shareUpdate } from './game.js';
import {
  renderAll, renderHUD, renderActions, updateHorseCard,
  showCareFeedback, showToast, showMoneyPop, changePaddock, resetPaddockView,
  showDonateBanner, hideDonateBanner,
  renderShopButton, openShopModal, closeShopModal, renderShopModal,
} from './render.js';
import { buyDecor, buyWardrobe } from './shop.js';
import { syncOnLoad, pushCloudSave } from './cloud.js';
import './audio.js';

// Visit index.html?reset to discard the save during development.
const reset = new URLSearchParams(location.search).has('reset');
const state = initState({ reset });

// Captured before save() stamps a fresh time: how long ago the last session was.
const lastPlayedAt = state.savedAt;

renderAll(state);
save(); // persist immediately so the save shape exists from first load

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
    refreshUI();
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

document.getElementById('shop-btn').addEventListener('click', () => openShopModal(state));
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
  const picker = btn.closest('.shop-item').querySelector('.shop-horse-picker');
  const { ok } = picker
    ? buyWardrobe(itemId, picker.value, state)
    : buyDecor(itemId, state);
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
