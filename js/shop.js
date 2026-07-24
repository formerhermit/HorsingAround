// shop.js — the Tack room: wardrobe & paddock decor, plus the stores.

import { isMagicalCoat } from './horse.js';
import { maxPaddocks } from './facilities.js';

//
// You own at most one of each item (buy once), and move it around freely:
// place it on a horse / in a paddock, or take it off back into your stores to
// re-use elsewhere. Buying costs coins; placing and removing are free. The one
// exception is the fence banners (flower garland, bunting): you may own as many
// as you like, but still only one banner per paddock. Anything unplaced sits in
// state.shop.stock until you place it again. Decor boosts "share an update"
// while placed; wardrobe boosts a horse's supporter appeal while worn. Unlocking
// is gated by herd size; locked items don't exist in the shop UI at all.

// A paddock holds this many horses. Deliberately NOT viewport-dependent: a
// paddock is a real thing the player owns (bought, decorated, saved), so it
// must mean the same on every device — a narrow phone shows a paddock a couple
// of horses at a time instead of splitting the herd differently (see
// render.js's view paging). Lives here (not render.js) so decor rules can
// count paddocks without importing the renderer.
export const PADDOCK_CAP = 8;

// The rescue starts with the home paddock; more can be built. Prices keyed by
// which paddock number the purchase would be: the second is a mid-game save-up
// (the herd needs it around the 8th rescue), the third an end-game sink priced
// with the companions. The fourth only unlocks with the Sanctuary field facility
// (issue #48) -- see maxPaddocks() -- so most players never see it.
export const MAX_PADDOCKS = 4;
export const PADDOCK_PRICES = { 2: 2500, 3: 75000, 4: 250000 };

// Decor slot index of the magical paddock — the free home of the magical gift
// horses (unicorn, rainbow, golden pegasus). It exists only while a magical
// horse does, never holds rescues, and never counts toward herd capacity.
// Safely clear of the regular paddock indices (0..MAX_PADDOCKS-1).
export const MAGIC_PADDOCK = 9;

/** Whether the herd includes a magical gift horse (=> the magical paddock exists). */
export function hasMagicalHorse(state) {
  return state.horses.some((h) => isMagicalCoat(h.paletteKey));
}

// Fence-line decor hangs above the horses and never crowds them, so it doesn't
// count against a paddock's decoration budget.
export const FENCE_DECOR_IDS = new Set(['flower-garland', 'bunting']);

// Items you may own more than one of. The fence banners are per-paddock scenery
// you'd want in every paddock, so they escape the "one of each" rule; everything
// else is a single object you relocate rather than re-buy.
export const STACKABLE_IDS = FENCE_DECOR_IDS;

// Ground/ambient props a single paddock can hold, beyond the fence-line decor.
// Props keep their fixed sizes and simply spread across the row (render.js), so
// a fuller paddock packs the space rather than shrinking anything. At 5, every
// ground item and statue in the game can be placed across the buildable
// paddocks plus the magical one.
export const MAX_EXTRA_DECOR = 5;

// Items that compete for a single slot on a target: a paddock flies the flower
// garland OR the bunting, a horse wears the ear flower OR the forelock bow --
// never both. Owning one blocks buying its rival for that same paddock/horse.
export const EXCLUSIVE_GROUPS = [
  ['flower-garland', 'bunting'],   // fence banner, per paddock
  ['ear-flower', 'forelock-bow'],  // head flair, per horse
  ['winter-rug', 'saddle-blanket'], // back wear, per horse — they'd overlap
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
  // The wardrobe list is ordered for the shop's two-column grid (issue #71):
  // matching pieces sit side by side once unlocked — boots with leg wraps,
  // the winter rug with its either/or saddle blanket, the ear flower with its
  // either/or forelock bow. Unlock tiers (requiresHorses) are unchanged.

  // tier 1 — from the first rescue. Boots and the winter rug are the cheap
  // starter wardrobe (the rug replaced the retired scarf, issue #38: back-worn
  // pieces sit right on every coat); flower garland and bunting are the two
  // fence-banner styles: a paddock flies one OR the other (see
  // EXCLUSIVE_GROUPS), priced the same so the pick is purely a matter of taste.
  { id: 'boots', name: 'Boots', category: 'wardrobe', price: 250, requiresHorses: 1, attractionBonus: 0.010 },
  { id: 'leg-wraps', name: 'Leg wraps', category: 'wardrobe', price: 900, requiresHorses: 5, attractionBonus: 0.014 },
  { id: 'winter-rug', name: 'Winter rug', category: 'wardrobe', price: 150, requiresHorses: 1, attractionBonus: 0.006 },
  { id: 'saddle-blanket', name: 'Saddle blanket', category: 'wardrobe', price: 2000, requiresHorses: 8, attractionBonus: 0.020 },
  { id: 'ear-flower', name: 'Ear flower', category: 'wardrobe', price: 650, requiresHorses: 3, attractionBonus: 0.012 },
  { id: 'forelock-bow', name: 'Forelock bow', category: 'wardrobe', price: 650, requiresHorses: 3, attractionBonus: 0.012 },

  { id: 'flower-garland', name: 'Flower garland', category: 'decor', price: 500, requiresHorses: 1, shareBonus: 0.05 },
  { id: 'bunting', name: 'Bunting flags', category: 'decor', price: 500, requiresHorses: 1, shareBonus: 0.05 },

  // tier 2 — 3 horses rescued
  { id: 'trough', name: 'Water trough', category: 'decor', price: 900, requiresHorses: 3, shareBonus: 0.05 },

  // tier 3 — 5 horses rescued
  { id: 'flower-buckets', name: 'Flower buckets', category: 'decor', price: 3000, requiresHorses: 5, shareBonus: 0.06 },
  { id: 'flower-barrow', name: 'Flower barrow', category: 'decor', price: 3400, requiresHorses: 5, shareBonus: 0.06 },
  { id: 'butterflies', name: 'Butterflies', category: 'decor', price: 3600, requiresHorses: 5, shareBonus: 0.06 },

  // tier 4 — 8 horses rescued (matches the paddock-paging threshold). The
  // grandest props are deliberately steep: long-haul goals a maxed-out
  // supporter base funds only well into the late game.
  { id: 'hay-bales', name: 'Hay bales', category: 'decor', price: 9000, requiresHorses: 8, shareBonus: 0.08 },
  { id: 'play-balls', name: 'Play balls', category: 'decor', price: 15000, requiresHorses: 8, shareBonus: 0.08 },

  // tier 5 — the companions. Far out of reach until the rescue is thriving:
  // a real end-game money sink and a reward for a long-tended paddock.
  { id: 'muffin', name: 'Muffin the dog', category: 'decor', price: 50000, requiresHorses: 8, shareBonus: 0.12 },
  { id: 'marmalade', name: 'Marmalade the cat', category: 'decor', price: 65000, requiresHorses: 8, shareBonus: 0.12 },
  { id: 'joya', name: 'Joya the dog', category: 'decor', price: 75000, requiresHorses: 8, shareBonus: 0.15 },

  // Gift statues — keepsakes for the horses you've rehomed, earned by collecting
  // postcards (see STATUE_REWARDS in game.js), never bought. gift:true keeps them
  // out of the purchasable shop until awarded; once owned they behave like any
  // decor (place, remove, store). Awarded in order: wooden, stone, flowers, gold.
  { id: 'statue-wooden', name: 'Wooden statue', category: 'decor', price: 0, gift: true, requiresHorses: 0, shareBonus: 0.03 },
  { id: 'statue-stone', name: 'Stone statue', category: 'decor', price: 0, gift: true, requiresHorses: 0, shareBonus: 0.04 },
  { id: 'statue-flowers', name: 'Flower statue', category: 'decor', price: 0, gift: true, requiresHorses: 0, shareBonus: 0.05 },
  { id: 'statue-gold', name: 'Golden statue', category: 'decor', price: 0, gift: true, requiresHorses: 0, shareBonus: 0.06 },
];

/** How many regular paddocks the rescue owns (home paddock always counts).
 *  The magical paddock is separate — see MAGIC_PADDOCK. */
export function paddockCount(state) {
  return Math.max(1, state.paddocksOwned ?? 1);
}

/** How many horses the owned paddocks hold. Magical gift horses live in their
 *  own paddock and don't count against this. */
export function herdCapacity(state) {
  return paddockCount(state) * PADDOCK_CAP;
}

/** Whether every paddock space is taken (rescuing needs a rehoming or a new
 *  paddock first). */
export function herdAtCapacity(state) {
  const regular = state.horses.filter((h) => !isMagicalCoat(h.paletteKey)).length;
  return regular >= herdCapacity(state);
}

/** Price of the next paddock the player could build, or null at the max. The
 *  fourth paddock only exists once the Sanctuary field is built (issue #48). */
export function nextPaddockPrice(state) {
  const next = paddockCount(state) + 1;
  if (next > maxPaddocks(state)) return null;
  return PADDOCK_PRICES[next] ?? null;
}

/** Build the next paddock: 8 more spaces and a fresh spot to decorate. */
export function buyPaddock(state) {
  const price = nextPaddockPrice(state);
  if (price === null || state.coins < price) return { ok: false };
  state.coins -= price;
  state.paddocksOwned = paddockCount(state) + 1;
  return { ok: true, price, count: state.paddocksOwned };
}

export function isUnlocked(item, state) {
  // Gift items don't exist in the shop until they're awarded; once owned (placed
  // or in the stores) they show up so the player can arrange them.
  if (item.gift) return ownedCount(item.id, state) > 0;
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

/** Whether the player may acquire another copy of a one-of-each item (decor):
 *  always for stackable banners, otherwise only if they don't already own one.
 *  Wardrobe is per-horse and doesn't use this -- see canBuyWardrobeFor. */
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
  return decorTargets(state).filter((p) => paddockHasRoomFor(item, state, p));
}

/** Every paddock index decor can target right now: the owned regular paddocks,
 *  plus the magical paddock while a magical horse lives there. */
export function decorTargets(state) {
  const targets = Array.from({ length: paddockCount(state) }, (_, p) => p);
  if (hasMagicalHorse(state)) targets.push(MAGIC_PADDOCK);
  return targets;
}

export function canBuyDecorIn(item, state, paddock) {
  return item.category === 'decor' && !item.gift && isUnlocked(item, state)
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

/** Move every decor item in paddocks that no longer exist back into the
 *  stores, so nothing is orphaned. Handles saves written before paddocks were
 *  owned things (when a phone-sized viewport could split the herd across six
 *  of them). Silent by design. */
export function reclaimOrphanedDecor(state) {
  const live = decorTargets(state);
  for (const p of Object.keys(state.shop.decorByPaddock ?? {})) {
    if (live.includes(Number(p))) continue;
    for (const id of state.shop.decorByPaddock[p]) addToStock(id, state);
    delete state.shop.decorByPaddock[p];
  }
}

// ---- wardrobe: per-horse ----

export function horseHasItem(horse, itemId) {
  return horse.wardrobe.includes(itemId);
}

/** Horses this wardrobe item can still be bought for: they don't already own it,
 *  and aren't wearing its exclusive-group rival. Foals can't be dressed until
 *  they've grown up (the costume anchors are tuned to adult coats). */
export function eligibleHorses(item, state) {
  return state.horses.filter((h) => !h.foal && !horseHasItem(h, item.id) && !horseExclusiveRival(item, h));
}

// Clothing is per-horse: you may buy one of each item for every horse (still
// its ear-flower-OR-forelock-bow choice per horse). Only decor is one-of-each,
// so there's no canOwnMore cap here -- just "this horse doesn't have it yet".
export function canBuyWardrobeFor(item, horse, state) {
  return item.category === 'wardrobe' && isUnlocked(item, state) && isAffordable(item, state)
    && !horse.foal && !horseHasItem(horse, item.id) && !horseExclusiveRival(item, horse);
}

export function buyWardrobe(itemId, horseId, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId && i.category === 'wardrobe');
  const horse = state.horses.find((h) => h.id === horseId);
  if (!item || !horse || !canBuyWardrobeFor(item, horse, state)) return { ok: false, item: null };
  state.coins -= item.price;
  horse.wardrobe.push(item.id);
  return { ok: true, item, horse };
}

/** Dress a horse in a copy from the stores. Free. */
export function placeWardrobe(itemId, horseId, state) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId && i.category === 'wardrobe');
  const horse = state.horses.find((h) => h.id === horseId);
  if (!item || !horse || horse.foal || stockCount(itemId, state) < 1) return { ok: false, item: null };
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
    // Wardrobe is per-horse: buyable whenever a horse still lacks it.
    if (inStore && eligibleHorses(i, state).length > 0) return true;
    return isUnlocked(i, state) && isAffordable(i, state)
      && eligibleHorses(i, state).length > 0;
  });
}
