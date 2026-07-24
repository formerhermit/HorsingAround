// state.js — single source of truth for everything the game knows,
// plus localStorage persistence.

import { SHOP_ITEMS, STACKABLE_IDS, PADDOCK_CAP, reclaimOrphanedDecor } from './shop.js';
import { isMagicalCoat } from './horse.js';
import { isFearTrait, FEAR_OVERCOME_AT } from './traits.js';

export const SAVE_KEY = 'horsing-around:save';
export const SAVE_VERSION = 1;

// Counts at which a celebratory reward popup fires (a cash bonus into the
// rescue fund). Defined here -- the "lower" module -- so both state.js (save
// migration) and game.js (the live checks) can share them without a cycle.
export const RESCUE_MILESTONES = [5, 25, 50, 100, 150, 250, 500, 750, 1000, 1500];
export const REHOME_MILESTONES = [5, 10, 25, 50, 100, 150, 250, 500, 1000];
export const DONATE_MILESTONE = 10; // rescues -> the confetti / "donate to ARCH" popup
// Supporter counts that earn a celebratory toast (no cash) once per-arrival
// follow toasts have tapered off. Just a "look how you've grown" beat.
export const SUPPORTER_MILESTONES = [50, 100, 250, 500, 1000, 2500, 5000];

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
  foal = false,          // a foal born at the rescue: renders small and grows up (game.js)
  bornAtPlay = null,     // stats.playSeconds at birth; drives the growth clock
  damName = null,        // the mare it was born to, for the story beats
  bornHere = false,      // stays true after growing up: marks a home-raised horse
  foalTraitRevealed = false, // whether the mid-growth personality beat has fired
  ageYears = 3 + Math.floor(Math.random() * 18), // a made-up but fixed age (3–20), shown on the residents card
}) {
  return {
    id,
    name,
    paletteKey,
    wellbeing,
    rescueOrder,
    trait,
    fearOvercome: false, // fear-trait horses: whether the breakthrough beat has fired
    cosmetics: [],     // cosmetic ids, e.g. 'halter-red', 'flower' (phase 3)
    sponsor: null,     // supporter name once the horse reaches thriving; permanent income
    real,
    wardrobe,
    facing,
    sizeJitter,
    foal,
    bornAtPlay,
    damName,
    bornHere,
    foalTraitRevealed,
    ageYears,
    arrivedAt: Date.now(),
    lastCaredAt: Date.now(), // last care tap; drives the gentle-upkeep drift (game.js)
  };
}

export function defaultState() {
  return {
    version: SAVE_VERSION,

    // resources
    coins: 0,            // € donated by supporters; spent on hay/vet/rescues.
    supporters: 0,       // people following the rescue; generate passive income later.
    lastSharedAt: 0,     // when "share an update" was last pressed; drives its charge meter.

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

    // Regular paddocks the rescue owns, 8 horse spaces each. More can be
    // built (see shop.js PADDOCK_PRICES); the magical paddock is separate,
    // free, and implied by having a magical horse.
    paddocksOwned: 1,

    // permanent decor purchases, keyed by paddock slot index (0 = home).
    // Wardrobe lives on each horse; item definitions live in shop.js.
    shop: {
      decorByPaddock: {},
      // Owned-but-unplaced items, by id -> count. Buying, then removing from a
      // horse/paddock, parks an item here to re-use rather than re-buy.
      stock: {},
    },

    // Keepsake postcards from rehomed horses. `pendingPostcards` holds ones
    // scheduled but not yet due (each carries a dueAt); they move to
    // `postcards` when delivered. Scheduling + delivery live in game.js.
    postcards: [],
    pendingPostcards: [],

    // A paid-for Sur article at the printers: { fee, dueAt } or null. Persisted
    // so closing the game never eats the story (see game.js, issue #64).
    pendingArticle: null,

    // Collection book: coat ids ever collected (Biscuit is a bay from the
    // start), and how many were collected last time the book was opened (drives
    // the "new" dot on the button).
    collectedCoats: ['bay'],
    collectionSeen: 1,

    // Pride-only badges (issue #65): the ids earned so far, and how many had
    // been earned last time the Badges tab was opened (drives the "new" dot).
    // The catalog and earn logic live in achievements.js.
    achievements: [],
    achievementsSeen: 0,

    // "Grow the rescue" facility upgrades bought so far (issue #48): a one-way
    // ladder. The catalog and effects live in facilities.js.
    facilities: [],

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
      firstWantRewarded: false, // the first want's big one-off early-game payout (game.js)
      firstSponsorship: false,  // once true, sponsorship toasts go terse
      driftIntroShown: false,   // the one-time "horses love routine" top-up explainer
      utilidadShown: false,     // Utilidad Pública recognition earned (permanent +10% supporter donations)
      championMonthsCelebrated: [], // leaderboard months whose winner's popup has fired
      introToastShown: false,   // the "tap Biscuit" nudge new players get once
      hasSharedUpdate: false,   // resolves the "share to raise money" onboarding popup
      hasRescuedAgain: false,   // resolves the "rescue another horse" onboarding popup
      shopIntroDone: false,     // resolves the "shop is open" onboarding popup
      realHorsesTriggered: [],  // rescueOrder values whose ARCH horse card has appeared
      rescueRewardsGiven: [],   // rescue-count milestones already rewarded
      rehomeRewardsGiven: [],   // rehome-count milestones already rewarded
      donateMilestoneShown: false, // the 10-rescue confetti/donate popup fired
      donateOptOut: false,      // player chose "Don't ask again" on the donate popup
      donatedForReal: false,    // honour-based: pressed a Donate-to-ARCH button (badge #65)
      sharedForReal: false,     // honour-based: used a "tell a friend" share (badge #65)
      firstPostcardShown: false, // the first postcard's toast explains the album
      supporterMilestonesShown: [], // supporter-count milestones already toasted
      collectionIntroDone: false, // the "check your collection" nudge fired once
      leftBehindShown: false,   // the one-time "a rehomed horse left clothes in your stores" nudge
      statuesGiven: [],         // postcard-milestone statue ids already awarded
      leaderboardNudgeQueued: false, // a rescue milestone armed the leaderboard nudge...
      leaderboardNudgeShown: false,  // ...and it has been shown (or the board was found)
      restoreWhisperRetired: false,  // the "played before? restore your game" header hint
    },

    leaderboard: {
      optedIn: false, // joined the public monthly board
      name: null,     // generated stable name shown on it
      month: null,    // 'YYYY-MM' (Europe/Madrid) the counter below belongs to
      rescues: 0,     // rescues made in that month
    },

    stats: {
      clicks: 0,
      totalDonated: 0,
      horsesRescued: 1,  // Biscuit counts
      horsesRehomed: 0,  // horses sent to a forever home
      traitsRevealed: 0, // how many personality-reveal beats have played
      traitsSeen: [],    // distinct trait texts ever met (drives the "all 29" badge)
      farrierVisits: 0,  // farrier bills paid (badge #65)
      wormings: 0,       // vet worming bills paid
      billKindsPaid: [], // distinct bill kinds ever paid
      fearsOvercome: 0,  // fear-breakthrough beats that have fired
      visitorsDaysRun: 0,// Visitors Days held
      reunionsHeld: 0,   // Reunion Days held
      foalsBorn: 0,      // foals welcomed into the rescue
      foalsGrown: 0,     // foals that have grown up into adult horses
      homegrownRehomed: 0, // home-raised horses sent to a forever home (badge)
      playSeconds: 0,    // active play time, summed from the sim tick's clamped dt
      startedAt: Date.now(), // when this rescue began (for "caring since ...")
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
  // Heal the cloud save exactly as loadSave heals a local one, so fields added
  // since it was written (the item stores, statue milestones, ...) are backfilled
  // rather than left missing -- otherwise cloud players hit code that assumes them.
  let healed = cloudState;
  try {
    healed = (cloudState.version !== SAVE_VERSION ? migrate(cloudState) : repair(cloudState)) ?? cloudState;
  } catch (err) {
    console.warn('Could not heal cloud save, adopting as-is:', err);
  }
  for (const key of Object.keys(gameState)) delete gameState[key];
  Object.assign(gameState, healed);
  return gameState;
}

// Set by the privacy popup's "delete everything" flow: once the save has been
// wiped, nothing may write it back -- the unload/visibility handlers and the
// autosave interval all funnel through save(), so one switch covers them all.
let savingDisabled = false;
export function disableSaving() {
  savingDisabled = true;
}

export function save() {
  if (!gameState || savingDisabled) return;
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
    // Upkeep drift is new: date existing horses' care from this load, so an
    // updated save gets its grace period rather than an instant ease-down.
    horse.lastCaredAt ??= Date.now();
    // The fear-breakthrough arc is new: a fear horse already recovered past
    // the threshold did its overcoming off-screen, so mark it quietly rather
    // than greeting a returning player with a flood of retroactive beats.
    horse.fearOvercome ??= isFearTrait(horse.trait) && horse.wellbeing >= FEAR_OVERCOME_AT;
    // Foals are new (issue #48): existing horses were never foals and aren't
    // home-raised. bornAtPlay/damName/foalTraitRevealed only matter to a live
    // foal, but backfill them so nothing reads undefined.
    horse.foal ??= false;
    horse.bornHere ??= false;
    horse.bornAtPlay ??= null;
    horse.damName ??= null;
    horse.foalTraitRevealed ??= false;
    // A made-up but fixed age for the residents card (#89): foals count as under
    // one; everyone else gets a believable 3–20 assigned once, then persisted.
    horse.ageYears ??= horse.foal ? 0 : 3 + Math.floor(Math.random() * 18);
    horse.arrivedAt ??= Date.now();
    // Joya is now reserved for the dog decor item; rename any horse
    if (horse.name === 'Joya') horse.name = 'Billy';
    if (horse.name === 'Pantoja 2' || horse.name === 'Panjota 2') horse.name = 'Binky';
    if (horse.name === 'Lola (Gabbi)') horse.name = 'Gabbi';
  }
  save.shop ??= {};
  save.shop.stock ??= {};
  // The share charge meter is new; 0 means "never shared", i.e. a full charge.
  save.lastSharedAt ??= 0;
  // The gentle-upkeep drift is new; returning players get its explainer too.
  save.milestones.driftIntroShown ??= false;
  // The first-want windfall is new: only a player still on their very first horse
  // should ever see it, so anyone already past the second rescue is marked done.
  save.milestones.firstWantRewarded ??= (save.stats?.horsesRescued ?? 1) > 1;
  // Paddock-life additions: the article chain, the Utilidad Pública beat (a
  // returning player past the mark earns its popup on next tick, on purpose),
  // and the once-per-month champion celebration.
  save.pendingArticle ??= null;
  save.milestones.utilidadShown ??= false;
  save.milestones.championMonthsCelebrated ??= [];

  // Pride-only badges (issue #65). New stat counters can't be recovered from
  // history (we never counted farrier visits before), so they start at 0 and
  // accrue from now on; the count-based badges (rescues, income, postcards...)
  // read stats that DO persist, so those unlock retroactively on next check.
  // traitsSeen seeds from the current herd's revealed traits — the best we can
  // reconstruct. The one-time silent backfill of already-earned badges happens
  // in main.js (grant + mark seen, no toast flood).
  save.achievements ??= [];
  save.achievementsSeen ??= 0;
  save.facilities ??= []; // "grow the rescue" upgrades (issue #48)
  save.milestones.donatedForReal ??= false;
  save.milestones.sharedForReal ??= false;
  save.stats.farrierVisits ??= 0;
  save.stats.wormings ??= 0;
  save.stats.billKindsPaid ??= [];
  save.stats.fearsOvercome ??= (save.horses ?? []).filter((h) => h.fearOvercome).length;
  save.stats.visitorsDaysRun ??= 0;
  save.stats.reunionsHeld ??= 0;
  save.stats.foalsBorn ??= 0;
  save.stats.foalsGrown ??= 0;
  save.stats.homegrownRehomed ??= 0;
  save.stats.traitsSeen ??= [...new Set((save.horses ?? []).map((h) => h.trait).filter(Boolean))];
  // The monthly leaderboard is opt-in and new; existing saves start off it.
  // Unlike the other backfilled nudges, the leaderboard one stays *on* for
  // returning players -- the feature is new to them too, so their next rescue
  // milestone should mention it.
  save.leaderboard ??= { optedIn: false, name: null, month: null, rescues: 0 };
  save.milestones.leaderboardNudgeQueued ??= false;
  save.milestones.leaderboardNudgeShown ??= false;
  // The restore whisper is only for a brand-new save on a fresh device -- an
  // existing save already has its data, so returning players never see it.
  save.milestones.restoreWhisperRetired ??= true;
  // Existing saves belong to players who've already figured out how to
  // play -- only a brand-new defaultState() should get the onboarding nudges.
  save.milestones.introToastShown ??= true;
  save.milestones.hasSharedUpdate ??= true;
  save.milestones.hasRescuedAgain ??= true;
  save.milestones.shopIntroDone ??= true;
  // The stores are new; a returning player shouldn't get the one-time
  // "clothes left behind" nudge retroactively on their next rehoming.
  save.milestones.leftBehindShown ??= true;
  // Statue keepsakes are new; an empty list lets a returning player earn any
  // their postcard count already qualifies for on next load (a nice catch-up).
  save.milestones.statuesGiven ??= [];

  // Reward/donate milestones are new; backfill any the existing save has already
  // passed so a returning player isn't hit with a flood of retroactive popups.
  save.stats ??= {};
  save.stats.horsesRescued ??= save.horses?.length ?? 1;
  save.stats.horsesRehomed ??= 0;
  // Backfill from horses that already show a trait, so returning players don't
  // replay the long-form intro.
  save.stats.traitsRevealed ??= (save.horses ?? []).filter((h) => h.trait).length;
  // Playtime tracking is new. Start the counter at 0 (we can't recover past
  // hours), and date the rescue's start from the oldest horse still around,
  // falling back to when the save was last written.
  save.stats.playSeconds ??= 0;
  save.stats.startedAt ??= Math.min(
    ...(save.horses ?? []).map((h) => h.arrivedAt ?? Infinity),
    save.savedAt ?? Date.now(),
  );
  save.milestones.rescueRewardsGiven ??= RESCUE_MILESTONES.filter((n) => save.stats.horsesRescued >= n);
  save.milestones.rehomeRewardsGiven ??= REHOME_MILESTONES.filter((n) => save.stats.horsesRehomed >= n);
  save.milestones.donateMilestoneShown ??= save.stats.horsesRescued >= DONATE_MILESTONE;
  save.milestones.donateOptOut ??= false;
  // Supporter milestones are new; treat any already passed as shown so a
  // returning player isn't flooded with retroactive "you've grown!" toasts.
  save.milestones.supporterMilestonesShown ??= SUPPORTER_MILESTONES.filter((n) => (save.supporters ?? 0) >= n);

  // Postcards are new; existing saves start with empty collections. A returning
  // player's next rehoming earns their first postcard (and its explanatory toast).
  save.postcards ??= [];
  save.pendingPostcards ??= [];
  save.milestones.firstPostcardShown ??= false;

  // Collection book is new: seed it from the coats currently in the herd (older
  // saves can't recover coats they've since rehomed, they'll re-collect those).
  // A player already past 8 rescues shouldn't get the intro nudge retroactively.
  if (!save.collectedCoats) {
    save.collectedCoats = [...new Set(['bay', ...(save.horses ?? []).map((h) => h.paletteKey)])];
  }
  save.collectionSeen ??= save.collectedCoats.length;
  save.milestones.collectionIntroDone ??= (save.stats.horsesRescued ?? 1) >= 8;

  // The scarf was retired (issue #38: neck placement never sat right across
  // coats); anyone who owned one gets the winter rug that replaced it. Worn
  // scarves become worn rugs unless that horse's back is already taken (the
  // rug and saddle blanket are an either/or), in which case the rug waits in
  // the stores; stored scarves convert in place. Runs before the legacy
  // global-wardrobe migration below so an ancient save's scarf converts too.
  save.shop.owned = save.shop.owned?.map((id) => (id === 'scarf' ? 'winter-rug' : id));
  for (const horse of save.horses ?? []) {
    const i = horse.wardrobe.indexOf('scarf');
    if (i === -1) continue;
    if (horse.wardrobe.includes('saddle-blanket') || horse.wardrobe.includes('winter-rug')) {
      horse.wardrobe.splice(i, 1);
      save.shop.stock['winter-rug'] = (save.shop.stock['winter-rug'] ?? 0) + 1;
    } else {
      horse.wardrobe[i] = 'winter-rug';
    }
  }
  if (save.shop.stock.scarf) {
    save.shop.stock['winter-rug'] = (save.shop.stock['winter-rug'] ?? 0) + save.shop.stock.scarf;
    delete save.shop.stock.scarf;
  }

  // Wardrobe used to be a global purchase that dressed every horse at once.
  // Anyone who bought one under that system keeps it -- migrate those ids
  // onto every horse that already exists, then drop them from the global list.
  const legacyOwned = save.shop.owned ?? [];
  const staleWardrobeIds = legacyOwned.filter((id) => WARDROBE_IDS.has(id));
  if (staleWardrobeIds.length) {
    for (const horse of save.horses ?? []) {
      for (const id of staleWardrobeIds) {
        if (!horse.wardrobe.includes(id)) horse.wardrobe.push(id);
      }
    }
  }

  // Decor used to be a single global list; it now lives per paddock. Anything
  // previously owned moves onto the home paddock (slot 0).
  save.shop.decorByPaddock ??= {};
  if (save.shop.owned) {
    const decor = legacyOwned.filter((id) => !WARDROBE_IDS.has(id));
    if (decor.length) {
      const home = (save.shop.decorByPaddock[0] ??= []);
      for (let id of decor) {
        // Joya (dog) was renamed to Muffin; new Joya is a different dog
        if (id === 'joya') id = 'muffin';
        if (!home.includes(id)) home.push(id);
      }
    }
    delete save.shop.owned;
  }
  // Also rename joya to muffin in existing per-paddock decor
  for (const paddockDecor of Object.values(save.shop.decorByPaddock ?? {})) {
    const idx = paddockDecor.indexOf('joya');
    if (idx >= 0) paddockDecor[idx] = 'muffin';
  }

  // The apple barrel was replaced by the flower barrow; convert any that were
  // bought so those players keep an equivalent decoration rather than losing it.
  for (const paddockDecor of Object.values(save.shop.decorByPaddock ?? {})) {
    const idx = paddockDecor.indexOf('apple-barrel');
    if (idx >= 0) paddockDecor[idx] = 'flower-barrow';
  }

  // "One of each" decor is new. The old model let you buy the same prop for many
  // paddocks; consolidate to keep the first placement and reclaim the rest into
  // the stores. Stackable banners are exempt, and clothing stays per-horse (a
  // scarf on every horse is fine), so this touches decor only. Idempotent -- a
  // healed save has no decor duplicates left to move.
  const seenDecor = new Set();
  for (const p of Object.keys(save.shop.decorByPaddock).sort((a, b) => Number(a) - Number(b))) {
    save.shop.decorByPaddock[p] = save.shop.decorByPaddock[p].filter((id) => {
      if (STACKABLE_IDS.has(id)) return true;
      if (seenDecor.has(id)) { save.shop.stock[id] = (save.shop.stock[id] ?? 0) + 1; return false; }
      seenDecor.add(id);
      return true;
    });
    if (save.shop.decorByPaddock[p].length === 0) delete save.shop.decorByPaddock[p];
  }
  // Paddocks used to be a viewport artifact (a phone split the same herd into
  // more of them than a desktop). They're now owned things: grant however many
  // this herd needs, free — never shrink a count the player already has.
  const regularHerd = (save.horses ?? []).filter((h) => !isMagicalCoat(h.paletteKey)).length;
  save.paddocksOwned = Math.max(save.paddocksOwned ?? 1, Math.ceil(regularHerd / PADDOCK_CAP), 1);

  // Sweep up any decor stranded in paddocks that no longer exist (mobile saves
  // could have decorated up to six of them under the viewport model).
  reclaimOrphanedDecor(save);

  return save;
}

function migrate(oldSave) {
  // No older versions exist yet; when the shape changes, upgrade old saves
  // here instead of discarding them.
  return null;
}
