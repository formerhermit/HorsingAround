// Shared test scaffolding.
//
// The game modules are plain ES modules with no DOM access (game.js says so at
// the top), so they import straight into Node. The one browser thing the save
// layer needs is localStorage, faked here.

/** An in-memory localStorage. `failReads` makes getItem throw, standing in for
 *  private mode or storage being disabled. */
export function installFakeStorage() {
  const store = new Map();
  const state = { failReads: false, failWrites: false };
  globalThis.localStorage = {
    getItem(k) {
      if (state.failReads) throw new DOMException('storage disabled');
      return store.get(k) ?? null;
    },
    setItem(k, v) {
      if (state.failWrites) throw new DOMException('quota exceeded');
      store.set(k, String(v));
    },
    removeItem(k) { store.delete(k); },
  };
  return {
    store,
    set: (k, v) => store.set(k, typeof v === 'string' ? v : JSON.stringify(v)),
    get: (k) => store.get(k) ?? null,
    has: (k) => store.has(k),
    clear: () => store.clear(),
    failReads: (on = true) => { state.failReads = on; },
    failWrites: (on = true) => { state.failWrites = on; },
  };
}

/** A save with real progress in it. The point of most of these tests is that
 *  nothing here is ever silently lost, so give it plenty to lose. */
export function saveWithProgress(overrides = {}) {
  return {
    version: 1,
    coins: 4321,
    supporters: 288,
    horses: [
      { id: 'biscuit', name: 'Biscuit', paletteKey: 'bay', wellbeing: 97, rescueOrder: 1, wardrobe: [] },
      { id: 'luna', name: 'Luna', paletteKey: 'zebra', wellbeing: 62, rescueOrder: 2, wardrobe: [] },
    ],
    stats: {
      clicks: 9000, horsesRescued: 42, horsesRehomed: 17,
      totalDonated: 7777, playSeconds: 36000,
    },
    milestones: {},
    shop: { decorByPaddock: { 0: ['flower-barrow'] }, stock: {} },
    collectedCoats: ['bay', 'grey', 'zebra'],
    paddocksOwned: 2,
    savedAt: Date.now(),
    ...overrides,
  };
}

/** Silence the console.warn calls the save layer makes on purpose (a corrupt
 *  save logs before starting fresh), so a passing run stays readable. Returns
 *  the captured messages, for when a test wants to assert one happened. */
export function muteWarnings() {
  const original = console.warn;
  const captured = [];
  console.warn = (...args) => { captured.push(args.join(' ')); };
  return { captured, restore: () => { console.warn = original; } };
}
