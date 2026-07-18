// render.js — turns gameState into DOM. No game logic lives here.

import { horseSVG, paletteFor, wellbeingLabel, wellbeingColor } from './horse.js';
import { rescueCost, shareValue, TRAIT_REVEAL_AT } from './game.js';

export function renderAll(state) {
  renderHUD(state);
  renderActions(state);
  renderPaddock(state);
}

export function renderHUD(state) {
  document.getElementById('hud-coins').textContent = Math.floor(state.coins);
  document.getElementById('hud-supporters').textContent = state.supporters;
  // Phase 1: no money UI until the first supporter donation unlocks it.
  for (const id of ['chip-funds', 'chip-supporters']) {
    const chip = document.getElementById(id);
    if (chip.hidden && state.unlocks.moneyUI) chip.classList.add('chip-reveal');
    chip.hidden = !state.unlocks.moneyUI;
  }
}

/**
 * Action bar under the paddock. The button element is created once and
 * patched (label, affordability) so a click never lands on a rebuilt node.
 */
export function renderActions(state) {
  const bar = document.getElementById('actions');
  bar.hidden = !state.unlocks.moneyUI;
  if (bar.hidden) return;

  // Share an update: the active fundraising click.
  let share = bar.querySelector('#share-btn');
  if (!share) {
    share = document.createElement('button');
    share.id = 'share-btn';
    share.className = 'action-btn share';
    share.innerHTML = `
      <span class="action-title">📣 Share an update</span>
      <span class="action-cost"></span>`;
    bar.appendChild(share);
  }
  share.querySelector('.action-cost').textContent =
    `+€${shareValue(state).toFixed(2)} from supporters`;

  // Rescue: appears with the loneliness beat.
  let rescue = bar.querySelector('#rescue-btn');
  if (!rescue && state.unlocks.rescue) {
    rescue = document.createElement('button');
    rescue.id = 'rescue-btn';
    rescue.className = 'action-btn';
    rescue.innerHTML = `
      <span class="action-title">🐴 Rescue another horse</span>
      <span class="action-cost"></span>`;
    bar.appendChild(rescue);
  }
  if (rescue) {
    const cost = rescueCost(state);
    rescue.querySelector('.action-cost').textContent = `€${cost}`;
    rescue.disabled = state.coins < cost;
  }
}

/** Floating "+€x" over the share button. */
export function showMoneyPop(amount) {
  const btn = document.getElementById('share-btn');
  if (!btn) return;
  const pop = document.createElement('span');
  pop.className = 'money-pop';
  pop.style.setProperty('--tilt', `${(Math.random() * 10 - 5).toFixed(1)}deg`);
  pop.style.left = `${35 + Math.random() * 30}%`;
  pop.textContent = `+€${amount.toFixed(2)} 💛`;
  btn.appendChild(pop);
  pop.addEventListener('animationend', () => pop.remove());
}

// How many horses stand in the foreground row; older horses move to a
// smaller background line along the fence, as if further away.
const FRONT_COUNT = 3;
const FRONT_SCALES = [1, 0.82, 0.68]; // newest first
const BACK_SCALE = 0.48;
const BASE_WIDTH = 220; // px card width at scale 1

// A paddock holds at most front row + one fence line; beyond that, older
// horses move to the next paddock over (navigated with the edge arrows) so
// the game never scrolls.
const PADDOCK_CAP = 8;

// Which paddock is on screen. 0 = home paddock (newest arrivals). Not
// persisted: every session starts at home.
let currentPaddock = 0;

/** Jump back to the home paddock (e.g. when a new horse arrives). */
export function resetPaddockView() {
  currentPaddock = 0;
}

export function changePaddock(delta, state) {
  currentPaddock += delta;
  renderPaddock(state);
}

/** Split the herd, newest first, into paddocks of up to PADDOCK_CAP.
 *  Never leaves a single horse alone — herd animals, even in the UI. */
function paddockChunks(state) {
  const newestFirst = [...state.horses].reverse();
  const chunks = [];
  for (let i = 0; i < newestFirst.length; i += PADDOCK_CAP) {
    chunks.push(newestFirst.slice(i, i + PADDOCK_CAP));
  }
  const last = chunks[chunks.length - 1];
  if (chunks.length > 1 && last.length === 1) {
    last.unshift(chunks[chunks.length - 2].pop());
  }
  return chunks;
}

function renderPaddock(state) {
  const chunks = paddockChunks(state);
  currentPaddock = Math.max(0, Math.min(currentPaddock, chunks.length - 1));
  const chunk = chunks[currentPaddock]; // newest-first within the paddock

  // oldest→newest left to right, newest (largest) rightmost
  const front = chunk.slice(0, FRONT_COUNT).reverse();
  const back = chunk.slice(FRONT_COUNT).reverse();

  const backRow = document.createElement('div');
  backRow.className = 'horses-back';
  back.forEach((h) => backRow.append(horseCard(h, BACK_SCALE, true)));

  const frontRow = document.createElement('div');
  frontRow.className = 'horses-front';
  front.forEach((h, i) => {
    const rank = front.length - 1 - i; // 0 = newest
    frontRow.append(horseCard(h, FRONT_SCALES[rank] ?? BACK_SCALE, false));
  });

  document.getElementById('horses').replaceChildren(backRow, frontRow);

  // edge arrows + label, only when there is more than one paddock
  const older = document.getElementById('nav-older');
  const newer = document.getElementById('nav-newer');
  const label = document.getElementById('paddock-label');
  older.hidden = currentPaddock >= chunks.length - 1;
  newer.hidden = currentPaddock === 0;
  label.hidden = chunks.length < 2;
  label.textContent = currentPaddock === 0
    ? `Home paddock · 1 of ${chunks.length}`
    : `Paddock ${currentPaddock + 1} of ${chunks.length} · old friends`;
}

function horseCard(horse, scale = 1, isBack = false) {
  const card = document.createElement('div');
  card.className = isBack ? 'horse is-back' : 'horse';
  card.style.width = `min(${Math.round(BASE_WIDTH * scale)}px, 70vw)`;
  card.style.fontSize = `${scale.toFixed(2)}em`; // card text/bar scale with the horse
  card.dataset.horseId = horse.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Care for ${horse.name}`);
  const showTrait = horse.trait && horse.wellbeing >= TRAIT_REVEAL_AT;
  // trait/sponsor lines are always in the layout (visibility-toggled by the
  // "shown" class) so revealing them never changes card height mid-game
  card.innerHTML = `
    ${horseSVG(horse)}
    <p class="horse-name">${horse.name}</p>
    <p class="horse-condition">${wellbeingLabel(horse.wellbeing)}</p>
    <p class="horse-trait${showTrait ? ' shown' : ''}">${showTrait ? horse.trait : ''}</p>
    <p class="horse-sponsor${horse.sponsor ? ' shown' : ''}">${horse.sponsor ? `sponsored by ${horse.sponsor} 💛` : ''}</p>
    <div class="wellbeing" role="meter" aria-label="${horse.name}'s wellbeing"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(horse.wellbeing)}">
      <div class="wellbeing-fill" style="width:${horse.wellbeing}%; background:${wellbeingColor(horse.wellbeing)}"></div>
    </div>`;
  return card;
}

/**
 * Patch an existing horse card in place (colours, bar, label) rather than
 * rebuilding it, so CSS transitions run and clicks aren't interrupted.
 */
export function updateHorseCard(horse) {
  const card = document.querySelector(`.horse[data-horse-id="${horse.id}"]`);
  if (!card) return;
  const c = paletteFor(horse);
  card.querySelectorAll('[data-part="coat"]').forEach((el) => el.setAttribute('fill', c.coat));
  card.querySelectorAll('[data-part="legs"]').forEach((el) => el.setAttribute('fill', c.legs));
  card.querySelectorAll('[data-part="mane"]').forEach((el) => el.setAttribute('stroke', c.mane));
  card.querySelector('[data-part="muzzle"]').setAttribute('fill', c.muzzle);
  card.querySelector('[data-part="shine"]').setAttribute('opacity',
    Math.min(Math.max(horse.wellbeing / 100, 0), 1).toFixed(2));

  card.querySelector('.horse-condition').textContent = wellbeingLabel(horse.wellbeing);
  const traitEl = card.querySelector('.horse-trait');
  const showTrait = horse.trait && horse.wellbeing >= TRAIT_REVEAL_AT;
  traitEl.classList.toggle('shown', !!showTrait);
  traitEl.textContent = showTrait ? horse.trait : '';
  const sponsorEl = card.querySelector('.horse-sponsor');
  sponsorEl.classList.toggle('shown', !!horse.sponsor);
  sponsorEl.textContent = horse.sponsor ? `sponsored by ${horse.sponsor} 💛` : '';
  const meter = card.querySelector('.wellbeing');
  meter.setAttribute('aria-valuenow', Math.round(horse.wellbeing));
  const fill = card.querySelector('.wellbeing-fill');
  fill.style.width = `${horse.wellbeing}%`;
  fill.style.background = wellbeingColor(horse.wellbeing);
}

/**
 * Click feedback: bounce the horse and float a little care message up
 * from where the click landed.
 */
export function showCareFeedback(card, message, clickEvent) {
  card.classList.remove('just-cared');
  void card.offsetWidth; // restart the bounce animation
  card.classList.add('just-cared');

  const pop = document.createElement('span');
  // random pastel variant + slight tilt keeps repeated clicks lively
  pop.className = `care-pop c${Math.floor(Math.random() * 5)}`;
  pop.style.setProperty('--tilt', `${(Math.random() * 12 - 6).toFixed(1)}deg`);
  pop.textContent = message;
  const rect = card.getBoundingClientRect();
  // Position near the pointer if we have one, else above the horse's back.
  const x = clickEvent?.clientX ? clickEvent.clientX - rect.left : rect.width * 0.45;
  const y = clickEvent?.clientY ? clickEvent.clientY - rect.top : rect.height * 0.3;
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
  card.appendChild(pop);
  pop.addEventListener('animationend', () => pop.remove());
}

/** The real-donation banner under the action bar. */
export function showDonateBanner() {
  document.getElementById('donate-banner').hidden = false;
}

export function hideDonateBanner() {
  document.getElementById('donate-banner').hidden = true;
}

/**
 * Narrative toast at the top of the paddock (first donation, new
 * supporters, arrivals). Auto-dismisses via its CSS animation.
 */
export function showToast(message) {
  const container = document.getElementById('toasts');
  // never stack more than 3 — the horses are the point, not the messages
  while (container.children.length >= 3) container.firstChild.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  toast.addEventListener('animationend', () => toast.remove());
}
