// achievements.js — pride-only badges (issue #65). Data + earn logic only; no
// DOM, no game rules. Mirrors traits.js / horse.js's COAT_CATALOG as a plain
// catalog the UI (render.js) and the checker (below) both read.
//
// Every badge is prize-free: bragging rights, a filled shelf, and — via the
// tiered "long haul" group — visible goals that pull play past 100 rescues,
// where the coat book and the one-shot badges have long since completed.

import { SHOP_ITEMS, ownedCount, PADDOCK_CAP } from './shop.js';
import { COAT_CATALOG, isMagicalCoat } from './horse.js';
import { TRAITS } from './traits.js';
import { yearsPlayed } from './seasons.js';

// The bill kinds "Good books" wants a clean sheet on (kept in step with
// game.js's BILLS; a spare kind here just makes the badge a touch harder).
const BILL_KINDS = ['vet', 'farrier', 'hay', 'mechanic', 'barn', 'journalist'];

// A fully-dressed horse wears one item from each wardrobe slot. The two
// either/or pairs (rug OR blanket, ear-flower OR forelock-bow) mean "every
// item" can't be worn at once, so a maximal outfit fills every slot instead.
const OUTFIT_SLOTS = [
  ['boots'],
  ['leg-wraps'],
  ['winter-rug', 'saddle-blanket'],
  ['ear-flower', 'forelock-bow'],
];

/** The home-paddock horses (newest PADDOCK_CAP rescues, magical ones aside).
 *  Foals are skipped: they can't be dressed until grown, so the "best dressed"
 *  badge shouldn't wait on one. */
function homePaddockHorses(state) {
  return state.horses.filter((h) => !isMagicalCoat(h.paletteKey) && !h.foal).slice(-PADDOCK_CAP);
}

function horseFullyDressed(horse) {
  return OUTFIT_SLOTS.every((slot) => slot.some((id) => horse.wardrobe?.includes(id)));
}

/** Every purchasable (non-gift) shop item owned at least once. */
function ownsEverything(state) {
  return SHOP_ITEMS.filter((i) => !i.gift).every((i) => ownedCount(i.id, state) > 0);
}

// A count badge carries progress(state) -> { value, goal }; earned is derived.
// A one-shot badge carries earned(state) -> bool. Both share { id, name, hint,
// icon, group }.
function countBadge(id, name, icon, group, hint, goal, value) {
  return { id, name, icon, group, hint, goal, progress: (s) => ({ value: value(s), goal }) };
}

export const ACHIEVEMENT_GROUPS = [
  { id: 'care', title: 'Everyday care' },
  { id: 'collector', title: 'Collector' },
  { id: 'haul', title: 'The long haul' },
  { id: 'community', title: 'Community & beyond' },
];

export const ACHIEVEMENTS = [
  // ---- everyday care ----
  { id: 'farrier', name: "Farrier's friend", icon: '🧲', group: 'care',
    hint: 'Booked the farrier for a horse', earned: (s) => (s.stats.farrierVisits ?? 0) >= 1 },
  { id: 'wormed', name: 'Clean bill', icon: '💊', group: 'care',
    hint: 'Wormed a horse', earned: (s) => (s.stats.wormings ?? 0) >= 1 },
  { id: 'good-books', name: 'Good books', icon: '🧾', group: 'care',
    hint: 'Paid every kind of bill', earned: (s) => BILL_KINDS.every((k) => (s.stats.billKindsPaid ?? []).includes(k)) },
  { id: 'brave-heart', name: 'Brave heart', icon: '💛', group: 'care',
    hint: 'A horse overcame its fear', earned: (s) => (s.stats.fearsOvercome ?? 0) >= 1 },
  countBadge('character-study', 'Character study', '🎭', 'care',
    'Met all 29 personalities', TRAITS.length, (s) => (s.stats.traitsSeen ?? []).length),

  // ---- collector ----
  countBadge('coat-collector', 'Coat collector', '🎨', 'collector',
    'Collected every coat', COAT_CATALOG.length, (s) => COAT_CATALOG.filter((c) => s.collectedCoats.includes(c.id)).length),
  { id: 'best-dressed', name: 'Best dressed', icon: '👗', group: 'collector',
    hint: 'Every home-paddock horse in a full outfit',
    earned: (s) => { const h = homePaddockHorses(s); return h.length > 0 && h.every(horseFullyDressed); } },
  { id: 'compulsive-shopper', name: 'Compulsive shopper', icon: '🛍️', group: 'collector',
    hint: 'Owned one of everything in the shop', earned: ownsEverything },
  { id: 'grown-rescue', name: 'A place of their own', icon: '✨', group: 'collector',
    hint: 'Grew the rescue to a full sanctuary', earned: (s) => (s.facilities ?? []).includes('sanctuary-field') },

  // ---- the long haul (tiered; progress bars pull play onward) ----
  countBadge('rescue-100', 'Century of care', '🐴', 'haul', '100 horses rescued', 100, (s) => s.stats.horsesRescued),
  countBadge('rescue-250', 'Devoted rescuer', '🐴', 'haul', '250 horses rescued', 250, (s) => s.stats.horsesRescued),
  countBadge('rescue-500', 'Legendary rescue', '🌟', 'haul', '500 horses rescued', 500, (s) => s.stats.horsesRescued),
  countBadge('rescue-1000', 'A thousand second chances', '✨', 'haul', '1,000 horses rescued', 1000, (s) => s.stats.horsesRescued),
  countBadge('rehome-50', 'Matchmaker', '🏡', 'haul', '50 forever homes found', 50, (s) => s.stats.horsesRehomed),
  countBadge('rehome-100', 'Homecoming hero', '🏡', 'haul', '100 forever homes found', 100, (s) => s.stats.horsesRehomed),
  countBadge('supporters-500', 'Well followed', '❤️', 'haul', '500 supporters', 500, (s) => s.supporters),
  countBadge('supporters-2500', 'Local legend', '❤️', 'haul', '2,500 supporters', 2500, (s) => s.supporters),
  countBadge('income-100k', 'Hay fund hero', '💶', 'haul', '€100,000 raised', 100000, (s) => Math.floor(s.stats.totalDonated)),
  countBadge('income-1m', "Millionaire's meadow", '💶', 'haul', '€1,000,000 raised', 1000000, (s) => Math.floor(s.stats.totalDonated)),
  countBadge('pen-pals', 'Pen pals', '💌', 'haul', '100 postcards received', 100, (s) => (s.postcards ?? []).length),

  // ---- community & beyond ----
  { id: 'open-house', name: 'Open house', icon: '🎪', group: 'community',
    hint: 'Held a Visitors Day', earned: (s) => (s.stats.visitorsDaysRun ?? 0) >= 1 },
  { id: 'old-friends', name: 'Old friends', icon: '🤝', group: 'community',
    hint: 'Hosted a Reunion Day', earned: (s) => (s.stats.reunionsHeld ?? 0) >= 1 },
  { id: 'round-the-year', name: 'Round the year', icon: '🗓️', group: 'community',
    hint: 'Played through all four seasons', earned: (s) => yearsPlayed(s.stats.playSeconds ?? 0) >= 1 },
  { id: 'born-here', name: 'Born at the rescue', icon: '🐴', group: 'community',
    hint: 'Raised a foal and found it a home', earned: (s) => (s.stats.homegrownRehomed ?? 0) >= 1 },
  { id: 'real-hero', name: 'Real hero', icon: '💝', group: 'community',
    hint: 'Donated to the real ARCH', earned: (s) => !!s.milestones.donatedForReal },
  { id: 'word-of-mouth', name: 'Word of mouth', icon: '📣', group: 'community',
    hint: 'Shared the game for real', earned: (s) => !!s.milestones.sharedForReal },
];

/** Whether a badge is currently earned (count badges derive it from progress). */
export function isEarned(a, state) {
  return a.progress ? a.progress(state).value >= a.goal : a.earned(state);
}

/**
 * Grant any newly-earned badges. Mutates state.achievements (the earned-id
 * list) and returns the freshly-earned achievement objects, newest first —
 * the caller decides whether to toast them (live play) or fold them in
 * quietly (the one-time retroactive backfill on load).
 */
export function checkAchievements(state) {
  state.achievements ??= [];
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements.includes(a.id)) continue;
    if (isEarned(a, state)) {
      state.achievements.push(a.id);
      newly.push(a);
    }
  }
  return newly;
}
