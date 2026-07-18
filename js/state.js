// state.js — single source of truth for everything the game knows,
// plus localStorage persistence.

import { SHOP_ITEMS } from './shop.js';

export const SAVE_KEY = 'horsing-around:save';
export const SAVE_VERSION = 1;

const WARDROBE_IDS = new Set(SHOP_ITEMS.filter((i) => i.category === 'wardrobe').map((i) => i.id));

// Live game state. Call initState() before using it.
export let gameState = null;

/**
 * Horse factory. Every horse in gameState.horses has this shape.
 */
export function createHorse({
  id,
  name,
  paletteKey = 'chestnut',
  wellbeing = 10,      // 0–100; drives colours, posture, supporter appeal
  rescueOrder,         // 1 = Biscuit, 2 = second rescue, ...
  trait = null,        // personality trait id, assigned from phase 2 on
  real = null,         // null for fictional horses; for real ARCH horses:
                       // { photo, story, donateUrl } — rendered as a polaroid card
  wardrobe = [],       // shop.js wardrobe item ids bought for this horse specifically
  facing = Math.random() < 0.5 ? 'left' : 'right', // fixed at arrival, purely visual
  sizeJitter = 0.92 + Math.random() * 0.16,        // 0.92–1.08, breaks up row uniformity
}) {
  return {
    id,
    name,
    paletteKey,
    wellbeing,
    rescueOrder,
    trait,
    cosmetics: [],     // cosmetic ids, e.g. 'halter-red', 'flower' (phase 3)
    sponsor: null,     // supporter name once the horse reaches thriving; permanent income
    real,
    wardrobe,
    facing,
    sizeJitter,
    arrivedAt: Date.now(),
  };
}

export function defaultState() {
  return {
    version: SAVE_VERSION,

    // resources
    coins: 0,            // € donated by supporters; spent on hay/vet/rescues.
    supporters: 0,       // people following the rescue; generate passive income later.

    horses: [
      createHorse({
        id: 'biscuit',
        name: 'Biscuit',
        paletteKey: 'bay',
        wellbeing: 12,   // scruffy arrival — clearly in need of care
        rescueOrder: 1,
      }),
    ],

    // upgrade id -> count owned. Both tracks (care capacity + support) share
    // this map; the upgrade definitions themselves live in game data, not state.
    upgrades: {},

    // permanent wardrobe/decor purchases; item definitions live in shop.js
    shop: {
      owned: [],
    },

    // one-way feature gates flipped by progression
    unlocks: {
      moneyUI: false,    // flips when Biscuit first reaches "content"
      rescue: false,     // flips with the loneliness beat in phase 2
      upgrades: false,   // flips entering phase 3
      cosmetics: false,
    },

    // story beats that must fire exactly once
    milestones: {
      firstDonation: false,
      firstSponsorship: false,  // once true, sponsorship toasts go terse
      donateBannerShown: false, // real-donation banner fired its one story moment
      introToastShown: false,   // the "tap Biscuit" nudge new players get once
      realHorsesTriggered: [],  // rescueOrder values whose ARCH horse card has appeared
    },

    stats: {
      clicks: 0,
      totalDonated: 0,
      horsesRescued: 1,  // Biscuit counts
    },

    savedAt: Date.now(),
  };
}

/**
 * Load save (or fall back to a fresh state) and set the live gameState.
 * Pass { reset: true } to discard any existing save.
 */
export function initState({ reset = false } = {}) {
  if (reset) localStorage.removeItem(SAVE_KEY);
  gameState = loadSave() ?? defaultState();
  return gameState;
}

/**
 * Replace gameState's contents with a cloud save, in place — other modules
 * hold onto the same gameState object, so this must mutate it rather than
 * rebind the export, or they'd keep seeing the stale one.
 */
export function adoptCloudState(cloudState) {
  for (const key of Object.keys(gameState)) delete gameState[key];
  Object.assign(gameState, cloudState);
  return gameState;
}

export function save() {
  if (!gameState) return;
  gameState.savedAt = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(gameState));
  } catch (err) {
    // localStorage can be unavailable (private mode, quota) — the game just
    // won't persist, which is fine.
    console.warn('Could not save game:', err);
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== SAVE_VERSION) return migrate(parsed);
    return repair(parsed);
  } catch (err) {
    console.warn('Could not load save, starting fresh:', err);
    return null;
  }
}

/**
 * Heal known data problems in existing saves: duplicate horse ids (an old
 * build derived ids from Date.now(), which collides for rescues in the same
 * millisecond), and missing fields added after a save was first created.
 */
function repair(save) {
  const seen = new Set();
  for (const horse of save.horses ?? []) {
    while (seen.has(horse.id)) {
      horse.id = `${horse.id}-r${Math.random().toString(36).slice(2, 6)}`;
    }
    seen.add(horse.id);
    horse.wardrobe ??= [];
    horse.facing ??= Math.random() < 0.5 ? 'left' : 'right';
    horse.sizeJitter ??= 0.92 + Math.random() * 0.16;
  }
  save.shop ??= { owned: [] };
  // Existing saves belong to players who've already figured out how to
  // play -- only a brand-new defaultState() should show the intro toast.
  save.milestones.introToastShown ??= true;

  // Wardrobe used to be a global purchase that dressed every horse at once.
  // Anyone who bought one under that system keeps it -- migrate those ids
  // onto every horse that already exists, then drop them from the global list.
  const staleWardrobeIds = save.shop.owned.filter((id) => WARDROBE_IDS.has(id));
  if (staleWardrobeIds.length) {
    for (const horse of save.horses ?? []) {
      for (const id of staleWardrobeIds) {
        if (!horse.wardrobe.includes(id)) horse.wardrobe.push(id);
      }
    }
    save.shop.owned = save.shop.owned.filter((id) => !WARDROBE_IDS.has(id));
  }

  return save;
}

function migrate(oldSave) {
  // No older versions exist yet; when the shape changes, upgrade old saves
  // here instead of discarding them.
  return null;
}
