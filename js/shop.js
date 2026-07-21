// shop.js — the Tack room: wardrobe & paddock decor, plus the stores.
//
// You own at most one of each item (buy once), and move it around freely:
// place it on a horse / in a paddock, or take it off back into your stores to
// re-use elsewhere. Buying costs coins; placing and removing are free. The one
// exception is the fence banners (flower garland, bunting): you may own as many
// as you like, but still only one banner per paddock. Anything unplaced sits in
// state.shop.stock until you place it again. Decor boosts "share an update"
// while placed; wardrobe boosts a horse's supporter appeal while worn. Unlocking
// is gated by herd size; locked items don't exist in the shop UI at all.

// A paddock holds at most this many horses before older ones roll to the next
// paddock over. It's viewport-dependent: a wide screen fits the whole layered
// herd, but a narrow phone can only show a couple of horses before the front
// row wraps and shoves the newest arrivals (the ones you tap) below the fold.
// So on mobile the cap drops right down and older horses roll to the next
// paddock, reachable with the ‹ nav arrow — the newest always stay on screen
// with the action buttons. Lives here (not render.js) so decor rules can count
// paddocks without importing the renderer.
export const PADDOCK_CAP_WIDE = 8;
export const PADDOCK_CAP_NARROW = 2;
// Matches the 560px layout breakpoint in style.css.
const NARROW_PADDOCK_QUERY = '(max-width: 560px)';

/** How many horses fill a paddock right now, given the viewport width. */
export function paddockCap() {
  return (typeof window !== 'undefined' && window.matchMedia(NARROW_PADDOCK_QUERY).matches)
    ? PADDOCK_CAP_NARROW : PADDOCK_CAP_WIDE;
}

// Fence-line decor hangs above the horses and never crowds them, so it doesn't
// count against a paddock's decoration budget.
export const FENCE_DECOR_IDS = new Set(['flower-garland', 'bunting']);

// Items you may own more than one of. The fence banners are per-paddock scenery
// you'd want in every paddock, so they escape the "one of each" rule; everything
// else is a single object you relocate rather than re-buy.
export const STACKABLE_IDS = FENCE_DECOR_IDS;

// Ground/ambient props a single paddock can hold, beyond the fence-line decor.
export const MAX_EXTRA_DECOR = 3;

// Items that compete for a single slot on a target: a paddock flies the flower
// garland OR the bunting, a horse wears the ear flower OR the forelock bow --
// never both. Owning one blocks buying its rival for that same paddock/horse.
export const EXCLUSIVE_GROUPS = [
  ['flower-garland', 'bunting'],   // fence banner, per paddock
  ['ear-flower', 'forelock-bow'],  // head flair, per horse
];

function exclusiveSiblings(itemId) {
  const group = EXCLUSIVE_GROUPS.find((g) => g.includes(itemId));
  return group ? group.filter((id) => id !== itemId) : [];
}

/** If an exclusive-group rival of this item is already placed in the paddock,
 *  return its id (so the shop can name the chosen one); else null. */
export function paddockExclusiveRival(item, state, paddock) {
  const placed = paddockDecor(state, paddock);
  return exclusiveSiblings(item.id).find((id) => placed.includes(id)) ?? null;
}

/** Likewise for a rival already worn by the horse. */
export function horseExclusiveRival(item, horse) {
  return exclusiveSiblings(item.id).find((id) => horse.wardrobe.includes(id)) ?? null;
}

export const SHOP_ITEMS = [
  // tier 1 — from the first rescue. Scarf and boots are the cheap starter
  // wardrobe; flower garland and bunting are the two fence-banner styles: a
  // paddock flies one OR the other (see EXCLUSIVE_GROUPS), priced the same so
  // the pick is purely a matter of taste.
  { id: 'scarf', name: 'Scarf', category: 'wardrobe', price: 150, requiresHorses: 1, attractionBonus: 0.006 },
  { id: 'boots', name: 'Boots', category: 'wardrobe', price: 250, requiresHorses: 1, attractionBonus: 0.010 },
  { id: 'flower-garland', name: 'Flower garland', category: 'decor', price: 500, requiresHorses: 1, shareBonus: 0.05 },
  { id: 'bunting', name: 'Bunting flags', category: 'decor', price: 500, requiresHorses: 1, shareBonus: 0.05 },

  // tier 2 — 3 horses rescued. Ear flower and forelock bow are the two head-flair
  // styles: a horse wears one OR the other, again same price so it's a free choice.
  { id: 'ear-flower', name: 'Ear flower', category: 'wardrobe', price: 650, requiresHorses: 3, attractionBonus: 0.012 },
  { id: 'forelock-bow', name: 'Forelock bow', category: 'wardrobe', price: 650, requiresHorses: 3, attractionBonus: 0.012 },
  { id: 'trough', name: 'Water trough', category: 'decor', price: 900, requiresHorses: 3, shareBonus: 0.05 },

  // tier 3 — 5 horses rescued
  { id: 'leg-wraps', name: 'Leg wraps', category: 'wardrobe', price: 900, requiresHorses: 5, attractionBonus: 0.014 },
  { id: 'flower-buckets', name: 'Flower buckets', category: 'decor', price: 3000, requiresHorses: 5, shareBonus: 0.06 },
  { id: 'flower-barrow', name: 'Flower barrow', category: 'decor', price: 3400, requiresHorses: 5, shareBonus: 0.06 },
  { id: 'butterflies', name: 'Butterflies', category: 'decor', price: 3600, requiresHorses: 5, shareBonus: 0.06 },

  // tier 4 — 8 horses rescued (matches the paddock-paging threshold). The
  // grandest props are deliberately steep: long-haul goals a maxed-out
  // supporter base funds only well into the late game.
  { id: 'saddle-blanket', name: 'Saddle blanket', category: 'wardrobe', price: 2000, requiresHorses: 8, attractionBonus: 0.020 },
  { id: 'hay-bales', name: 'Hay bales', category: 'decor', price: 9000, requiresHorses: 8, shareBonus: 0.08 },
  { id: 'play-balls', name: 'Play balls', category: 'decor', price: 15000, requiresHorses: 8, shareBonus: 0.08 },

  // tier 5 — the companions. Far out of reach until the rescue is thriving:
  // a real end-game money sink and a reward for a long-tended paddock.
  { id: 'muffin', name: 'Muffin the dog', category: 'decor', price: 50000, requiresHorses: 8, shareBonus: 0.12 },
  { id: 'marmalade', name: 'Marmalade the cat', category: 'decor', price: 65000, requiresHorses: 8, shareBonus: 0.12 },
  { id: 'joya', name: 'Joya the dog', category: 'decor', price: 75000, requiresHorses: 8, shareBonus: 0.15 },
];

/** How many paddocks the herd currently fills (home paddock always counts). */
export function paddockCount(state) {
  return Math.max(1, Math.ceil(state.horses.length / paddockCap()));
}

export function isUnlocked(item, state) {
  return state.horses.length >= item.requiresHorses;
}

export function isAffordable(item, state) {
  return state.coins >= item.price;
}

// ---- ownership & stores ----
// "Owned" means owned whether placed or sitting in stores. Single items cap at
// one; stackable ones (fence banners) never cap.

/** How many of this item are currently placed (worn or in a paddock). */
function placedCount(itemId, state) {
  let n = 0;
  for (const ids of Object.values(state.shop.decorByPaddock ?? {})) {
    n += ids.filter((id) => id === itemId).length;
  }
  for (const horse of state.horses) {
    n += horse.wardrobe.filter((id) => id === itemId).length;
  }
  return n;
}

/** Unplaced copies of this item, waiting in the stores. */
export function stockCount(itemId, state) {
  return state.shop.stock?.[itemId] ?? 0;
}

/** Total copies owned, placed or not. */
export function ownedCount(itemId, state) {
  return stockCount(itemId, state) + placedCount(itemId, state);
}

/** Whether the player may acquire another copy: always for stackable banners,
 *  otherwise only if they don't already own one somewhere. */
export function canOwnMore(item, state) {
  return STACKABLE_IDS.has(item.id) || ownedCount(item.id, state) === 0;
}

function addToStock(itemId, state) {
  state.shop.stock ??= {};
  state.shop.stock[itemId] = (state.shop.stock[itemId] ?? 0) + 1;
}

function takeFromStock(itemId, state) {
  if (!state.shop.stock?.[itemId]) return false;
  state.shop.stock[itemId] -= 1;
  if (state.shop.stock[itemId] <= 0) delete state.shop.stock[itemId];
  return true;
}

// ---- decor: per-paddock ----

/** The decor ids placed in one paddock (by slot index; 0 = home paddock). */
export function paddockDecor(state, paddock) {
  return state.shop.decorByPaddock?.[paddock] ?? [];
}

export function isDecorInPaddock(item, state, paddock) {
  return paddockDecor(state, paddock).includes(item.id);
}

/** Non-fence props already placed in a paddock — what the MAX_EXTRA_DECOR cap
 *  counts. Fence-line decor (garland, bunting) is exempt. */
export function extraDecorCount(state, paddock) {
  return paddockDecor(state, paddock).filter((id) => !FENCE_DECOR_IDS.has(id)).length;
}

/** Whether this paddock has room for one more of this item, ignoring cost. */
export function paddockHasRoomFor(item, state, paddock) {
  if (isDecorInPaddock(item, state, paddock)) return false;
  if (paddockExclusiveRival(item, state, paddock)) return false; // its either/or rival is up
  if (FENCE_DECOR_IDS.has(item.id)) return true; // fence decor never crowds
  return extraDecorCount(state, paddock) < MAX_EXTRA_DECOR;
}

/** Paddock indices this item could still be placed in (room + unlocked),
 *  regardless of affordability — the shop picker's option list. */
export function paddocksOpenFor(item, state) {
  if (item.category !== 'decor' || !isUnlocked(item, state)) return [];
  const open = [];
  for (let p = 0; p < paddockCount(state); p++) {
    if (paddockHasRoomFor(item, state, p)) open.push(p);
  }
  return open;
}

export function canBuyDecorIn(item, state, paddock) {
  return item.category === 'decor' && isUnlocked(item, state)
    && isAffordable(item, state) && canOwnMore(item, state)
    && paddockHasRoomFor(item, state, paddock);
}

export function buyDecorIn(itemId, paddock, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId && i.category === 'decor');
  if (!item || !canBuyDecorIn(item, state, Number(paddock))) return { ok: false, item: null };
  state.coins -= item.price;
  (state.shop.decorByPaddock[paddock] ??= []).push(item.id);
  return { ok: true, item, paddock: Number(paddock) };
}

/** The first paddock a decor item is placed in, or null. Single decor lives in
 *  at most one paddock, so this pinpoints "where it already is". */
export function decorLocation(itemId, state) {
  for (const [p, ids] of Object.entries(state.shop.decorByPaddock ?? {})) {
    if (ids.includes(itemId)) return Number(p);
  }
  return null;
}

/** Place a copy from the stores into a paddock. Free. */
export function placeDecor(itemId, paddock, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId && i.category === 'decor');
  if (!item || stockCount(itemId, state) < 1) return { ok: false, item: null };
  if (!paddockHasRoomFor(item, state, Number(paddock))) return { ok: false, item: null };
  takeFromStock(itemId, state);
  (state.shop.decorByPaddock[paddock] ??= []).push(item.id);
  return { ok: true, item, paddock: Number(paddock) };
}

/** Take a decor item out of a paddock and back into the stores. Free, no refund. */
export function removeDecor(itemId, paddock, state) {
  const arr = state.shop.decorByPaddock?.[paddock];
  const idx = arr ? arr.indexOf(itemId) : -1;
  if (idx === -1) return { ok: false, item: null };
  arr.splice(idx, 1);
  if (arr.length === 0) delete state.shop.decorByPaddock[paddock];
  addToStock(itemId, state);
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  return { ok: true, item };
}

/** Move every decor item in paddocks that no longer exist (the herd shrank past
 *  them) back into the stores, so nothing is orphaned. Silent by design. */
export function reclaimOrphanedDecor(state) {
  const live = paddockCount(state);
  for (const p of Object.keys(state.shop.decorByPaddock ?? {})) {
    if (Number(p) < live) continue;
    for (const id of state.shop.decorByPaddock[p]) addToStock(id, state);
    delete state.shop.decorByPaddock[p];
  }
}

// ---- wardrobe: per-horse ----

export function horseHasItem(horse, itemId) {
  return horse.wardrobe.includes(itemId);
}

/** Horses this wardrobe item can still be bought for: they don't already own it,
 *  and aren't wearing its exclusive-group rival. */
export function eligibleHorses(item, state) {
  return state.horses.filter((h) => !horseHasItem(h, item.id) && !horseExclusiveRival(item, h));
}

export function canBuyWardrobeFor(item, horse, state) {
  return item.category === 'wardrobe' && isUnlocked(item, state) && isAffordable(item, state)
    && canOwnMore(item, state)
    && !horseHasItem(horse, item.id) && !horseExclusiveRival(item, horse);
}

export function buyWardrobe(itemId, horseId, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId && i.category === 'wardrobe');
  const horse = state.horses.find((h) => h.id === horseId);
  if (!item || !horse || !canBuyWardrobeFor(item, horse, state)) return { ok: false, item: null };
  state.coins -= item.price;
  horse.wardrobe.push(item.id);
  return { ok: true, item, horse };
}

/** The horse currently wearing a wardrobe item, or null. Single wardrobe items
 *  are worn by at most one horse. */
export function wardrobeLocation(itemId, state) {
  return state.horses.find((h) => h.wardrobe.includes(itemId)) ?? null;
}

/** Dress a horse in a copy from the stores. Free. */
export function placeWardrobe(itemId, horseId, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId && i.category === 'wardrobe');
  const horse = state.horses.find((h) => h.id === horseId);
  if (!item || !horse || stockCount(itemId, state) < 1) return { ok: false, item: null };
  if (horseHasItem(horse, item.id) || horseExclusiveRival(item, horse)) return { ok: false, item: null };
  takeFromStock(itemId, state);
  horse.wardrobe.push(item.id);
  return { ok: true, item, horse };
}

/** Undress a horse of an item, back into the stores. Free, no refund. */
export function removeWardrobe(itemId, horseId, state) {
  const horse = state.horses.find((h) => h.id === horseId);
  const idx = horse ? horse.wardrobe.indexOf(itemId) : -1;
  if (idx === -1) return { ok: false, item: null };
  horse.wardrobe.splice(idx, 1);
  addToStock(itemId, state);
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  return { ok: true, item, horse };
}

// ---- economy hooks ----

/** Flat bonus added to the per-second supporter attraction chance, summed
 *  across every horse's own wardrobe. */
export function attractionBonus(state) {
  return state.horses.reduce((sum, horse) => {
    const horseBonus = SHOP_ITEMS
      .filter((i) => i.category === 'wardrobe' && horse.wardrobe.includes(i.id))
      .reduce((s, i) => s + i.attractionBonus, 0);
    return sum + horseBonus;
  }, 0);
}

/** Multiplier applied to "share an update" income. Each placed decor adds its
 *  bonus, so the same prop in several paddocks stacks. */
export function shareMultiplier(state) {
  const bonusById = new Map(SHOP_ITEMS.filter((i) => i.category === 'decor').map((i) => [i.id, i.shareBonus]));
  let bonus = 0;
  for (const ids of Object.values(state.shop.decorByPaddock ?? {})) {
    for (const id of ids) bonus += bonusById.get(id) ?? 0;
  }
  return 1 + bonus;
}

/** Whether anything in the shop is newly worth a look — an unplaced item in the
 *  stores waiting to go somewhere, or something unlocked, affordable, and with
 *  room to put it (a paddock with space / a bare horse). */
export function hasNewAffordableItem(state) {
  return SHOP_ITEMS.some((i) => {
    const inStore = stockCount(i.id, state) > 0;
    if (i.category === 'decor') {
      if (inStore && paddocksOpenFor(i, state).length > 0) return true;
      return canOwnMore(i, state) && isUnlocked(i, state) && isAffordable(i, state)
        && paddocksOpenFor(i, state).length > 0;
    }
    if (inStore && eligibleHorses(i, state).length > 0) return true;
    return canOwnMore(i, state) && isUnlocked(i, state) && isAffordable(i, state)
      && eligibleHorses(i, state).length > 0;
  });
}
