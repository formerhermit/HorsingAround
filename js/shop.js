// shop.js — purchasable wardrobe & paddock decor items.
//
// Decor items are global: one purchase dresses the whole paddock scene and
// boosts the value of "share an update". Wardrobe items are per-horse: each
// purchase dresses one chosen horse and boosts that horse's contribution to
// passive supporter attraction — buy again to dress another horse. Both are
// permanent once bought. Unlocking is gated by herd size; locked items
// don't exist in the shop UI at all.

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
  { id: 'butterflies', name: 'Butterflies', category: 'decor', price: 3600, requiresHorses: 5, shareBonus: 0.06 },

  // tier 4 — 8 horses rescued (matches the paddock-paging threshold). The
  // grandest props are deliberately steep: long-haul goals a maxed-out
  // supporter base funds only well into the late game.
  { id: 'saddle-blanket', name: 'Saddle blanket', category: 'wardrobe', price: 2000, requiresHorses: 8, attractionBonus: 0.020 },
  { id: 'hay-bales', name: 'Hay bales', category: 'decor', price: 9000, requiresHorses: 8, shareBonus: 0.08 },
  { id: 'play-balls', name: 'Play balls', category: 'decor', price: 15000, requiresHorses: 8, shareBonus: 0.08 },
];

export function isUnlocked(item, state) {
  return state.horses.length >= item.requiresHorses;
}

export function isAffordable(item, state) {
  return state.coins >= item.price;
}

// ---- decor: global, one of each ----

export function isDecorOwned(item, state) {
  return state.shop.owned.includes(item.id);
}

export function canBuyDecor(item, state) {
  return item.category === 'decor' && isUnlocked(item, state) && !isDecorOwned(item, state) && isAffordable(item, state);
}

export function buyDecor(itemId, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId && i.category === 'decor');
  if (!item || !canBuyDecor(item, state)) return { ok: false, item: null };
  state.coins -= item.price;
  state.shop.owned.push(item.id);
  return { ok: true, item };
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

/** Multiplier applied to "share an update" income. */
export function shareMultiplier(state) {
  const bonus = SHOP_ITEMS
    .filter((i) => i.category === 'decor' && state.shop.owned.includes(i.id))
    .reduce((sum, i) => sum + i.shareBonus, 0);
  return 1 + bonus;
}

/** Whether anything in the shop is newly worth a look — unlocked, affordable,
 *  and (for wardrobe) at least one horse who doesn't have it yet. */
export function hasNewAffordableItem(state) {
  return SHOP_ITEMS.some((i) => {
    if (i.category === 'decor') return canBuyDecor(i, state);
    return isUnlocked(i, state) && isAffordable(i, state) && eligibleHorses(i, state).length > 0;
  });
}
