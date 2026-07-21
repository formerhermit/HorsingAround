// render.js — turns gameState into DOM. No game logic lives here.

import { horseFigureHTML, horseImageSrc, wellbeingLabel, wellbeingColor, isShinyCoat, isMagicalCoat, COAT_CATALOG } from './horse.js';
import { rescueCost, shareValue, FRONT_ROW, getActiveWant } from './game.js';
import {
  SHOP_ITEMS, isUnlocked, isAffordable, hasNewAffordableItem,
  paddockCap, paddockCount, paddockDecor,
  horseHasItem, isDecorInPaddock, paddockHasRoomFor,
  paddockExclusiveRival, horseExclusiveRival, EXCLUSIVE_GROUPS,
  STACKABLE_IDS, stockCount, decorLocation,
} from './shop.js';

const ITEM_NAME = Object.fromEntries(SHOP_ITEMS.map((i) => [i.id, i.name]));

/** The exclusive-group partner of an item id, if any. */
function exclusiveSiblingId(id) {
  const group = EXCLUSIVE_GROUPS.find((g) => g.includes(id));
  return group ? group.find((x) => x !== id) : null;
}

export function renderAll(state) {
  renderHUD(state);
  renderActions(state);
  renderPaddock(state);
  renderShopButton(state);
  renderPostcardButton(state);
  renderCollectionButton(state);
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
  'flower-buckets': '🪣', 'flower-barrow': '🌷', 'hay-bales': '🌾',
  'play-balls': '🎾', butterflies: '🦋', muffin: '🐶', marmalade: '🐱', joya: '🐕',
  'statue-wooden': '🪵', 'statue-stone': '🗿', 'statue-flowers': '🌸', 'statue-gold': '🏆',
};

/** Shop button: visible once funds exist, badged when something new is worth a look. */
export function renderShopButton(state) {
  const btn = document.getElementById('shop-btn');
  btn.hidden = !state.unlocks.moneyUI;
  document.getElementById('shop-badge').hidden = !hasNewAffordableItem(state);
}

// ---- postcard album ----

/** The album button appears once the first postcard exists; its badge counts
 *  unread ones. */
export function renderPostcardButton(state) {
  const btn = document.getElementById('album-btn');
  if (!btn) return;
  btn.hidden = state.postcards.length === 0;
  const unread = state.postcards.filter((p) => !p.read).length;
  const badge = document.getElementById('album-badge');
  badge.hidden = unread === 0;
  badge.textContent = unread > 0 ? String(unread) : '';
}

/** One polaroid: the horse's happy portrait (in the outfit it wore), its name,
 *  the settling-in note, and the date the card arrived. */
function postcardHTML(pc) {
  const horse = { name: pc.name, paletteKey: pc.paletteKey, wellbeing: 100 };
  const date = new Date(pc.deliveredAt).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  return `
<figure class="postcard">
  <div class="postcard-photo">${horseFigureHTML(horse, pc.wardrobe)}</div>
  <figcaption class="postcard-caption">
    <p class="postcard-name">${pc.name}</p>
    <p class="postcard-msg">${pc.message}</p>
    <p class="postcard-date">${date}</p>
  </figcaption>
</figure>`;
}

export function renderPostcardAlbum(state) {
  const grid = document.getElementById('album-grid');
  const cards = [...state.postcards].sort((a, b) => b.deliveredAt - a.deliveredAt);
  grid.innerHTML = cards.length
    ? cards.map(postcardHTML).join('')
    : '<p class="album-empty">No postcards yet. Rehome a thriving horse and one will find its way back to you 💛</p>';
}

export function openPostcardAlbum(state) {
  renderPostcardAlbum(state);
  document.getElementById('album-overlay').hidden = false;
}

export function closePostcardAlbum() {
  document.getElementById('album-overlay').hidden = true;
}

// ---- collection book ----

/** The 📖 button lives in the top bar always; a "new" dot shows when coats have
 *  been collected since the book was last opened. */
export function renderCollectionButton(state) {
  const badge = document.getElementById('collection-badge');
  if (!badge) return;
  badge.hidden = state.collectedCoats.length <= (state.collectionSeen ?? 0);
}

const RARITY_GROUPS = [
  { rarity: 'common',  title: 'Rescue coats' },
  { rarity: 'rare',    title: 'Rare finds' },
  { rarity: 'magical', title: 'Magical' },
];

/** One stamp: the coat in colour once collected; a dimmed ghost (or, for a
 *  mystery coat, a plain "?") while still locked. */
function stampHTML(coat, collected) {
  const portrait = () => horseFigureHTML({ name: coat.name, paletteKey: coat.id, wellbeing: 100 }, []);
  if (collected) {
    return `<figure class="stamp collected rarity-${coat.rarity}">
      <div class="stamp-photo">${portrait()}</div>
      <figcaption class="stamp-name">${coat.name}</figcaption></figure>`;
  }
  if (coat.mystery) {
    return `<figure class="stamp locked mystery rarity-${coat.rarity}">
      <div class="stamp-photo"><span class="stamp-q">?</span></div>
      <figcaption class="stamp-name">???</figcaption></figure>`;
  }
  const hint = coat.unlock ? `<figcaption class="stamp-hint">${coat.unlock}</figcaption>` : '';
  return `<figure class="stamp locked rarity-${coat.rarity}">
    <div class="stamp-photo">${portrait()}</div>
    <figcaption class="stamp-name">${coat.name}</figcaption>${hint}</figure>`;
}

export function renderCollection(state) {
  const collected = new Set(state.collectedCoats);
  const have = COAT_CATALOG.filter((c) => collected.has(c.id)).length;
  document.getElementById('collection-count').textContent = `${have} of ${COAT_CATALOG.length} collected`;
  document.getElementById('collection-grid').innerHTML = RARITY_GROUPS.map((g) => {
    const coats = COAT_CATALOG.filter((c) => c.rarity === g.rarity);
    if (!coats.length) return '';
    const stamps = coats.map((c) => stampHTML(c, collected.has(c.id))).join('');
    return `<h3 class="collection-group">${g.title}</h3><div class="collection-row">${stamps}</div>`;
  }).join('');
}

export function openCollection(state) {
  renderCollection(state);
  document.getElementById('collection-overlay').hidden = false;
}

export function closeCollection() {
  document.getElementById('collection-overlay').hidden = true;
}

// The shop is target-first: pick one horse / one paddock at the top of each
// section, then every item row shows that target's own state (owned, buyable,
// or blocked). Beats a picker on every card and makes the target unmistakable.
// These hold the chosen target across re-renders while the modal is open.
let shopHorseTarget = null;   // horse id
let shopPaddockTarget = 0;    // paddock index

/** Wrap a control string in the shared item-row markup. */
function shopItemRow(item, control, dimmed) {
  const row = document.createElement('div');
  row.className = `shop-item${dimmed ? ' owned' : ''}`;
  row.innerHTML = `
    <span class="shop-item-icon">${ITEM_EMOJI[item.id] ?? '✨'}</span>
    <span class="shop-item-name">${item.name}</span>
    <span class="shop-item-actions">${control}</span>`;
  return row;
}

const buyBtn = (item, cat, state) =>
  `<button class="shop-buy-btn" data-item-id="${item.id}" data-cat="${cat}" ${isAffordable(item, state) ? '' : 'disabled'}>€${item.price}</button>`;
const placeBtn = (item, cat) =>
  `<button class="shop-place-btn" data-action="place-${cat}" data-item-id="${item.id}">Place</button>`;
const removeBtn = (item, cat) =>
  `<button class="shop-remove-btn" data-action="remove-${cat}" data-item-id="${item.id}" title="Return to your stores">Remove</button>`;

/** One item row for the chosen horse: worn here (with Remove), blocked by its
 *  either/or rival, worn by another horse, placeable from the stores, buyable,
 *  or too dear. */
function wardrobeItemRow(item, horse, state) {
  const worn = horseHasItem(horse, item.id);
  const rival = worn ? null : horseExclusiveRival(item, horse);
  // Clothing is per-horse, so a copy worn by another horse doesn't block this
  // one -- either place a spare from the stores, or buy this horse its own.
  const inStore = !worn && !rival && stockCount(item.id, state) > 0;
  let control, dimmed = false;
  if (worn) {
    control = `<span class="shop-item-owned">Worn</span>${removeBtn(item, 'wardrobe')}`;
    dimmed = true;
  } else if (rival) {
    control = `<span class="shop-item-note">${ITEM_NAME[rival]} chosen</span>`;
    dimmed = true;
  } else if (inStore) {
    control = placeBtn(item, 'wardrobe');
  } else {
    control = buyBtn(item, 'wardrobe', state);
  }
  return shopItemRow(item, control, dimmed);
}

/** One item row for the chosen paddock: placed here (with Remove), blocked by
 *  its either/or rival, placed in another paddock, out of room, placeable from
 *  the stores, buyable, or too dear. */
function decorItemRow(item, paddock, state) {
  const inThis = isDecorInPaddock(item, state, paddock);
  const rival = inThis ? null : paddockExclusiveRival(item, state, paddock);
  const room = paddockHasRoomFor(item, state, paddock);
  const inStore = !inThis && !rival && stockCount(item.id, state) > 0;
  // "Placed elsewhere" only matters when there's no spare in the stores to place.
  const elsewhere = (inThis || rival || inStore || STACKABLE_IDS.has(item.id))
    ? null : decorLocation(item.id, state);
  let control, dimmed = false;
  if (inThis) {
    control = `<span class="shop-item-owned">In paddock</span>${removeBtn(item, 'decor')}`;
    dimmed = true;
  } else if (rival) {
    control = `<span class="shop-item-note">${ITEM_NAME[rival]} chosen</span>`;
    dimmed = true;
  } else if (inStore) {
    control = room ? placeBtn(item, 'decor') : '<span class="shop-item-note">Paddock full</span>';
    dimmed = !room;
  } else if (elsewhere !== null) {
    control = `<span class="shop-item-note">In ${paddockLabel(elsewhere)}</span>`;
    dimmed = true;
  } else if (!room) {
    control = '<span class="shop-item-note">Paddock full</span>';
    dimmed = true;
  } else {
    control = buyBtn(item, 'decor', state);
  }
  return shopItemRow(item, control, dimmed);
}

/** A section's target selector: "<label> [ <select> ]". Re-renders the whole
 *  modal on change so every row reflects the newly chosen target. */
function targetSelector({ id, label, options, selected, onChange, state }) {
  const mount = document.createElement('div');
  mount.className = 'shop-target-inner';
  mount.innerHTML = `
    <label class="shop-target-label" for="${id}">${label}</label>
    <select class="shop-target-select" id="${id}">${
      options.map((o) => `<option value="${o.value}"${String(o.value) === String(selected) ? ' selected' : ''}>${o.text}</option>`).join('')
    }</select>`;
  mount.querySelector('select').addEventListener('change', (e) => {
    onChange(e.target.value);
    renderShopModal(state);
  });
  return mount;
}

/** Fill a shop grid from an ordered item list, using buildRow(item) for each.
 *  Exclusive-group partners that are both present render together in a
 *  full-width "one OR the other" row so the either/or reads at a glance. */
function fillGrid(grid, items, buildRow) {
  const done = new Set();
  for (const item of items) {
    if (done.has(item.id)) continue;
    const sibling = items.find((i) => i.id === exclusiveSiblingId(item.id));
    if (sibling) {
      const pair = document.createElement('div');
      pair.className = 'shop-pair';
      const or = document.createElement('span');
      or.className = 'shop-pair-or';
      or.textContent = 'OR';
      pair.append(buildRow(item), or, buildRow(sibling));
      grid.append(pair);
      done.add(item.id).add(sibling.id);
    } else {
      grid.append(buildRow(item));
    }
  }
}

/** Populate the shop: a target selector + item rows per section. Locked items
 *  (not enough horses rescued yet) are absent entirely. */
export function renderShopModal(state) {
  const wardrobeTarget = document.getElementById('shop-target-wardrobe');
  const decorTarget = document.getElementById('shop-target-decor');
  const wardrobeGrid = document.getElementById('shop-grid-wardrobe');
  const decorGrid = document.getElementById('shop-grid-decor');
  [wardrobeTarget, decorTarget, wardrobeGrid, decorGrid].forEach((el) => el.replaceChildren());

  const unlocked = SHOP_ITEMS.filter((item) => isUnlocked(item, state));

  // --- wardrobe: choose a horse, then dress them ---
  // Magical gift horses (unicorn, rainbow, golden) are guests, not rescues --
  // they don't get dressed up, so they never appear as a target here.
  const horses = state.horses.filter((h) => !isMagicalCoat(h.paletteKey));
  if (!horses.some((h) => h.id === shopHorseTarget)) {
    shopHorseTarget = horses[horses.length - 1]?.id ?? null; // default: newest arrival
  }
  const horse = horses.find((h) => h.id === shopHorseTarget);
  if (horse && horses.length > 1) {
    wardrobeTarget.append(targetSelector({
      id: 'shop-horse-select', label: 'Dressing', state,
      options: horses.map((h) => ({ value: h.id, text: h.name })),
      selected: shopHorseTarget, onChange: (v) => { shopHorseTarget = v; },
    }));
  }
  if (horse) {
    fillGrid(wardrobeGrid, unlocked.filter((i) => i.category === 'wardrobe'),
      (item) => wardrobeItemRow(item, horse, state));
  }

  // --- decor: choose a paddock, then decorate it ---
  const total = paddockCount(state);
  shopPaddockTarget = Math.min(Math.max(0, shopPaddockTarget), total - 1);
  if (total > 1) {
    decorTarget.append(targetSelector({
      id: 'shop-paddock-select', label: 'Decorating', state,
      options: Array.from({ length: total }, (_, p) => ({ value: p, text: paddockLabel(p) })),
      selected: shopPaddockTarget, onChange: (v) => { shopPaddockTarget = Number(v); },
    }));
  }
  fillGrid(decorGrid, unlocked.filter((i) => i.category === 'decor'),
    (item) => decorItemRow(item, shopPaddockTarget, state));
}

/** The paddock the decor section is currently targeting (read by the buy handler). */
export function shopDecorPaddock() {
  return shopPaddockTarget;
}

/** The horse the wardrobe section is currently targeting (read by the buy handler). */
export function shopWardrobeHorse() {
  return shopHorseTarget;
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

/** A subtle "+N 💛" over the supporters chip, for follower arrivals once the
 *  per-arrival toasts have tapered off. Kept out of the toast stack on purpose. */
export function showSupporterPop(count) {
  const chip = document.getElementById('chip-supporters');
  if (!chip || chip.hidden) return;
  const pop = document.createElement('span');
  pop.className = 'supporter-pop';
  pop.style.setProperty('--tilt', `${(Math.random() * 8 - 4).toFixed(1)}deg`);
  pop.textContent = `+${count} 💛`;
  chip.appendChild(pop);
  pop.addEventListener('animationend', () => pop.remove());
}

// How many horses stand in the foreground row (FRONT_ROW, shared with game.js);
// older horses move to a smaller background line along the fence, further away.
const FRONT_COUNT = FRONT_ROW;
const FRONT_SCALES = [1, 0.82, 0.68]; // newest first
const BACK_SCALE = 0.48;
// A scale-1 card is one --horse-unit wide (set in CSS, viewport-responsive).

// paddockCap() (how many horses fill a paddock before older ones roll over --
// viewport-dependent) lives in shop.js so decor rules can count paddocks;
// imported above.

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

/** Split the herd, newest first, into paddocks of up to paddockCap().
 *  Never leaves a single horse alone — herd animals, even in the UI. */
function paddockChunks(state) {
  const cap = paddockCap();
  const newestFirst = [...state.horses].reverse();
  const chunks = [];
  for (let i = 0; i < newestFirst.length; i += cap) {
    chunks.push(newestFirst.slice(i, i + cap));
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

  const children = [backRow, groundDecorRow(state, currentPaddock), frontRow];
  const butterflies = butterfliesOverlay(state, currentPaddock);
  if (butterflies) children.unshift(butterflies); // behind the horses
  document.getElementById('horses').replaceChildren(...children);
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

  renderWantBubbles(state); // re-attach the want bubble to the freshly-built card
}

// Fence-line decor: stays on the fixed overlay near the actual fence rails.
// Positioned in a 900x130 space so items never collide even all owned at once.
// Flower garland repeats along the whole fence, resting on the top rail (the
// top plank sits around y~18-22 in the decor space, the same rail the bunting
// hangs from).
const GARLAND_RAIL_Y = 22; // SVG-y the garland subject centres on (the top rail)
function fenceGarlandImages() {
  const garland = { aspect: 1.500, fw: 0.635, fh: 0.287, subjH: 12 }; // a touch smaller
  const hImg = garland.subjH / garland.fh;
  const wImg = hImg * garland.aspect;
  const y = GARLAND_RAIL_Y - hImg / 2; // subject centred on the rail
  const images = [];
  const spacing = wImg * garland.fw + 6; // tile the solid subject edge-to-edge
  // Repeat from the very start of the fence (subject left edge at x=0).
  for (let cx = wImg / 2; cx < 900 + wImg; cx += spacing) {
    const x = cx - wImg / 2;
    images.push(`<image href="assets/decor/flower-garland.png" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${wImg.toFixed(1)}" height="${hImg.toFixed(1)}"/>`);
  }
  return images.join('');
}

// Bunting: swags of triangular flags strung from the top rail, repeating
// edge-to-edge across the whole fence just like the flower garland.
// In the 900x130 decor space the top rail sits at y~18 and the lower rail at
// y~40, so the string hangs just above the top rail and the flags drape into
// the gap below it without reaching the lower rail.
const BUNTING_COLORS = ['#E8917A', '#8FC0E8', '#F5D949', '#A6D8A0'];
function fenceBuntingSwags() {
  const swagW = 130;   // one swag spans this much of the fence
  const y0 = 15;       // string endpoints, resting on the top rail
  const dip = 7;       // how far the string sags at the swag's centre
  const fw = 4.5, fh = 10; // flag half-width and length
  const parts = [];
  for (let x0 = 0; x0 < 900; x0 += swagW) {
    const xc = x0 + swagW / 2;
    const x1 = x0 + swagW;
    parts.push(`<path d="M${x0},${y0} Q${xc},${y0 + dip} ${x1},${y0}" fill="none" stroke="#a3763a" stroke-width="1.5"/>`);
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const fx = x0 + t * swagW;
      // string y at t on the quadratic bezier
      const sy = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * (y0 + dip) + t * t * y0;
      parts.push(`<path d="M${(fx - fw).toFixed(1)},${sy.toFixed(1)} L${(fx + fw).toFixed(1)},${sy.toFixed(1)} L${fx.toFixed(1)},${(sy + fh).toFixed(1)} Z" fill="${BUNTING_COLORS[i]}"/>`);
    }
  }
  return parts.join('');
}

const FENCE_DECOR_MARKUP = {
  'flower-garland': fenceGarlandImages(),
  bunting: fenceBuntingSwags(),
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
const GROUND_BASELINE = 92; // subject bottoms rest near here (in the 100-tall row)
// Each prop is a transparent PNG; aspect + fw/fh (fraction of the trimmed frame
// its solid subject fills, glow ignored) let us size from a target subject
// height. The horizontal slot is assigned dynamically so any mix of props
// spreads evenly across the row. Butterflies are overlay-only (no ground slot).
const GROUND_IMAGES = {
  'flower-buckets': { aspect: 1.465, fw: 0.551, fh: 0.819, subjH: 70 },
  'flower-barrow':  { aspect: 1.500, fw: 0.854, fh: 0.891, subjH: 72 },
  trough:           { aspect: 1.485, fw: 0.747, fh: 0.343, subjH: 42 },
  'hay-bales':      { aspect: 1.476, fw: 0.584, fh: 0.686, subjH: 72 },
  'play-balls':     { aspect: 2.163, fw: 0.475, fh: 0.329, subjH: 46 },
  muffin:           { aspect: 1.500, fw: 0.502, fh: 0.541, subjH: 66 },
  joya:             { aspect: 1.500, fw: 0.581, fh: 0.645, subjH: 78 },
  marmalade:        { aspect: 1.465, fw: 0.509, fh: 0.532, subjH: 48 },
  // Gift statues — tightly cropped to the subject (fw/fh = 1), so aspect is just
  // the image's own w/h. Tall props: horse on a plinth.
  'statue-wooden':  { aspect: 0.845, fw: 1.0, fh: 1.0, subjH: 84 },
  'statue-stone':   { aspect: 0.890, fw: 1.0, fh: 1.0, subjH: 84 },
  'statue-flowers': { aspect: 0.884, fw: 1.0, fh: 1.0, subjH: 84 },
  'statue-gold':    { aspect: 0.866, fw: 1.0, fh: 1.0, subjH: 84 },
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
 *  must never make the paddock grow. Grounded props spread evenly across the
 *  row. Fence decor (garland/bunting) and butterflies are drawn elsewhere. */
function groundDecorRow(state, paddock) {
  const props = paddockDecor(state, paddock).filter((id) => GROUND_IMAGES[id]);
  const images = props
    .map((id, i) => groundImage(id, (900 * (i + 1)) / (props.length + 1)))
    .join('');
  const row = document.createElement('div');
  row.className = 'ground-decor';
  row.innerHTML = `<svg viewBox="0 0 900 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${images}</svg>`;
  return row;
}

/** Full-paddock butterfly layer -- a scatter that spans the whole grass, behind
 *  the horses. Only present when the paddock owns the butterflies decor. */
function butterfliesOverlay(state, paddock) {
  if (!paddockDecor(state, paddock).includes('butterflies')) return null;
  const layer = document.createElement('div');
  layer.className = 'paddock-butterflies';
  layer.setAttribute('aria-hidden', 'true');
  return layer;
}

function horseCard(horse, scale = 1, isBack = false, wardrobe = []) {
  const card = document.createElement('div');
  card.className = `horse${isBack ? ' is-back' : ''}${isShinyCoat(horse) ? ' is-shiny' : ''}`;
  // Width and text both key off --horse-unit (a viewport-responsive length, see
  // CSS) so the whole scene shrinks to fit shorter screens instead of pushing
  // the buttons off the bottom. 70vw keeps a lone big horse off the edges.
  card.style.width = `min(calc(var(--horse-unit) * ${scale}), 70vw)`;
  card.style.fontSize = `calc(var(--horse-unit) * ${scale} / 10.5)`;
  card.dataset.horseId = horse.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Care for ${horse.name}`);
  // The sponsor line stays in the layout (visibility-toggled by the "shown"
  // class) so a sponsorship reveal never changes card height mid-game.
  card.innerHTML = `
    ${horseFigureHTML(horse, wardrobe)}
    <p class="horse-name">${horse.name}</p>
    <p class="horse-condition">${wellbeingLabel(horse.wellbeing)}</p>
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
export function showCareFeedback(card, message, clickEvent, { crit = false } = {}) {
  card.classList.remove('just-cared');
  void card.offsetWidth; // restart the bounce animation
  card.classList.add('just-cared');

  const pop = document.createElement('span');
  // A crit gets the standout gold pop; everyday clicks get a random pastel
  // variant + slight tilt to keep repeated clicks lively.
  pop.className = crit ? 'care-pop crit' : `care-pop c${Math.floor(Math.random() * 5)}`;
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

/** A spontaneous-tip pop, money-coloured so it clearly reads as cash. Placed
 *  near the top of the card (not at the pointer) so it doesn't collide with the
 *  care pop when the same click both cares for the horse and draws a tip. */
export function showTipPop(card, tip) {
  const pop = document.createElement('span');
  pop.className = 'care-pop tip';
  pop.style.setProperty('--tilt', `${(Math.random() * 8 - 4).toFixed(1)}deg`);
  pop.textContent = `💛 ${tip.supporter} tipped €${tip.amount}`;
  const rect = card.getBoundingClientRect();
  pop.style.left = `${rect.width * 0.5}px`;
  pop.style.top = `${rect.height * 0.12}px`;
  card.appendChild(pop);
  pop.addEventListener('animationend', () => pop.remove());
}

// ---- little needs ----

/** Sync want thought-bubbles onto the on-screen horse cards: add one to the
 *  horse that currently wants something, remove any that shouldn't be there.
 *  Patches existing cards (never rebuilds), so a fulfilment pop isn't wiped. */
export function renderWantBubbles(state) {
  const want = getActiveWant();
  for (const card of document.querySelectorAll('.horse')) {
    const bubble = card.querySelector('.want-bubble');
    const wants = want && card.dataset.horseId === want.horseId;
    if (wants && !bubble) {
      const b = document.createElement('div');
      b.className = 'want-bubble';
      b.textContent = want.need.bubble;
      card.appendChild(b);
    } else if (wants && bubble) {
      bubble.textContent = want.need.bubble;
    } else if (!wants && bubble) {
      bubble.remove();
    }
  }
}

/** Feedback for tending a want: the flavour pop, a supporter-burst pop, and a
 *  camera flash for the "take a photo" want. */
export function showWantFulfilled(card, want, clickEvent) {
  showCareFeedback(card, want.need.done, clickEvent, { crit: true });
  const pop = document.createElement('span');
  pop.className = 'care-pop tip';
  pop.style.setProperty('--tilt', `${(Math.random() * 8 - 4).toFixed(1)}deg`);
  pop.textContent = `+${want.supporters} supporters 💛`;
  const rect = card.getBoundingClientRect();
  pop.style.left = `${rect.width * 0.5}px`;
  pop.style.top = `${rect.height * 0.1}px`;
  card.appendChild(pop);
  pop.addEventListener('animationend', () => pop.remove());
  if (want.need.photo) {
    const flash = document.createElement('div');
    flash.className = 'photo-flash';
    card.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove());
  }
}

/**
 * Narrative toast at the top of the paddock (first donation, new
 * supporters, arrivals). Auto-dismisses via its CSS animation.
 * Pass variant: 'intro' for the one-time colourful "how to play" nudge.
 */
export function showToast(message, variant = null) {
  const container = document.getElementById('toasts');
  // never stack more than 3 — the horses are the point, not the messages.
  while (container.children.length >= 3) container.firstChild.remove();
  const toast = document.createElement('div');
  toast.className = variant ? `toast toast-${variant}` : 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  toast.addEventListener('animationend', () => toast.remove());
}

// Onboarding popups: a big centred card (shop-modal styling) with a playful
// curved arrow pointing toward the button it's teaching. The arrow is hand-drawn
// so it matches the flat, rounded look of the rest of the game.
const NUDGE_ARROWS = {
  down: `<path d="M35 8 C 14 26, 56 46, 35 70" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
         <path d="M22 55 L35 74 L48 55" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  up: `<path d="M35 82 C 14 64, 56 44, 35 20" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
       <path d="M22 35 L35 16 L48 35" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
};

/** Show the onboarding popup for `id`. Idempotent per id, so calling it every
 *  refresh keeps the one popup up without restarting its entrance animation. */
export function showNudgePopup(id, { emoji, text, dir }) {
  const overlay = document.getElementById('nudge-overlay');
  if (overlay.dataset.nudge === id && !overlay.hidden) return; // already up
  overlay.dataset.nudge = id;
  document.getElementById('nudge-emoji').textContent = emoji;
  document.getElementById('nudge-text').textContent = text;
  const arrow = document.getElementById('nudge-arrow');
  arrow.setAttribute('class', `nudge-arrow nudge-arrow-${dir}`); // SVG className is read-only
  arrow.innerHTML = dir.startsWith('up') ? NUDGE_ARROWS.up : NUDGE_ARROWS.down;
  overlay.hidden = false;
}

export function hideNudgePopup() {
  const overlay = document.getElementById('nudge-overlay');
  overlay.hidden = true;
  overlay.dataset.nudge = '';
}

/**
 * A modal event dialog (shop-card styling) with an emoji, a message, and one or
 * two buttons. Each button = { label, variant, onClick }; clicking it closes the
 * dialog and runs onClick. Pass confetti:true for a celebratory burst.
 */
export function showDialog({ emoji = '', text, buttons = [], confetti = false, share = false }) {
  const overlay = document.getElementById('dialog-overlay');
  document.getElementById('dialog-emoji').textContent = emoji;
  // innerHTML so callers can wrap key figures in <span class="fig">. All dialog
  // text is authored in-code (horse names come from a fixed list), never user
  // input, so there's no untrusted markup here.
  document.getElementById('dialog-text').innerHTML = text;
  const row = document.getElementById('dialog-buttons');
  row.replaceChildren();
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = `dialog-btn${b.variant ? ` dialog-btn-${b.variant}` : ''}`;
    btn.textContent = b.label;
    btn.addEventListener('click', () => {
      overlay.hidden = true;
      b.onClick?.();
    }, { once: true });
    row.append(btn);
  }

  // Optional "Tell a friend" affordance on celebratory milestones. It carries
  // data-share-game (handled by share.js's delegated listener) and deliberately
  // sits outside the button row so it does NOT dismiss the dialog: a player can
  // share their milestone and still click Collect. Rebuilt each call; removed
  // when the next dialog doesn't ask for it.
  const card = overlay.querySelector('.dialog-card');
  card.querySelector('.dialog-share')?.remove();
  if (share) {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-share';
    wrap.innerHTML =
      '<button class="dialog-share-btn" data-share-game type="button" ' +
      'aria-label="Tell a friend about Horsing Around">' +
      '<span aria-hidden="true">💛</span> Tell a friend</button>';
    card.append(wrap);
  }

  overlay.hidden = false;
  if (confetti) burstConfetti();
}

const CONFETTI_COLORS = ['#F2A6C6', '#F5D949', '#8FC0E8', '#A6D8A0', '#E8917A', '#b0823f'];

/** A one-off confetti burst from the top-centre of the screen. */
function burstConfetti() {
  const layer = document.getElementById('confetti');
  if (!layer) return;
  for (let i = 0; i < 70; i++) {
    const bit = document.createElement('span');
    bit.className = 'confetti-bit';
    bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    bit.style.setProperty('--x', (Math.random() * 2 - 1).toFixed(2));
    bit.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    bit.style.setProperty('--d', `${(0.9 + Math.random() * 0.9).toFixed(2)}s`);
    bit.style.setProperty('--delay', `${(Math.random() * 0.2).toFixed(2)}s`);
    bit.addEventListener('animationend', () => bit.remove(), { once: true });
    layer.append(bit);
  }
}
