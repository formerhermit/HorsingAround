// shop.js — purchasable wardrobe & paddock decor items.
//
// Decor items are placed per paddock: a purchase dresses one chosen paddock
// and boosts the value of "share an update" (bonuses stack across paddocks).
// The flower garland and bunting hang on the fence line and are unlimited, but
// a paddock holds at most MAX_EXTRA_DECOR of the other props so the scene never
// gets crowded. Wardrobe items are per-horse: each purchase dresses one chosen
// horse and boosts that horse's contribution to passive supporter attraction —
// buy again to dress another horse. Both are permanent once bought. Unlocking
// is gated by herd size; locked items don't exist in the shop UI at all.

// A paddock holds at most this many horses before older ones roll to the next
// paddock over. Lives here (not render.js) so decor rules can count paddocks
// without importing the renderer.
export const PADDOCK_CAP = 8;

// Fence-line decor hangs above the horses and never crowds them, so it doesn't
// count against a paddock's decoration budget.
export const FENCE_DECOR_IDS = new Set(['flower-garland', 'bunting']);

// Ground/ambient props a single paddock can hold, beyond the fence-line decor.
export const MAX_EXTRA_DECOR = 3;

export const SHOP_ITEMS = [
  // tier 1 — available as soon as the shop itself unlocks
  { id: 'scarf', name: 'Scarf', category: 'wardrobe', price: 150, requiresHorses: 1, attractionBonus: 0.006 },
  { id: 'flower-garland', name: 'Flower garland', category: 'decor', price: 300, requiresHorses: 1, shareBonus: 0.04 },
  { id: 'ear-flower', name: 'Ear flower', category: 'wardrobe', price: 180, requiresHorses: 1, attractionBonus: 0.006 },

  // tier 2 — 3 horses rescued
  { id: 'boots', name: 'Boots', category: 'wardrobe', price: 400, requiresHorses: 3, attractionBonus: 0.010 },
  { id: 'bunting', name: 'Bunting flags', category: 'decor', price: 800, requiresHorses: 3, shareBonus: 0.05 },
  { id: 'trough', name: 'Water trough', category: 'decor', price: 900, requiresHorses: 3, shareBonus: 0.05 },

  // tier 3 — 5 horses rescued
  { id: 'leg-wraps', name: 'Leg wraps', category: 'wardrobe', price: 900, requiresHorses: 5, attractionBonus: 0.014 },
  { id: 'forelock-bow', name: 'Forelock bow', category: 'wardrobe', price: 1000, requiresHorses: 5, attractionBonus: 0.014 },
  { id: 'flower-buckets', name: 'Flower buckets', category: 'decor', price: 3000, requiresHorses: 5, shareBonus: 0.06 },
  { id: 'apple-barrel', name: 'Apple barrel', category: 'decor', price: 3400, requiresHorses: 5, shareBonus: 0.06 },
  { id: 'butterflies', name: 'Butterflies', category: 'decor', price: 3600, requiresHorses: 5, shareBonus: 0.06 },

  // tier 4 — 8 horses rescued (matches the paddock-paging threshold). The
  // grandest props are deliberately steep: long-haul goals a maxed-out
  // supporter base funds only well into the late game.
  { id: 'saddle-blanket', name: 'Saddle blanket', category: 'wardrobe', price: 2000, requiresHorses: 8, attractionBonus: 0.020 },
  { id: 'hay-bales', name: 'Hay bales', category: 'decor', price: 9000, requiresHorses: 8, shareBonus: 0.08 },
  { id: 'play-balls', name: 'Play balls', category: 'decor', price: 15000, requiresHorses: 8, shareBonus: 0.08 },

  // tier 5 — the companions. Far out of reach until the rescue is thriving:
  // a real end-game money sink and a reward for a long-tended paddock.
  { id: 'joya', name: 'Joya the dog', category: 'decor', price: 50000, requiresHorses: 8, shareBonus: 0.12 },
  { id: 'marmalade', name: 'Marmalade the cat', category: 'decor', price: 65000, requiresHorses: 8, shareBonus: 0.12 },
];

/** How many paddocks the herd currently fills (home paddock always counts). */
export function paddockCount(state) {
  return Math.max(1, Math.ceil(state.horses.length / PADDOCK_CAP));
}

export function isUnlocked(item, state) {
  return state.horses.length >= item.requiresHorses;
}

export function isAffordable(item, state) {
  return state.coins >= item.price;
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
    && isAffordable(item, state) && paddockHasRoomFor(item, state, paddock);
}

export function buyDecorIn(itemId, paddock, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId && i.category === 'decor');
  if (!item || !canBuyDecorIn(item, state, Number(paddock))) return { ok: false, item: null };
  state.coins -= item.price;
  (state.shop.decorByPaddock[paddock] ??= []).push(item.id);
  return { ok: true, item, paddock: Number(paddock) };
}

// ---- wardrobe: per-horse ----

export function horseHasItem(horse, itemId) {
  return horse.wardrobe.includes(itemId);
}

/** Horses that don't already own this wardrobe item — who it can still be bought for. */
export function eligibleHorses(item, state) {
  return state.horses.filter((h) => !horseHasItem(h, item.id));
}

export function canBuyWardrobeFor(item, horse, state) {
  return item.category === 'wardrobe' && isUnlocked(item, state) && isAffordable(item, state) && !horseHasItem(horse, item.id);
}

export function buyWardrobe(itemId, horseId, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId && i.category === 'wardrobe');
  const horse = state.horses.find((h) => h.id === horseId);
  if (!item || !horse || !canBuyWardrobeFor(item, horse, state)) return { ok: false, item: null };
  state.coins -= item.price;
  horse.wardrobe.push(item.id);
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

/** Whether anything in the shop is newly worth a look — unlocked, affordable,
 *  and with somewhere left to put it (a paddock with room / a bare horse). */
export function hasNewAffordableItem(state) {
  return SHOP_ITEMS.some((i) => {
    if (!isUnlocked(i, state) || !isAffordable(i, state)) return false;
    if (i.category === 'decor') return paddocksOpenFor(i, state).length > 0;
    return eligibleHorses(i, state).length > 0;
  });
}
