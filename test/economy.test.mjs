// The economy.
//
// game.js is the most-edited file in the project (59 commits and counting), it
// is pure calculation with no DOM, and a mistake here is felt by every player
// at once: money that mints itself, a rescue cost that stops escalating, an
// offline payout that quietly pays for a week away.
//
// These tests deliberately assert *relationships and bounds*, never specific
// numbers. The economy is meant to be re-tuned, often. A test that says
// "a rescue costs 25" would fail every time you tuned it and teach you to
// ignore the suite. A test that says "each rescue costs more than the last"
// stays true through any amount of tuning, and only fails when something is
// actually broken.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeStorage, muteWarnings } from './helpers.mjs';

const storage = installFakeStorage();
const { initState, gameState } = await import('../js/state.js');
const {
  rescueCost, rescuePrice, sponsorRatePerHorse, shareCharge, shareValue,
  billFee, foalGrowth, collectOfflineEarnings,
  OFFLINE_MIN_SECONDS, OFFLINE_CAP_SECONDS, DRIFT_FLOOR, WELLBEING_MAX, BILLS,
} = await import('../js/game.js');

/** A fresh game with the money side switched on, since most of the economy is
 *  gated behind it. Returns the live gameState. */
function startedGame() {
  storage.clear();
  const s = initState({ reset: true });
  s.unlocks.moneyUI = true;
  return s;
}

const horse = (over = {}) => ({
  id: `h${Math.random()}`, name: 'Test', paletteKey: 'bay',
  wellbeing: 100, wardrobe: [], sponsor: null, foal: false, ...over,
});

beforeEach(() => storage.clear());

describe('the cost of rescuing', () => {
  test('goes up with every horse already in the herd', () => {
    const s = startedGame();
    const costs = [];
    for (let n = 1; n <= 6; n++) {
      s.horses = Array.from({ length: n }, () => horse());
      costs.push(rescueCost(s));
    }
    for (let i = 1; i < costs.length; i++) {
      assert.ok(costs[i] > costs[i - 1],
        `rescue ${i + 1} (${costs[i]}) must cost more than rescue ${i} (${costs[i - 1]})`);
    }
  });

  test('ignores magical gift horses, which were never rescued', () => {
    const s = startedGame();
    s.horses = [horse(), horse()];
    const before = rescueCost(s);
    s.horses.push(horse({ paletteKey: 'unicorn' }));
    assert.equal(rescueCost(s), before, 'a gift horse must not push the price up');
  });

  test('the price paid is never more than the base cost', () => {
    // Facilities discount rescues. A discount that somehow added would be a
    // silent tax on the player.
    const s = startedGame();
    s.horses = [horse(), horse(), horse()];
    assert.ok(rescuePrice(s) <= rescueCost(s));
    assert.ok(rescuePrice(s) > 0, 'and it is never free');
  });
});

describe('sponsorship income', () => {
  test('grows as the rescue grows', () => {
    const s = startedGame();
    s.horses = [horse()];
    const solo = sponsorRatePerHorse(s);
    s.horses = Array.from({ length: 8 }, () => horse());
    assert.ok(sponsorRatePerHorse(s) > solo,
      'a bigger rescue is a bigger story, so sponsors give more');
  });

  test('is never negative, even with an empty paddock', () => {
    const s = startedGame();
    s.horses = [];
    assert.ok(sponsorRatePerHorse(s) >= 0);
  });
});

describe('the share meter', () => {
  test('stays between empty and full', () => {
    const s = startedGame();
    const now = Date.now();
    for (const lastShared of [0, now, now - 1000, now - 10_000_000, now + 5000]) {
      s.lastSharedAt = lastShared;
      const charge = shareCharge(s, now);
      assert.ok(charge >= 0 && charge <= 1, `charge ${charge} out of range`);
    }
  });

  test('refills over time rather than jumping', () => {
    const s = startedGame();
    const now = Date.now();
    s.lastSharedAt = now;
    const immediately = shareCharge(s, now);
    const later = shareCharge(s, now + 5000);
    const muchLater = shareCharge(s, now + 60_000);
    assert.ok(later > immediately, 'it recharges');
    assert.ok(muchLater >= later, 'and never goes backwards');
    assert.equal(muchLater, 1, 'and eventually fills');
  });

  test('a never-shared save reads as a full meter', () => {
    // 0 means "never shared", which should feel like a fresh full charge
    // rather than a player starting the game on a cooldown.
    const s = startedGame();
    s.lastSharedAt = 0;
    assert.equal(shareCharge(s, Date.now()), 1);
  });

  test('a share is worth something even with no supporters', () => {
    const s = startedGame();
    s.supporters = 0;
    assert.ok(shareValue(s) > 0);
  });
});

describe('bills', () => {
  test('never drop below their own floor, however small the rescue', () => {
    const s = startedGame();
    s.horses = [horse()];
    for (const [kind, bill] of Object.entries(BILLS)) {
      assert.ok(billFee(kind, s) >= bill.min * 0.5,
        `${kind} fee collapsed below anything sensible`);
      assert.ok(billFee(kind, s) > 0, `${kind} must cost something`);
    }
  });

  test('scale up with the rescue', () => {
    const s = startedGame();
    s.horses = [horse()];
    const small = billFee('hay', s);
    s.horses = Array.from({ length: 10 }, () => horse());
    assert.ok(billFee('hay', s) > small, 'a bigger herd eats more hay');
  });
});

describe('foals growing up', () => {
  test('growth runs from 0 to 1 and never outside it', () => {
    const s = startedGame();
    const foal = horse({ foal: true, bornAtPlay: 1000 });
    for (const playSeconds of [0, 500, 1000, 1200, 99_999_999]) {
      s.stats.playSeconds = playSeconds;
      const g = foalGrowth(foal, s);
      assert.ok(g >= 0 && g <= 1, `growth ${g} out of range at ${playSeconds}s`);
    }
  });

  test('a grown horse is always fully grown', () => {
    const s = startedGame();
    assert.equal(foalGrowth(horse({ foal: false }), s), 1);
  });
});

describe('earnings while the game was closed', () => {
  test('a quick tab switch earns nothing and shows nothing', () => {
    const s = startedGame();
    s.supporters = 100;
    const now = Date.now();
    const result = collectOfflineEarnings(now - 60_000, now); // one minute
    assert.equal(result, null, 'no welcome-back popup for stepping away briefly');
  });

  test('nothing at all is credited before the money side is unlocked', () => {
    const s = startedGame();
    s.unlocks.moneyUI = false;
    s.supporters = 500;
    const now = Date.now();
    const before = s.coins;
    assert.equal(collectOfflineEarnings(now - 10 * 3600_000, now), null);
    assert.equal(s.coins, before, 'and no money appeared');
  });

  test('a longer trip earns more than a shorter one', () => {
    const now = Date.now();
    const earn = (hours) => {
      const s = startedGame();
      s.unlocks.moneyUI = true;
      s.supporters = 200;
      s.horses = [horse({ sponsor: 'María' })];
      return collectOfflineEarnings(now - hours * 3600_000, now)?.income ?? 0;
    };
    assert.ok(earn(2) > earn(1), 'two hours away beats one');
  });

  test('but stops paying past the cap, so a week away is not a jackpot', () => {
    const now = Date.now();
    const earn = (seconds) => {
      const s = startedGame();
      s.unlocks.moneyUI = true;
      s.supporters = 200;
      s.horses = [horse({ sponsor: 'María' })];
      return collectOfflineEarnings(now - seconds * 1000, now)?.income ?? 0;
    };
    const atCap = earn(OFFLINE_CAP_SECONDS);
    const wayPastCap = earn(OFFLINE_CAP_SECONDS * 42);
    assert.ok(Math.abs(wayPastCap - atCap) < 0.01,
      'time beyond the cap must not keep paying');
  });

  test('never pays out negative money', () => {
    const now = Date.now();
    const s = startedGame();
    s.supporters = 0;
    s.horses = [horse()];
    const result = collectOfflineEarnings(now - 10 * 3600_000, now);
    if (result) assert.ok(result.income >= 0);
  });

  test('the herd eases down but is never left miserable', () => {
    // Drift is meant to be a nudge to come back, never a punishment for having
    // a life. It must not take a horse below the floor, and must not push one
    // that was already at or below it any lower.
    const now = Date.now();
    const s = startedGame();
    s.supporters = 50;
    s.horses = [
      horse({ wellbeing: WELLBEING_MAX }),
      horse({ wellbeing: DRIFT_FLOOR }),
      horse({ wellbeing: DRIFT_FLOOR - 10 }),
    ];
    const before = s.horses.map((h) => h.wellbeing);

    collectOfflineEarnings(now - OFFLINE_CAP_SECONDS * 10 * 1000, now); // ages away

    s.horses.forEach((h, i) => {
      assert.ok(h.wellbeing >= DRIFT_FLOOR || h.wellbeing >= before[i],
        `horse ${i} drifted below the floor (${h.wellbeing})`);
      assert.ok(h.wellbeing <= before[i] + 0.001, `horse ${i} gained wellbeing while away`);
    });
  });

  test('magical horses are above such earthly concerns', () => {
    const now = Date.now();
    const s = startedGame();
    s.supporters = 50;
    s.horses = [horse({ paletteKey: 'unicorn', wellbeing: WELLBEING_MAX })];

    collectOfflineEarnings(now - OFFLINE_CAP_SECONDS * 1000, now);

    assert.equal(s.horses[0].wellbeing, WELLBEING_MAX, 'the unicorn never droops');
  });
});
