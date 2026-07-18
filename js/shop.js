// shop.js — purchasable wardrobe & paddock decor items.
//
// Wardrobe items dress every horse (global, not per-horse) and boost passive
// supporter attraction. Decor items dress the paddock scene and boost the
// value of "share an update". Both are permanent once bought. Unlocking is
// gated by herd size; locked items don't exist in the shop UI at all.

export const SHOP_ITEMS = [
  // tier 1 — available as soon as the shop itself unlocks
  { id: 'scarf', name: 'Scarf', category: 'wardrobe', price: 150, requiresHorses: 1, attractionBonus: 0.006 },
  { id: 'flower-garland', name: 'Flower garland', category: 'decor', price: 150, requiresHorses: 1, shareBonus: 0.04 },
  { id: 'ear-flower', name: 'Ear flower', category: 'wardrobe', price: 180, requiresHorses: 1, attractionBonus: 0.006 },

  // tier 2 — 3 horses rescued
  { id: 'boots', name: 'Boots', category: 'wardrobe', price: 400, requiresHorses: 3, attractionBonus: 0.010 },
  { id: 'bunting', name: 'Bunting flags', category: 'decor', price: 400, requiresHorses: 3, shareBonus: 0.05 },
  { id: 'trough', name: 'Water trough', category: 'decor', price: 450, requiresHorses: 3, shareBonus: 0.05 },

  // tier 3 — 5 horses rescued
  { id: 'leg-wraps', name: 'Leg wraps', category: 'wardrobe', price: 900, requiresHorses: 5, attractionBonus: 0.014 },
  { id: 'forelock-bow', name: 'Forelock bow', category: 'wardrobe', price: 1000, requiresHorses: 5, attractionBonus: 0.014 },
  { id: 'flower-buckets', name: 'Flower buckets', category: 'decor', price: 900, requiresHorses: 5, shareBonus: 0.06 },
  { id: 'butterflies', name: 'Butterflies', category: 'decor', price: 950, requiresHorses: 5, shareBonus: 0.06 },

  // tier 4 — 8 horses rescued (matches the paddock-paging threshold)
  { id: 'saddle-blanket', name: 'Saddle blanket', category: 'wardrobe', price: 2000, requiresHorses: 8, attractionBonus: 0.020 },
  { id: 'hay-bales', name: 'Hay bales', category: 'decor', price: 2200, requiresHorses: 8, shareBonus: 0.08 },
  { id: 'play-balls', name: 'Play balls', category: 'decor', price: 2200, requiresHorses: 8, shareBonus: 0.08 },
];

export function isUnlocked(item, state) {
  return state.horses.length >= item.requiresHorses;
}

export function isOwned(item, state) {
  return state.shop.owned.includes(item.id);
}

export function isAffordable(item, state) {
  return state.coins >= item.price;
}

export function canBuy(item, state) {
  return isUnlocked(item, state) && !isOwned(item, state) && isAffordable(item, state);
}

/** Spend funds and add the item to the permanent collection. */
export function buyItem(itemId, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!item || !canBuy(item, state)) return { ok: false, item: null };
  state.coins -= item.price;
  state.shop.owned.push(item.id);
  return { ok: true, item };
}

/** Flat bonus added to the per-second supporter attraction chance. */
export function attractionBonus(state) {
  return SHOP_ITEMS
    .filter((i) => i.category === 'wardrobe' && state.shop.owned.includes(i.id))
    .reduce((sum, i) => sum + i.attractionBonus, 0);
}

/** Multiplier applied to "share an update" income. */
export function shareMultiplier(state) {
  const bonus = SHOP_ITEMS
    .filter((i) => i.category === 'decor' && state.shop.owned.includes(i.id))
    .reduce((sum, i) => sum + i.shareBonus, 0);
  return 1 + bonus;
}

/** Whether anything in the shop is newly worth a look — unlocked, unowned, affordable. */
export function hasNewAffordableItem(state) {
  return SHOP_ITEMS.some((i) => canBuy(i, state));
}
