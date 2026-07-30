// The save layer: loading, healing and never silently losing a player's game.
//
// This is the code that matters most in the project. repair() has been edited
// in 45 commits in this repo's first fortnight, almost always as a side effect
// of building something else (a new field needs backfilling into old saves), and
// when it goes wrong the player's rescue disappears rather than something
// looking wrong on screen. Issues #151 and #152 were both exactly that.
//
// So these tests are less about any one bug and more about one rule: whatever
// state a save turns up in, loading it must never quietly throw progress away.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeStorage, saveWithProgress, muteWarnings } from './helpers.mjs';

const storage = installFakeStorage();
const { initState, SAVE_KEY, SAVE_BACKUP_KEY, SAVE_VERSION } = await import('../js/state.js');

beforeEach(() => storage.clear());

describe('a save that is missing whole sections still loads', () => {
  // repair() backfills fields like `save.stats.foo ??= 0`, which throws if the
  // parent object isn't there. loadSave's catch turns any throw into "start
  // fresh", so a missing container silently cost the player everything (#151).
  for (const missing of ['stats', 'milestones', 'shop']) {
    test(`missing "${missing}"`, () => {
      const save = saveWithProgress();
      delete save[missing];
      storage.set(SAVE_KEY, save);

      const loaded = initState();

      // Whatever lived inside the deleted section is genuinely unrecoverable,
      // and repair() makes a sensible guess for it. What must never happen is
      // the rest of the save going with it.
      assert.equal(loaded.coins, 4321, 'coins survived');
      assert.equal(loaded.supporters, 288, 'supporters survived');
      assert.equal(loaded.horses.length, 2, 'the herd survived');
      assert.equal(loaded.horses[1].name, 'Luna', 'horses kept their identity');
    });
  }

  test('a missing "stats" is rebuilt from what is left, not invented', () => {
    // horsesRescued lived inside stats, so it cannot be recovered. Falling back
    // to the herd size is the honest guess; falling back to 1 would tell a
    // 42-rescue player they had never rescued anyone.
    const save = saveWithProgress();
    delete save.stats;
    storage.set(SAVE_KEY, save);

    const loaded = initState();

    assert.equal(loaded.stats.horsesRescued, 2, 'rebuilt from the surviving herd');
  });

  test('missing all of them at once', () => {
    const save = saveWithProgress();
    delete save.stats; delete save.milestones; delete save.shop;
    storage.set(SAVE_KEY, save);

    const loaded = initState();

    assert.equal(loaded.coins, 4321);
    assert.equal(loaded.horses.length, 2);
  });

  test('a save with nothing but horses', () => {
    storage.set(SAVE_KEY, { version: SAVE_VERSION, horses: [{ id: 'a', name: 'Solo', paletteKey: 'bay', wellbeing: 50 }] });

    const loaded = initState();

    assert.equal(loaded.horses.length, 1);
    assert.equal(loaded.horses[0].name, 'Solo');
  });
});

describe('a save from a version this build does not know', () => {
  // migrate() used to return null, and loadSave turns null into "start fresh".
  // So bumping SAVE_VERSION without also writing a migration would have wiped
  // every existing save at once, silently (#152).
  test('keeps the player\'s progress rather than discarding it', () => {
    storage.set(SAVE_KEY, saveWithProgress({ version: 999 }));

    const loaded = initState();

    assert.equal(loaded.coins, 4321, 'coins survived an unknown version');
    assert.equal(loaded.stats.horsesRescued, 42);
    assert.equal(loaded.horses.length, 2);
  });

  test('and still gets the usual backfill applied', () => {
    storage.set(SAVE_KEY, saveWithProgress({ version: 999 }));

    const loaded = initState();

    assert.ok(Array.isArray(loaded.milestones.statuesGiven), 'newer fields were backfilled');
    assert.equal(typeof loaded.stats.farrierVisits, 'number');
  });
});

describe('a save that genuinely cannot be read', () => {
  test('starts fresh but keeps the original bytes for recovery', () => {
    const mute = muteWarnings();
    storage.set(SAVE_KEY, '{ this is not json');

    const loaded = initState();
    mute.restore();

    assert.equal(loaded.horses.length, 1, 'fell back to a fresh game');
    assert.equal(storage.get(SAVE_BACKUP_KEY), '{ this is not json',
      'the unreadable save was preserved verbatim');
  });

  test('says so rather than failing silently', () => {
    const mute = muteWarnings();
    storage.set(SAVE_KEY, '{ this is not json');
    initState();
    mute.restore();

    assert.ok(mute.captured.some((m) => m.includes(SAVE_BACKUP_KEY)),
      'the warning tells you where the save went');
  });

  test('still starts fresh if the backup itself cannot be written', () => {
    const mute = muteWarnings();
    storage.set(SAVE_KEY, '{ this is not json');
    storage.failWrites(true);

    const loaded = initState();

    storage.failWrites(false);
    mute.restore();
    assert.equal(loaded.horses.length, 1, 'a failed backup must not break booting');
  });
});

describe('the ordinary paths are undisturbed', () => {
  test('a current-version save loads exactly as written', () => {
    storage.set(SAVE_KEY, saveWithProgress());

    const loaded = initState();

    assert.equal(loaded.coins, 4321);
    assert.equal(loaded.supporters, 288);
    assert.equal(loaded.stats.horsesRehomed, 17);
    assert.equal(loaded.paddocksOwned, 2);
  });

  test('a healthy save writes no backup', () => {
    storage.set(SAVE_KEY, saveWithProgress());
    initState();
    assert.equal(storage.has(SAVE_BACKUP_KEY), false,
      'the backup key is for failures only, not every load');
  });

  test('no save at all gives a fresh game with the starter horse', () => {
    const loaded = initState();
    assert.equal(loaded.horses.length, 1);
    assert.equal(loaded.horses[0].name, 'Biscuit');
    assert.equal(loaded.coins, 0);
  });

  test('reset discards the save on purpose', () => {
    storage.set(SAVE_KEY, saveWithProgress());
    const loaded = initState({ reset: true });
    assert.equal(loaded.coins, 0, 'reset is the one time losing the save is correct');
  });

  test('storage being unreadable degrades to a local game', () => {
    // Private mode, or storage switched off. Not a corrupt save: there is
    // nothing to back up and nothing is wrong, so it should just play on.
    const mute = muteWarnings();
    storage.failReads(true);

    const loaded = initState();

    storage.failReads(false);
    mute.restore();
    assert.equal(loaded.horses.length, 1);
    assert.equal(storage.has(SAVE_BACKUP_KEY), false, 'nothing to back up, so no backup');
  });
});

describe('healing a save is repeatable', () => {
  // repair() runs on every single load, and it carries one-way migrations
  // (the scarf became a winter rug, decor moved per-paddock, duplicates get
  // reclaimed into the stores). If any of those are not idempotent they would
  // keep firing, quietly mutating the save a little more each time the player
  // opens the game.
  test('loading twice gives the same save as loading once', () => {
    storage.set(SAVE_KEY, saveWithProgress());

    const once = structuredClone(initState());
    storage.set(SAVE_KEY, once);
    const twice = initState();

    assert.deepEqual(twice, once, 'a second load changed nothing');
  });

  test('holds for a save carrying retired items too', () => {
    // A scarf and an apple barrel were both retired and are converted on load.
    // Converting a converted save must be a no-op.
    const save = saveWithProgress();
    save.horses[0].wardrobe = ['scarf'];
    save.shop.decorByPaddock = { 0: ['apple-barrel', 'butterflies'] };
    storage.set(SAVE_KEY, save);

    const once = structuredClone(initState());
    storage.set(SAVE_KEY, once);
    const twice = initState();

    assert.deepEqual(twice, once, 'the retired-item conversions ran once, not twice');
  });
});
