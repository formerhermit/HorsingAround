// render.js — turns gameState into DOM. No game logic lives here.

import { horseSVG, paletteFor, wellbeingLabel, wellbeingColor } from './horse.js';
import { rescueCost, shareValue, TRAIT_REVEAL_AT } from './game.js';
import {
  SHOP_ITEMS, isUnlocked, isAffordable, hasNewAffordableItem,
  isDecorOwned, eligibleHorses,
} from './shop.js';

export function renderAll(state) {
  renderHUD(state);
  renderActions(state);
  renderPaddock(state);
  renderShopButton(state);
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

const ITEM_EMOJI = {
  scarf: '🧣', 'ear-flower': '🌸', boots: '👢', 'leg-wraps': '🩹',
  'forelock-bow': '🎀', 'saddle-blanket': '🟦',
  'flower-garland': '🌼', bunting: '🎏', trough: '💧',
  'flower-buckets': '🪣', 'hay-bales': '🌾', 'play-balls': '🎾', butterflies: '🦋',
};

/** Shop button: visible once funds exist, badged when something new is worth a look. */
export function renderShopButton(state) {
  const btn = document.getElementById('shop-btn');
  btn.hidden = !state.unlocks.moneyUI;
  document.getElementById('shop-badge').hidden = !hasNewAffordableItem(state);
}

function decorItemCard(item, state) {
  const owned = isDecorOwned(item, state);
  const afford = isAffordable(item, state);
  const card = document.createElement('div');
  card.className = `shop-item${owned ? ' owned' : ''}`;
  card.innerHTML = `
    <span class="shop-item-icon">${ITEM_EMOJI[item.id] ?? '✨'}</span>
    <span class="shop-item-name">${item.name}</span>
    ${owned
      ? '<span class="shop-item-owned">Owned</span>'
      : `<button class="shop-buy-btn" data-item-id="${item.id}" ${afford ? '' : 'disabled'}>€${item.price}</button>`}
  `;
  return card;
}

/** Wardrobe cards get a horse picker instead of a single owned/buy state,
 *  since the same item can be bought again and again for different horses. */
function wardrobeItemCard(item, state) {
  const eligible = eligibleHorses(item, state);
  const card = document.createElement('div');

  if (eligible.length === 0) {
    card.className = 'shop-item shop-item-wardrobe owned';
    card.innerHTML = `
      <div class="shop-item-top">
        <span class="shop-item-icon">${ITEM_EMOJI[item.id] ?? '✨'}</span>
        <span class="shop-item-name">${item.name}</span>
      </div>
      <span class="shop-item-owned">Every horse has this</span>
    `;
    return card;
  }

  const afford = isAffordable(item, state);
  const options = eligible.map((h) => `<option value="${h.id}">${h.name}</option>`).join('');
  card.className = 'shop-item shop-item-wardrobe';
  card.innerHTML = `
    <div class="shop-item-top">
      <span class="shop-item-icon">${ITEM_EMOJI[item.id] ?? '✨'}</span>
      <span class="shop-item-name">${item.name}</span>
    </div>
    <div class="shop-item-buy-row">
      <select class="shop-horse-picker" data-item-id="${item.id}" aria-label="Horse to dress in ${item.name}">${options}</select>
      <button class="shop-buy-btn" data-item-id="${item.id}" ${afford ? '' : 'disabled'}>€${item.price}</button>
    </div>
  `;
  return card;
}

/** Populate the shop grids. Locked items (not enough horses rescued yet) are absent entirely. */
export function renderShopModal(state) {
  const wardrobeGrid = document.getElementById('shop-grid-wardrobe');
  const decorGrid = document.getElementById('shop-grid-decor');
  wardrobeGrid.replaceChildren();
  decorGrid.replaceChildren();
  for (const item of SHOP_ITEMS) {
    if (!isUnlocked(item, state)) continue;
    if (item.category === 'wardrobe') {
      wardrobeGrid.append(wardrobeItemCard(item, state));
    } else {
      decorGrid.append(decorItemCard(item, state));
    }
  }
}

export function openShopModal(state) {
  renderShopModal(state);
  document.getElementById('shop-overlay').hidden = false;
}

export function closeShopModal() {
  document.getElementById('shop-overlay').hidden = true;
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
  back.forEach((h) => backRow.append(horseCard(h, BACK_SCALE, true, h.wardrobe)));

  const frontRow = document.createElement('div');
  frontRow.className = 'horses-front';
  front.forEach((h, i) => {
    const rank = front.length - 1 - i; // 0 = newest
    frontRow.append(horseCard(h, FRONT_SCALES[rank] ?? BACK_SCALE, false, h.wardrobe));
  });

  const ground = groundDecorRow(state);
  document.getElementById('horses').replaceChildren(...[backRow, ground, frontRow].filter(Boolean));
  renderPaddockDecor(state);

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

// Fence-line decor: stays on the fixed overlay near the actual fence rails.
// Positioned in a 900x130 space so items never collide even all owned at once.
const FENCE_DECOR_MARKUP = {
  'flower-garland': `
    <circle cx="40" cy="24" r="4" fill="#F2A6C6"/><circle cx="52" cy="23" r="4" fill="#F5D949"/><circle cx="64" cy="24" r="4" fill="#8FC0E8"/>
    <circle cx="220" cy="24" r="4" fill="#F2A6C6"/><circle cx="232" cy="23" r="4" fill="#F5D949"/><circle cx="244" cy="24" r="4" fill="#8FC0E8"/>
    <circle cx="400" cy="24" r="4" fill="#F2A6C6"/><circle cx="412" cy="23" r="4" fill="#F5D949"/><circle cx="424" cy="24" r="4" fill="#8FC0E8"/>
    <circle cx="580" cy="24" r="4" fill="#F2A6C6"/><circle cx="592" cy="23" r="4" fill="#F5D949"/><circle cx="604" cy="24" r="4" fill="#8FC0E8"/>
    <circle cx="760" cy="24" r="4" fill="#F2A6C6"/><circle cx="772" cy="23" r="4" fill="#F5D949"/><circle cx="784" cy="24" r="4" fill="#8FC0E8"/>`,
  bunting: `
    <path d="M30,27 Q95,50 160,27" fill="none" stroke="#a3763a" stroke-width="1.5"/>
    <path d="M55,35 L65,35 L60,48 Z" fill="#E8917A"/><path d="M78,40 L88,40 L83,53 Z" fill="#8FC0E8"/><path d="M101,42 L111,42 L106,55 Z" fill="#F5D949"/><path d="M124,38 L134,38 L129,51 Z" fill="#A6D8A0"/>
    <path d="M390,27 Q455,50 520,27" fill="none" stroke="#a3763a" stroke-width="1.5"/>
    <path d="M415,35 L425,35 L420,48 Z" fill="#E8917A"/><path d="M438,40 L448,40 L443,53 Z" fill="#8FC0E8"/><path d="M461,42 L471,42 L466,55 Z" fill="#F5D949"/><path d="M484,38 L494,38 L489,51 Z" fill="#A6D8A0"/>
    <path d="M660,27 Q725,50 790,27" fill="none" stroke="#a3763a" stroke-width="1.5"/>
    <path d="M685,35 L695,35 L690,48 Z" fill="#E8917A"/><path d="M708,40 L718,40 L713,53 Z" fill="#8FC0E8"/><path d="M731,42 L741,42 L736,55 Z" fill="#F5D949"/><path d="M754,38 L764,38 L759,51 Z" fill="#A6D8A0"/>`,
};

/** Draw whatever fence-line decor the player has bought. */
function renderPaddockDecor(state) {
  const layer = document.getElementById('paddock-decor');
  const markup = state.shop.owned.map((id) => FENCE_DECOR_MARKUP[id] ?? '').join('');
  layer.innerHTML = markup;
}

// Ground props: rendered as a real flex row between the back and front horse
// rows, not an absolute overlay -- so they always land in the visible gap
// between the two rows regardless of herd size or viewport width.
const GROUND_DECOR_MARKUP = {
  trough: `
    <path d="M140,25 L200,25 L192,50 L148,50 Z" fill="#8A97A0"/>
    <path d="M144,25 L196,25 L196,30 L144,30 Z" fill="#B9D4E8"/>
    <path d="M140,25 L148,50" stroke="#6B7680" stroke-width="1.5"/><path d="M200,25 L192,50" stroke="#6B7680" stroke-width="1.5"/>`,
  'flower-buckets': `
    <path d="M45,30 L67,30 L63,55 L49,55 Z" fill="#B0823F"/>
    <circle cx="47" cy="27" r="3.5" fill="#F2A6C6"/><circle cx="52" cy="25" r="3.5" fill="#F5D949"/><circle cx="57" cy="26" r="3.5" fill="#8FC0E8"/><circle cx="62" cy="27" r="3.5" fill="#F2A6C6"/><circle cx="50" cy="29.5" r="3.5" fill="#A6D8A0"/><circle cx="59" cy="29.5" r="3.5" fill="#F5D949"/><circle cx="54.5" cy="22.5" r="3.5" fill="#8FC0E8"/>
    <path d="M735,32 L757,32 L753,57 L739,57 Z" fill="#B0823F"/>
    <circle cx="737" cy="29" r="3.5" fill="#8FC0E8"/><circle cx="742" cy="27" r="3.5" fill="#F2A6C6"/><circle cx="747" cy="28" r="3.5" fill="#F5D949"/><circle cx="752" cy="29" r="3.5" fill="#8FC0E8"/><circle cx="740" cy="31.5" r="3.5" fill="#F5D949"/><circle cx="749" cy="31.5" r="3.5" fill="#A6D8A0"/><circle cx="744.5" cy="24.5" r="3.5" fill="#F2A6C6"/>`,
  'hay-bales': `
    <rect x="390" y="18" width="34" height="24" rx="2" fill="#D9B25C"/><rect x="390" y="18" width="34" height="24" rx="2" fill="none" stroke="#B4903E" stroke-width="2"/><line x1="390" y1="26" x2="424" y2="26" stroke="#B4903E" stroke-width="1.5"/><line x1="390" y1="34" x2="424" y2="34" stroke="#B4903E" stroke-width="1.5"/>
    <rect x="414" y="30" width="30" height="18" rx="2" fill="#D9B25C"/><rect x="414" y="30" width="30" height="18" rx="2" fill="none" stroke="#B4903E" stroke-width="2"/><line x1="414" y1="36" x2="444" y2="36" stroke="#B4903E" stroke-width="1.5"/><line x1="414" y1="42" x2="444" y2="42" stroke="#B4903E" stroke-width="1.5"/>`,
  'play-balls': `
    <circle cx="570" cy="35" r="13" fill="#E85D75"/><circle cx="566" cy="30" r="3.5" fill="#F5A8B8"/>
    <circle cx="610" cy="40" r="11" fill="#4FA8D8"/><circle cx="606" cy="36" r="3" fill="#A8D8ED"/>
    <circle cx="640" cy="34" r="12" fill="#F5C242"/><circle cx="636" cy="29" r="3.2" fill="#FADD8C"/>`,
  butterflies: `
    <g transform="translate(260,15)"><path d="M0,0 Q-7,-7 -7,0 Q-7,7 0,0" fill="#F2A6C6"/><path d="M0,0 Q7,-7 7,0 Q7,7 0,0" fill="#F5D949"/></g>
    <g transform="translate(490,20) scale(0.85)"><path d="M0,0 Q-7,-7 -7,0 Q-7,7 0,0" fill="#8FC0E8"/><path d="M0,0 Q7,-7 7,0 Q7,7 0,0" fill="#A6D8A0"/></g>
    <g transform="translate(680,12) scale(0.75)"><path d="M0,0 Q-7,-7 -7,0 Q-7,7 0,0" fill="#F2A6C6"/><path d="M0,0 Q7,-7 7,0 Q7,7 0,0" fill="#F5D949"/></g>`,
};

/** Build the ground-props row, or null if nothing ground-level is owned. */
function groundDecorRow(state) {
  const markup = state.shop.owned.map((id) => GROUND_DECOR_MARKUP[id] ?? '').join('');
  if (!markup) return null;
  const row = document.createElement('div');
  row.className = 'ground-decor';
  row.innerHTML = `<svg viewBox="0 0 900 62" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${markup}</svg>`;
  return row;
}

function horseCard(horse, scale = 1, isBack = false, wardrobe = []) {
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
    ${horseSVG(horse, wardrobe)}
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
