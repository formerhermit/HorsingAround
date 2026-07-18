// state.js — single source of truth for everything the game knows,
// plus localStorage persistence.

export const SAVE_KEY = 'horsing-around:save';
export const SAVE_VERSION = 1;

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
        paletteKey: 'chestnut',
        wellbeing: 12,   // scruffy arrival — clearly in need of care
        rescueOrder: 1,
      }),
    ],

    // upgrade id -> count owned. Both tracks (care capacity + support) share
    // this map; the upgrade definitions themselves live in game data, not state.
    upgrades: {},

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
 * Heal known data problems in existing saves. Currently: duplicate horse ids
 * (an old build derived ids from Date.now(), which collides for rescues in
 * the same millisecond and cross-wires clicks and card updates).
 */
function repair(save) {
  const seen = new Set();
  for (const horse of save.horses ?? []) {
    while (seen.has(horse.id)) {
      horse.id = `${horse.id}-r${Math.random().toString(36).slice(2, 6)}`;
    }
    seen.add(horse.id);
  }
  return save;
}

function migrate(oldSave) {
  // No older versions exist yet; when the shape changes, upgrade old saves
  // here instead of discarding them.
  return null;
}
