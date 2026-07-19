// render.js — turns gameState into DOM. No game logic lives here.

import { horseFigureHTML, horseImageSrc, wellbeingLabel, wellbeingColor } from './horse.js';
import { rescueCost, shareValue, TRAIT_REVEAL_AT } from './game.js';
import {
  SHOP_ITEMS, isUnlocked, isAffordable, hasNewAffordableItem, eligibleHorses,
  PADDOCK_CAP, paddockCount, paddockDecor, paddocksOpenFor,
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
  'flower-buckets': '🪣', 'apple-barrel': '🍎', 'hay-bales': '🌾',
  'play-balls': '🎾', butterflies: '🦋', muffin: '🐶', marmalade: '🐱', joya: '🐕',
};

/** Shop button: visible once funds exist, badged when something new is worth a look. */
export function renderShopButton(state) {
  const btn = document.getElementById('shop-btn');
  btn.hidden = !state.unlocks.moneyUI;
  document.getElementById('shop-badge').hidden = !hasNewAffordableItem(state);
}

/** Decor cards place one item in a chosen paddock. With a single paddock it's a
 *  plain buy button; with several, a paddock picker (like the wardrobe horse
 *  picker). Paddocks that already have the item — or are at their decoration
 *  limit — drop out of the options. */
function decorItemCard(item, state) {
  const open = paddocksOpenFor(item, state); // paddock indices with room
  const total = paddockCount(state);
  const card = document.createElement('div');

  if (open.length === 0) {
    // Nowhere left to put it: every paddock either has it or is full.
    const full = state.horses.length > 0
      && Array.from({ length: total }, (_, p) => p).some((p) => paddockDecor(state, p).includes(item.id));
    card.className = 'shop-item shop-item-decor owned';
    card.innerHTML = `
      <div class="shop-item-top">
        <span class="shop-item-icon">${ITEM_EMOJI[item.id] ?? '✨'}</span>
        <span class="shop-item-name">${item.name}</span>
      </div>
      <span class="shop-item-owned">${full && total === 1 ? 'In your paddock' : 'Every paddock is set'}</span>
    `;
    return card;
  }

  const afford = isAffordable(item, state);
  card.className = 'shop-item shop-item-decor';
  const picker = total > 1
    ? `<select class="shop-paddock-picker" data-item-id="${item.id}" aria-label="Paddock to decorate with ${item.name}">${
        open.map((p) => `<option value="${p}">${paddockLabel(p)}</option>`).join('')
      }</select>`
    : '';
  card.innerHTML = `
    <div class="shop-item-top">
      <span class="shop-item-icon">${ITEM_EMOJI[item.id] ?? '✨'}</span>
      <span class="shop-item-name">${item.name}</span>
    </div>
    <div class="shop-item-buy-row">
      ${picker}
      <button class="shop-buy-btn" data-item-id="${item.id}" data-decor="1" ${afford ? '' : 'disabled'}>€${item.price}</button>
    </div>
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

// PADDOCK_CAP (how many horses fill a paddock before older ones roll over)
// lives in shop.js so decor rules can count paddocks; imported above.

/** Human label for a paddock slot, matching the on-scene label wording. */
function paddockLabel(index) {
  return index === 0 ? 'Home paddock' : `Paddock ${index + 1}`;
}

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

  document.getElementById('horses').replaceChildren(backRow, groundDecorRow(state, currentPaddock), frontRow);
  renderPaddockDecor(state, currentPaddock);

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
// Flower garland repeats along the fence line (top, not in grass).
function fenceGarlandImages() {
  const garland = { aspect: 1.500, fw: 0.635, fh: 0.287, subjH: 16 }; // half size
  const hImg = garland.subjH / garland.fh;
  const wImg = hImg * garland.aspect;
  const y = 8 - hImg / 2; // top of fence, centered vertically
  const images = [];
  const spacing = wImg + 20; // repeat with small gap
  // Repeat along entire fence width starting from left
  for (let cx = wImg / 2 + 10; cx < 900; cx += spacing) {
    const x = cx - wImg / 2;
    images.push(`<image href="assets/decor/flower-garland.png" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${wImg.toFixed(1)}" height="${hImg.toFixed(1)}"/>`);
  }
  return images.join('');
}

const FENCE_DECOR_MARKUP = {
  'flower-garland': fenceGarlandImages(),
  bunting: `
    <path d="M30,27 Q95,50 160,27" fill="none" stroke="#a3763a" stroke-width="1.5"/>
    <path d="M51,34.4 L61,34.4 L56,47.4 Z" fill="#E8917A"/><path d="M77,38 L87,38 L82,51 Z" fill="#8FC0E8"/><path d="M103,38 L113,38 L108,51 Z" fill="#F5D949"/><path d="M129,34.4 L139,34.4 L134,47.4 Z" fill="#A6D8A0"/>
    <path d="M390,27 Q455,50 520,27" fill="none" stroke="#a3763a" stroke-width="1.5"/>
    <path d="M411,34.4 L421,34.4 L416,47.4 Z" fill="#E8917A"/><path d="M437,38 L447,38 L442,51 Z" fill="#8FC0E8"/><path d="M463,38 L473,38 L468,51 Z" fill="#F5D949"/><path d="M489,34.4 L499,34.4 L494,47.4 Z" fill="#A6D8A0"/>
    <path d="M660,27 Q725,50 790,27" fill="none" stroke="#a3763a" stroke-width="1.5"/>
    <path d="M681,34.4 L691,34.4 L686,47.4 Z" fill="#E8917A"/><path d="M707,38 L717,38 L712,51 Z" fill="#8FC0E8"/><path d="M733,38 L743,38 L738,51 Z" fill="#F5D949"/><path d="M759,34.4 L769,34.4 L764,47.4 Z" fill="#A6D8A0"/>`,
};

/** Draw the fence-line decor placed in the on-screen paddock. */
function renderPaddockDecor(state, paddock) {
  const layer = document.getElementById('paddock-decor');
  const markup = paddockDecor(state, paddock).map((id) => FENCE_DECOR_MARKUP[id] ?? '').join('');
  layer.innerHTML = markup;
}

// Ground props: rendered as a real flex row between the back and front horse
// rows, not an absolute overlay -- so they always land in the visible gap
// between the two rows regardless of herd size or viewport width. Each prop is
// a transparent PNG; the numbers below place its *solid subject* (glow ignored)
// at a footprint in the 900x140 row. fw/fh are the fraction of the trimmed
// frame the subject fills; the subject is centred in the frame, so we size the
// image from the wanted subject height and centre it on (cx, baseline).
const GROUND_BASELINE = 128; // subject bottoms rest near here
// Each prop is a transparent PNG; aspect + fw/fh (fraction of the trimmed frame
// its solid subject fills, glow ignored) let us size from a target subject
// height. The horizontal slot is assigned dynamically so any mix of props
// spreads evenly across the row. Butterflies are overlay-only (no ground slot).
const GROUND_IMAGES = {
  'flower-garland': { aspect: 1.500, fw: 0.635, fh: 0.287, subjH: 52 },
  'flower-buckets': { aspect: 1.465, fw: 0.551, fh: 0.819, subjH: 84 },
  'apple-barrel':   { aspect: 1.465, fw: 0.382, fh: 0.612, subjH: 80 },
  trough:           { aspect: 1.485, fw: 0.747, fh: 0.343, subjH: 42 },
  'hay-bales':      { aspect: 1.476, fw: 0.584, fh: 0.686, subjH: 72 },
  'play-balls':     { aspect: 1.500, fw: 0.477, fh: 0.331, subjH: 46 },
  butterflies:      { aspect: 1.500, fw: 0.905, fh: 1.000, subjH: 130 },
  muffin:           { aspect: 1.500, fw: 0.502, fh: 0.541, subjH: 66 },
  joya:             { aspect: 1.500, fw: 0.581, fh: 0.645, subjH: 78 },
  marmalade:        { aspect: 1.465, fw: 0.509, fh: 0.532, subjH: 62 },
};

function groundImage(id, cx) {
  const p = GROUND_IMAGES[id];
  const hImg = p.subjH / p.fh;
  const wImg = hImg * p.aspect;
  const x = cx - wImg / 2;
  const y = (GROUND_BASELINE - p.subjH / 2) - hImg / 2;
  return `<image href="assets/decor/${id}.png" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${wImg.toFixed(1)}" height="${hImg.toFixed(1)}"/>`;
}

/** Build the ground-props row for one paddock. Always present (even empty) so
 *  its height is reserved from the first render -- buying the first ground prop
 *  must never make the paddock grow. Butterflies render first (behind other props)
 *  if owned; grounded props spread evenly across the row on top. */
function groundDecorRow(state, paddock) {
  const owned = paddockDecor(state, paddock);
  const props = owned.filter((id) => GROUND_IMAGES[id] && id !== 'butterflies');
  const images = props
    .map((id, i) => groundImage(id, (900 * (i + 1)) / (props.length + 1)))
    .join('');
  // Butterflies render first (SVG order = behind) if owned; placed at center
  const butterflies = owned.includes('butterflies') ? groundImage('butterflies', 450) : '';
  const row = document.createElement('div');
  row.className = 'ground-decor';
  row.innerHTML = `<svg viewBox="0 0 900 140" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${butterflies}${images}</svg>`;
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
    ${horseFigureHTML(horse, wardrobe)}
    <p class="horse-name">${horse.name}</p>
    <p class="horse-condition">${wellbeingLabel(horse.wellbeing)}</p>
    <p class="horse-trait${showTrait ? ' shown' : ''}">${showTrait ? horse.trait : ''}</p>
    <p class="horse-sponsor${horse.sponsor ? ' shown' : ''}">${horse.sponsor ? `sponsored by ${horse.sponsor} 💛` : ''}</p>
    <div class="wellbeing" role="meter" aria-label="${horse.name}'s wellbeing"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(horse.wellbeing)}">
      <div class="wellbeing-fill" style="width:${horse.wellbeing}%; background:${wellbeingColor(horse.wellbeing)}"></div>
    </div>`;
  // Size variety + left/right facing are paint-only transforms on the whole
  // figure (image + costume overlay together), never the card's own layout box
  // -- so they can't change flex-wrap or paddock height, and costumes stay
  // aligned when a horse is mirrored.
  const jitter = horse.sizeJitter ?? 1;
  const flip = horse.facing === 'left' ? -1 : 1;
  if (jitter !== 1 || flip === -1) {
    card.querySelector('.horse-figure').style.transform = `scale(${(flip * jitter).toFixed(3)}, ${jitter.toFixed(3)})`;
  }
  return card;
}

/**
 * Patch an existing horse card in place (colours, bar, label) rather than
 * rebuilding it, so CSS transitions run and clicks aren't interrupted.
 */
export function updateHorseCard(horse) {
  const card = document.querySelector(`.horse[data-horse-id="${horse.id}"]`);
  if (!card) return;
  // Swap the image to the current coat/state (sad -> neutral -> happy). Setting
  // src to an already-loaded image is instant, so care clicks feel responsive.
  const img = card.querySelector('.horse-img');
  const src = horseImageSrc(horse);
  if (img.getAttribute('src') !== src) img.setAttribute('src', src);

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
 * Pass variant: 'intro' for the one-time colourful "how to play" nudge.
 */
export function showToast(message, variant = null) {
  const container = document.getElementById('toasts');
  // never stack more than 3 — the horses are the point, not the messages.
  // Sticky call-to-action nudges are exempt: a transient beat must never evict
  // the "share to raise money" / "shop is open" prompt out from under a player.
  while (container.children.length >= 3) {
    const victim = [...container.children].find((c) => !c.dataset.sticky) ?? container.firstChild;
    victim.remove();
  }
  const toast = document.createElement('div');
  toast.className = variant ? `toast toast-${variant}` : 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  toast.addEventListener('animationend', () => toast.remove());
}

/**
 * A persistent call-to-action toast that stays until dismissed by code (e.g.
 * once the player shares an update, or opens the shop). Idempotent per id, so
 * calling it every refresh just keeps the one prompt on screen. Pinned above
 * transient toasts so story beats slot in beneath it.
 */
export function showStickyToast(id, message, variant = null) {
  const container = document.getElementById('toasts');
  if (container.querySelector(`[data-sticky="${id}"]`)) return; // already up
  while (container.children.length >= 3) {
    const victim = [...container.children].find((c) => !c.dataset.sticky);
    if (!victim) break;
    victim.remove();
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-sticky${variant ? ` toast-${variant}` : ''}`;
  toast.dataset.sticky = id;
  toast.textContent = message;
  container.prepend(toast);
}

export function dismissStickyToast(id) {
  const el = document.getElementById('toasts').querySelector(`[data-sticky="${id}"]`);
  if (el) el.remove();
}
