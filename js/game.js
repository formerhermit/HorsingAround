// game.js — game rules and tuning. No DOM access here.
//
// The economy models how a real rescue works: care raises wellbeing,
// well-cared-for horses attract supporters, supporters donate money,
// and money pays for real costs. Care never generates money directly.

import {
  gameState, createHorse,
  RESCUE_MILESTONES, REHOME_MILESTONES, DONATE_MILESTONE, SUPPORTER_MILESTONES,
} from './state.js';
import { PALETTE_KEYS, isMagicalCoat } from './horse.js';
import { attractionBonus, shareMultiplier, PADDOCK_CAP, herdAtCapacity, SHOP_ITEMS, paddockHasRoomFor } from './shop.js';
import {
  TRAITS, QUIRK_TRAITS, TRAIT_INFO, isFearTrait, FEAR_OVERCOME_AT,
  FEAR_CARE_MESSAGES, FEAR_CRIT_MESSAGES,
} from './traits.js';
import {
  billDiscount, adoptionMultiplier, rescueDiscount, rescueWellbeingBonus,
  eventDrawMultiplier, supporterCapMultiplier, driftGraceMultiplier, hasFacility,
} from './facilities.js';
import { SEASONS, currentSeason, seasonIndexFor } from './seasons.js';

// ---- tuning ----
export const CARE_GAIN = 2;          // wellbeing per care click
export const CRIT_CHANCE = 0.08;     // ~1 in 12 care clicks lands especially well
export const CRIT_GAIN = 6;          // wellbeing from one of those (vs CARE_GAIN)
export const WELLBEING_MAX = 100;
export const CONTENT_AT = 80;        // "content" — triggers the first donation
export const FIRST_DONATION = 12;    // € from the very first supporter
export const SUPPORTER_RATE = 0.04;  // € per supporter per second
export const RESCUE_BASE_COST = 25;  // second horse; later rescues escalate
export const RESCUE_COST_FACTOR = 1.8;
export const TRAIT_REVEAL_AT = 40;   // wellbeing at which personality shows
export const SPONSOR_AT = 95;        // "thriving" — earns the horse a sponsor
export const FIRST_SPONSOR_AT = 88;  // Biscuit sponsors a touch earlier, as its own beat
export const SPONSOR_RATE = 0.15;    // € per sponsored horse per second
export const SHARE_BASE = 3;         // € per full-charge shared update...
export const SHARE_PER_SUPPORTER = 0.3; // ...plus this per supporter
// Sharing runs on a charge meter (issue #9): the button refills over
// SHARE_CHARGE_TIME and pays out in proportion to the charge spent, so waiting
// for a full meter is worth it and mashing the button harvests next to nothing.
// Below SHARE_READY_AT the button rests -- a short, visible cooldown. And only
// a full-charge share can go viral: patience, not tap speed, buys the jackpot.
export const SHARE_CHARGE_TIME = 30; // seconds for the meter to refill fully
export const SHARE_READY_AT = 0.15;  // charge below which the button rests
export const VIRAL_CHANCE = 0.1;     // rolled only on a full-charge share
export const VIRAL_MULT = 5;         // payout multiplier when one takes off
export const VIRAL_SUPPORTERS_MIN = 3; // new followers a viral share brings...
export const VIRAL_SUPPORTERS_MAX = 8; // ...up to this many
export const TIP_CHANCE = 0.02;      // ~1 in 50 care clicks draws a spontaneous tip
export const TIP_MIN = 2;            // € range a watching supporter chips in on the spot
export const TIP_MAX = 5;
export const THRIVING_AT = 95;       // wellbeing for "thriving" (matches wellbeingLabel)
export const FRONT_ROW = 3;          // horses shown up close; the rest fall to the back row (matches render.js)
const LONELY_DELAY = 14;             // seconds after first donation before the loneliness beat

// ---- gentle upkeep (issue #45) ----
// Horses love routine: left alone long enough, a horse slowly eases back down
// toward "content", and a few quick care taps top it back up. This gives a
// recovered herd a reason to be visited without ever getting mean: drift never
// takes a horse below DRIFT_FLOOR (safely "content", still the happy artwork),
// a sponsor once earned stays forever, and magical gift horses are above such
// earthly needs entirely. The stakes run through the herd's supporter pull: a
// topped-up herd sustains a bigger following than a drifted one.
export const DRIFT_FLOOR = 82;        // drift stops here: still "content"
export const DRIFT_GRACE = 8 * 60;    // seconds a horse holds steady after care
export const DRIFT_PER_SEC = 1 / 60;  // then eases down ~1 wellbeing a minute

// Chance per second that a new supporter notices the rescue. Every horse
// contributes according to its own wellbeing and the contributions add up,
// so each recovered horse permanently speeds up supporter growth — and a
// fresh scruffy arrival adds nothing, but no longer drags the rest down.
// The steady pull of the herd, in supporters/second, before any short-lived
// glow boost. Also sets the following's carrying capacity (below).
function herdPull() {
  const fromHorses = gameState.horses.reduce((sum, h) => {
    if (h.wellbeing >= 95) return sum + 0.025;
    if (h.wellbeing >= 70) return sum + 0.015;
    if (h.wellbeing >= 50) return sum + 0.006;
    return sum;
  }, 0);
  // Dressed-up horses turn heads too — wardrobe items add a flat bonus.
  let base = fromHorses + attractionBonus(gameState);
  // A magical friend draws admirers: the unicorn adds a steady flat charm on top
  // of the pull it already gives as a thriving horse.
  if (hasUnicorn()) base += UNICORN_CHARM;
  return base;
}

function attractionPerSecond() {
  // A freshly-tended horse makes the whole paddock buzz for a short while (see
  // the little-needs cycle below): attraction is boosted until glowUntil.
  const base = herdPull();
  return Date.now() < glowUntil ? base * WANT_GLOW_MULT : base;
}

// A herd of a given quality can only sustain so large a following: new supporters
// stop arriving as the count nears capacity, so income plateaus for a given herd
// instead of climbing forever while a tab sits open. Growing or improving the
// herd raises the ceiling.
const SUPPORTER_CAP_PER_PULL = 450;
function supporterCapacity() {
  // The Visitor centre lifts the ceiling a modest 15% (issue #48).
  return herdPull() * SUPPORTER_CAP_PER_PULL * supporterCapMultiplier(gameState);
}
/** How readily new supporters still arrive: 1 with an empty following, easing to
 *  0 as it fills toward capacity. */
function attractionFalloff() {
  const cap = supporterCapacity();
  return cap > 0 ? Math.max(0, 1 - gameState.supporters / cap) : 0;
}

const SUPPORTER_NAMES = [
  'María', 'Ana', 'Javi', 'Carmen', 'Pablo', 'Lucía',
  'Sofía', 'Diego', 'Elena', 'Marcos', 'Pilar', 'Álvaro',
  'Jean', 'Aly', 'Jill', 'Stephanie', 'Elisabeth',
  'Jo', 'Mark', 'Richard', 'Phil', 'Chris',
  'Beth', 'Karen', 'Josephine', 'Louise', 'Meghan',
  'Susan', 'Gillian', 'Peter', 'Simon', 'Rich',
  'Keith', 'Judy', 'Daniel', 'Ben', 'Joel', 'Lucy',
  'Claire', 'Clara', 'Roo', 'Ruth', 'Jake', 'Bethan', 'Ellie',
];

const HORSE_NAMES = [
  'Canela', 'Luna', 'Chispa', 'Trufa', 'Nube', 'Pepita',
  'Almendra', 'Turrón', 'Membrillo', 'Aceituna', 'Bruno', 'Duquesa',
  'Pastora', 'Graciella', 'Revoltosa', 'Bollycao', 'Ratatouille',
  'Gabbi', 'Borrego', 'Margarita', 'Bella', 'Brisa', 'Brava',
  'Victoria', 'Lucero', 'Luz de Luna', 'Senador', 'Torero', 'Ida',
  'Llaminera', 'Primero', 'Ramona', 'Simba', 'Pinocchio', 'Tizón',
  'Esperanza', 'Cristal', 'Gitana', 'Hindia', 'Pirata', 'Lola',
  'Fabiola', 'Abha', 'Binky', 'Alazana', 'Dulcinea', 'Curra',
  'Soli', 'Campano', 'Perdigon', 'Abuela', 'Melanie', 'Carolina',
  'Francisco', 'Delfín', 'Maria', 'Corrie', 'Ruco', 'Palmera',
  'Bartolo', 'Castañito', 'Estrella', 'Perla', 'Sara', 'Zíngaro',
  'Bayete', 'Triana',
  'Bibbles', 'Riley', 'Pippin', 'Joya', 'Tobi', 'Spoons', 'Tiger',
  'Nipsy', 'Roger', 'Squiggle', 'Starlight', 'Buttons', 'Indo',
  'Effie', 'Lustro', 'Keith', 'Fandango', 'Ipsy', 'Bubbles', 'Chief',
  'Kipsy', 'Jingles', 'Mopper', 'WingDing', 'Daisy', 'Duke', 'Muddle',
  'Pipples', 'Boo',
];

// Personality traits (quirks and fears, with their mechanics) live in
// traits.js; horse.trait stores the plain text, phrased to follow "<name> is".

// How often a care tap on a revealed quirk lands as that horse's own delighted
// "trait moment" (crit-sized gain, bespoke copy) instead of generic flavour.
const TRAIT_MOMENT_CHANCE = 0.18;
// Supporters who hear about a fear horse's breakthrough and start following.
const FEAR_BREAKTHROUGH_SUPPORTERS = 5;

// Flavour shown as a floating pop next to the horse on each click.
// Deliberately money-free: in phase 1 care is time and kindness, not budget.
const CARE_MESSAGES = [
  '🪮 brushed',
  '🫶 scratched behind the ear',
  '✨ mane detangled',
  '🧹 hooves picked',
  '💛 kind words',
  '🥕 a carrot',
  '🍎 apple slice',
  '🧽 a good scrub',
];

// Shown on a crit care click (see CRIT_CHANCE) — a shade more delighted than the
// everyday brush/scratch, to mark that the click landed especially well.
const CRIT_MESSAGES = [
  '✨ a real breakthrough!',
  '💫 melts into the brush',
  '🌟 leans in, totally trusting',
  '💛 tail swishing with joy',
  '✨ the happiest little nicker',
  '🌼 a proper cuddle',
];

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Weighted pick from `list`, where `weights[item]` (default 1) scales its odds.
 *  Used to lean the seasonal bill draw toward that season's chores. */
function weightedFrom(list, weights = {}) {
  const total = list.reduce((sum, item) => sum + (weights[item] ?? 1), 0);
  let r = Math.random() * total;
  for (const item of list) {
    r -= weights[item] ?? 1;
    if (r < 0) return item;
  }
  return list[list.length - 1];
}

/** Note a trait the player has now met, for the "all 29 personalities" badge
 *  (issue #65). Called wherever a trait first becomes visible. */
function recordTraitSeen(trait) {
  if (!trait) return;
  (gameState.stats.traitsSeen ??= []);
  if (!gameState.stats.traitsSeen.includes(trait)) gameState.stats.traitsSeen.push(trait);
}

/** Random pick avoiding values the herd already uses, where possible. */
function randomUnused(list, usedValues) {
  const unused = list.filter((v) => !usedValues.includes(v));
  return randomFrom(unused.length ? unused : list);
}

/**
 * One care click on a horse. Mutates state; returns what happened
 * ({ gain, message, events }) so the caller can render feedback.
 * `events` are story beats: [{ type, message }].
 */
export function careFor(horse) {
  gameState.stats.clicks += 1;

  // A thriving horse can't recover further, but clicking it should still feel
  // alive — a watching supporter can still leave a tip (rolled below).
  const maxed = horse.wellbeing >= WELLBEING_MAX;
  const info = TRAIT_INFO[horse.trait];
  // A still-nervous fear horse below the reveal threshold gets the
  // trust-building copy instead of brushes and carrots. Same gain, always:
  // fear changes the texture of care, never its speed.
  const trustPhase = info?.kind === 'fear' && !horse.fearOvercome && horse.wellbeing < TRAIT_REVEAL_AT;
  const crit = !maxed && Math.random() < CRIT_CHANCE;
  // A revealed quirk sometimes turns an ordinary tap into that horse's own
  // delighted moment: crit-sized gain, bespoke copy (the carrot for the
  // hoarder, the ear scratch for the ticklish one).
  const traitMoment = !maxed && !crit && info?.kind === 'quirk' && info.moment
    && horse.wellbeing >= TRAIT_REVEAL_AT && Math.random() < TRAIT_MOMENT_CHANCE;
  const gain = maxed ? 0 : (crit || traitMoment ? CRIT_GAIN : CARE_GAIN);
  // Captured before the first-supporter unlock flips it: the click that first
  // unlocks the money side shouldn't also roll a tip on the same tap.
  const moneyUnlocked = gameState.unlocks.moneyUI;

  const before = horse.wellbeing;
  horse.wellbeing = Math.min(WELLBEING_MAX, horse.wellbeing + gain);
  horse.lastCaredAt = Date.now(); // even a maxed horse holds its shine when petted

  const events = [];
  // Personality emerges as a horse recovers enough to relax. Assign one here
  // if the horse doesn't have it yet (Biscuit starts without one) so this beat
  // lands early, well before the donation/rescue/sponsor beats. Biscuit draws
  // from the quirk pool only: fears belong to rescues, whose arrival copy
  // introduces them properly.
  if (before < TRAIT_REVEAL_AT && horse.wellbeing >= TRAIT_REVEAL_AT) {
    horse.trait ??= randomUnused(QUIRK_TRAITS, gameState.horses.map((h) => h.trait).filter(Boolean));
    // The first couple of these introduce the mechanic in full; after that the
    // "starting to relax" preamble just repeats, so trim to the punchline.
    // A fear horse's fear was visible from arrival, so its beat is about the
    // trust built so far rather than a reveal.
    const shown = gameState.stats.traitsRevealed ?? 0;
    gameState.stats.traitsRevealed = shown + 1;
    recordTraitSeen(horse.trait);
    let message;
    if (isFearTrait(horse.trait)) {
      message = `${horse.name} is starting to relax around you, though still ${horse.trait} 🐴`;
    } else if (shown < 2) {
      message = `${horse.name} is starting to relax — turns out ${horse.name} is ${horse.trait} 🐴`;
    } else {
      message = `Turns out ${horse.name} is ${horse.trait} 🐴`;
    }
    events.push({ type: 'trait', message });
  }
  // First supporter: someone notices a horse doing well, money UI unlocks.
  if (!gameState.unlocks.moneyUI && horse.wellbeing >= CONTENT_AT) {
    gameState.unlocks.moneyUI = true;
    gameState.milestones.firstDonation = true;
    gameState.supporters = 1;
    gameState.coins += FIRST_DONATION;
    gameState.stats.totalDonated += FIRST_DONATION;
    events.push({
      type: 'milestone',
      message: `${horse.name} is looking content — and María noticed! She's your first supporter and donated €${FIRST_DONATION} 💛`,
    });
    // Bring the first want on quickly, so its big payout (fulfilWant) lands soon
    // and gets the player toward their second horse.
    if (!gameState.milestones.firstWantRewarded) {
      wantCountdown = randomBetween(FIRST_WANT_MIN, FIRST_WANT_MAX);
    }
  }

  // A spontaneous tip: rarely, a supporter who's watching chips in a few euros
  // on the spot. Only once the money side exists (before that, no supporters).
  let tip = null;
  if (moneyUnlocked && Math.random() < TIP_CHANCE) {
    const amount = TIP_MIN + Math.floor(Math.random() * (TIP_MAX - TIP_MIN + 1));
    gameState.coins += amount;
    gameState.stats.totalDonated += amount;
    tip = { amount, supporter: randomFrom(SUPPORTER_NAMES) };
  }

  let message;
  if (maxed) {
    message = `${horse.name} is thriving ♥`;
  } else if (traitMoment) {
    message = info.moment;
  } else if (crit) {
    message = randomFrom(trustPhase ? FEAR_CRIT_MESSAGES : CRIT_MESSAGES);
  } else {
    message = randomFrom(trustPhase ? FEAR_CARE_MESSAGES : CARE_MESSAGES);
  }

  return { gain, crit: crit || traitMoment, message, tip, events };
}

/** € one *full-charge* shared update brings in at current supporter count. A
 *  nicer-looking paddock makes every post perform better — decor items multiply
 *  this. The actual payout scales with the charge meter (see shareCharge). */
export function shareValue(state = gameState) {
  return (SHARE_BASE + SHARE_PER_SUPPORTER * state.supporters) * shareMultiplier(state);
}

/** How charged the share button is, 0..1. The meter rebuilds over
 *  SHARE_CHARGE_TIME; lastSharedAt is persisted, so a reload doesn't refill it
 *  (0 — never shared — reads as a full charge, which suits a fresh game). */
export function shareCharge(state = gameState, now = Date.now()) {
  return Math.max(0, Math.min(1, (now - (state.lastSharedAt ?? 0)) / (SHARE_CHARGE_TIME * 1000)));
}

/**
 * The active income lever: share an update about the horses and supporters
 * chip in. Care clicks never mint money — fundraising asks people, and the
 * more supporters you've earned, the more each ask brings in. The payout is
 * proportional to the charge spent, and a full-charge share has a small chance
 * to go viral: a multiplied payout plus a burst of brand-new followers.
 * Returns { amount, charge, viral, newSupporters }, or null while resting.
 */
export function shareUpdate(now = Date.now()) {
  const charge = shareCharge(gameState, now);
  if (charge < SHARE_READY_AT) return null; // resting; the button is disabled anyway
  let amount = shareValue() * charge;
  let viral = false;
  let newSupporters = 0;
  if (charge >= 1 && Math.random() < VIRAL_CHANCE) {
    viral = true;
    amount *= VIRAL_MULT;
    newSupporters = VIRAL_SUPPORTERS_MIN
      + Math.floor(Math.random() * (VIRAL_SUPPORTERS_MAX - VIRAL_SUPPORTERS_MIN + 1));
    gameState.supporters += newSupporters;
  }
  gameState.lastSharedAt = now;
  gameState.coins += amount;
  gameState.stats.totalDonated += amount;
  return { amount, charge, viral, newSupporters };
}

/** Base cost of the next rescue. Escalates with herd size. Magical gift horses
 *  (the unicorn, rainbow and golden) are gifts, not rescues, so they don't
 *  count toward it. This is the *scaling* figure that bills, adoption fees and
 *  milestone bonuses are sized from; what the player actually pays for a rescue
 *  is rescuePrice() below (the second horsebox discounts it). */
export function rescueCost(state = gameState) {
  const rescued = state.horses.filter((h) => !isMagicalCoat(h.paletteKey)).length;
  return Math.round(RESCUE_BASE_COST * Math.pow(RESCUE_COST_FACTOR, rescued - 1));
}

/** What a rescue actually costs to bring in right now — the base cost less the
 *  second-horsebox discount (issue #48). Used for the button and the purchase. */
export function rescuePrice(state = gameState) {
  return Math.round(rescueCost(state) * (1 - rescueDiscount(state)));
}

/** The horse a rescue would bump from the front row back to the back row (the
 *  oldest of the current front row), or null while the herd is small enough
 *  that nobody gets bumped. */
export function horseBumpedByRescue(state = gameState) {
  const n = state.horses.length;
  if (n < FRONT_ROW) return null;
  return state.horses[n - FRONT_ROW] ?? null;
}

/** A rescue is blocked while the horse it would relegate to the back row still
 *  needs care -- no horse should be sent to the back before it's thriving. */
export function rescueNeedsCareFirst(state = gameState) {
  const bumped = horseBumpedByRescue(state);
  return !!bumped && bumped.wellbeing < THRIVING_AT;
}

// The full "thin, wary, keeping to the far end" arrival line sets the scene the
// first few times, but gets old once the player knows the drill. After this many
// rescued arrivals, common coats get the short version instead. Rare coats keep
// their own treasure line every time -- those stay an event.
const ARRIVAL_FLAVOUR_LIMIT = 3;

/**
 * Spend rescue funds to bring in a new horse, arriving in worse condition
 * than Biscuit did. Returns { ok, horse, events }.
 */
export function rescueHorse() {
  // Every paddock space taken: like the real rescue, no one else can come in
  // until a horse finds a forever home (or a new paddock is built).
  if (herdAtCapacity(gameState)) return { ok: false, horse: null, reason: 'full', events: [] };
  const cost = rescuePrice();
  if (gameState.coins < cost) return { ok: false, horse: null, events: [] };
  // Don't send a still-struggling horse to the back row to make space.
  if (rescueNeedsCareFirst()) return { ok: false, horse: null, reason: 'needs-care', events: [] };

  gameState.coins -= cost;
  const herd = gameState.horses;
  const name = randomUnused(HORSE_NAMES, herd.map((h) => h.name));
  const coat = pickRescueCoat();
  // The second horsebox means arrivals turn up in better shape (issue #48).
  const arrivalWellbeing = 4 + Math.floor(Math.random() * 4) + rescueWellbeingBonus(gameState);
  const horse = createHorse({
    // rescueOrder makes this unique even for rescues in the same millisecond
    id: `horse-${herd.length + 1}-${Date.now().toString(36)}`,
    name,
    paletteKey: coat,
    wellbeing: arrivalWellbeing, // base 4–7, rougher than Biscuit's 12
    rescueOrder: herd.length + 1,
    trait: randomUnused(TRAITS, herd.map((h) => h.trait)),
  });
  herd.push(horse);
  gameState.stats.horsesRescued += 1;
  const newForCollection = collectCoat(coat);

  const rareLabel = RARE_COAT_LABELS[coat];
  // horsesRescued already counts this arrival (and Biscuit), so subtract Biscuit
  // to get how many rescues have arrived so far.
  const arrivalNo = gameState.stats.horsesRescued - 1;
  let message;
  const fearInfo = isFearTrait(horse.trait) ? TRAIT_INFO[horse.trait] : null;
  if (fearInfo) recordTraitSeen(horse.trait); // a fear is visible from arrival
  if (rareLabel) {
    message = `✨ ${name} arrives, thin and wary, but look closer: a rare ${rareLabel}! What a treasure 🌟`;
  } else if (fearInfo) {
    // A fear is visible from the moment a horse arrives — this line is how the
    // player meets it, so it always gets said, however many rescues in.
    message = `${name} arrives: thin, wary, and ${fearInfo.arrival}. Time to get to work 🐴`;
  } else if (arrivalNo <= ARRIVAL_FLAVOUR_LIMIT) {
    message = `${name} arrives: thin, wary, and keeping to the far end of the paddock. Time to get to work 🐴`;
  } else {
    message = `${name} has arrived. Time to get to work 🐴`;
  }
  if (newForCollection) message += ' 📖 A new one for your collection!';

  return { ok: true, horse, events: [{ type: 'rescue', message }] };
}

// ---- rare coats ----
// A rescue usually brings a common coat, but occasionally a rare one turns up.
// The odds are deliberately steep (and staggered) so a rare feels like an
// event: the seven rares total ~19%, and a common coat the other ~81%.
const RARE_COAT_CHANCES = [
  { coat: 'spotty',         chance: 0.05 },
  { coat: 'red-boy',        chance: 0.03 },
  { coat: 'patchy',         chance: 0.03 },
  { coat: 'creamy',         chance: 0.025 },
  { coat: 'piebald',        chance: 0.02 },
  { coat: 'piebald-donkey', chance: 0.02 },
  { coat: 'zebra',          chance: 0.015 },
];
const RARE_COAT_LABELS = {
  spotty: 'spotted one', 'red-boy': 'chestnut', piebald: 'piebald',
  'piebald-donkey': 'piebald donkey', zebra: 'zebra',
  patchy: 'patchy one', creamy: 'creamy-maned one',
};

function pickRescueCoat() {
  const roll = Math.random();
  let cumulative = 0;
  for (const r of RARE_COAT_CHANCES) {
    cumulative += r.chance;
    if (roll < cumulative) return r.coat;
  }
  return randomFrom(PALETTE_KEYS);
}

/** Record a coat in the collection book. Returns true if it's newly collected. */
function collectCoat(coat) {
  if (gameState.collectedCoats.includes(coat)) return false;
  gameState.collectedCoats.push(coat);
  return true;
}

// ---- the unicorn ----
// A one-of-a-kind magical friend, unlocked only by choosing to donate to the
// real rescue (see main.js). A permanent resident: never offered for rehoming,
// and it lends the paddock a steady extra pull.
const UNICORN_CHARM = 0.02; // flat attraction added just for having the unicorn

/** Whether the herd already includes a horse of this coat. */
export function hasCoat(coat, state = gameState) {
  return state.horses.some((h) => h.paletteKey === coat);
}

/** Whether the herd already includes the unicorn (it's unique). */
export function hasUnicorn(state = gameState) {
  return hasCoat('unicorn', state);
}

/** Add a one-of-a-kind magical gift horse to the herd. Arrives thriving — a
 *  gift, not a rescue, so it doesn't count toward the rescue tally. Returns it,
 *  or null if the herd already has one. */
function grantGiftHorse(coat, name, trait) {
  if (hasCoat(coat)) return null;
  const horse = createHorse({
    id: `${coat}-${Date.now().toString(36)}`,
    name,
    paletteKey: coat,
    wellbeing: WELLBEING_MAX,
    rescueOrder: gameState.horses.length + 1,
    trait,
  });
  gameState.horses.push(horse);
  collectCoat(coat);
  return horse;
}

/** Add the unicorn (once ever), the donation reward. Returns it, or null. */
export function grantUnicorn() {
  return grantGiftHorse('unicorn', 'Milagro', 'quietly, impossibly magical');
}

// Rescue-count milestones that hand over a magical gift horse instead of a cash
// bonus: a rainbow at 50, a golden pegasus at 100.
const RESCUE_GIFTS = {
  50:  { coat: 'rainbow', name: 'Iris',   trait: 'woven from a whole rainbow' },
  100: { coat: 'golden',  name: 'Dorado', trait: 'winged, and pure gold through and through' },
};

// ---- rehoming ----
// Thriving horses are occasionally offered a forever home for a small adoption
// fee (roughly 10% of the next rescue cost). Offers stop once only two horses
// are left, so the paddock is never emptied out.
const REHOME_MIN_HERD = 2;            // need MORE than this many horses (stop at 2)
const REHOME_GAP_MIN = 40;            // seconds between offers (min)
const REHOME_GAP_MAX = 95;            // ...and max
let rehomeCountdown = randomBetween(REHOME_GAP_MIN, REHOME_GAP_MAX);
let pendingRehome = null;             // { horseId, income } while an offer is on screen (not persisted)

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/** Income offered for rehoming a horse: ~10% of the next rescue's cost. */
function rehomeIncome(state = gameState) {
  // The rehoming office lifts adoption fees (issue #48).
  return Math.max(1, Math.round(rescueCost(state) * 0.1 * adoptionMultiplier(state)));
}

/** A reward-milestone bonus: 25% of the next rescue's cost, into the fund. */
function milestoneBonus(state = gameState) {
  return Math.max(1, Math.round(rescueCost(state) * 0.25));
}

/** Accept the pending rehoming offer: the horse leaves for its forever home and
 *  the adoption fee lands in the rescue fund. Returns { horse, income } or null. */
export function acceptRehome() {
  if (!pendingRehome) return null;
  const { horseId, income } = pendingRehome;
  pendingRehome = null;
  const idx = gameState.horses.findIndex((h) => h.id === horseId);
  if (idx === -1) return null;
  const [horse] = gameState.horses.splice(idx, 1);
  gameState.coins += income;
  gameState.stats.horsesRehomed += 1;
  if (horse.bornHere) gameState.stats.homegrownRehomed = (gameState.stats.homegrownRehomed ?? 0) + 1;
  // A returned horse re-adopted: the second second chance (issue #35's badge).
  if (horse.returned) gameState.stats.returnedRehomed = (gameState.stats.returnedRehomed ?? 0) + 1;
  // The horse goes to its new home, but its clothes stay: anything it was
  // wearing comes off into the stores to re-use on another horse.
  const leftBehind = horse.wardrobe.length > 0;
  for (const id of horse.wardrobe) {
    gameState.shop.stock[id] = (gameState.shop.stock[id] ?? 0) + 1;
  }
  horse.wardrobe = [];
  schedulePostcard(horse); // a keepsake note will arrive from its new home later
  return { horse, income, leftBehind };
}

/** Decline the pending offer: the horse stays, no money changes hands. */
export function declineRehome() {
  pendingRehome = null;
}

// ---- postcards ----
// A while after a horse is rehomed, a keepsake postcard arrives saying it has
// settled in. The delay varies for surprise: some horses write the same visit,
// some take a few hours, some a day. Times are seconds; weights are relative.
const POSTCARD_BUCKETS = [
  { weight: 30, min: 5, max: 25 },                 // same visit
  { weight: 35, min: 1 * 3600, max: 4 * 3600 },    // a few hours
  { weight: 35, min: 12 * 3600, max: 36 * 3600 },  // next day
];

// Warm, regional homes a rehomed horse might go to (shown on the postcard).
const ADOPTERS = [
  'the García family', 'the Morales family', 'the Ruiz family',
  'the Fernández family', 'the Cabrera family', 'Abuela Rosa',
  'Don Emilio', 'a young couple in Ronda', 'a riding school near Sevilla',
  'a little farm outside Málaga',
];

// Settling-in notes. {name}, {adopter}, {trait} are filled per horse; the trait
// callback ("still {trait}") is what makes each card feel like your own horse.
const POSTCARD_TEMPLATES = [
  '{name} has settled right in with {adopter}. Still {trait}, of course, but happier than ever 💛',
  'A little note to say {name} is thriving with {adopter}. Still {trait}, naturally! 🐴',
  '{name} sends a happy nicker from a new paddock with {adopter}. Still {trait}: some things never change 💛',
  'Word from {adopter}: {name} has fit right in. Still {trait}, but loving the new home 🌼',
  'Greetings from {name}, now living the good life with {adopter}. Still {trait}, we hear! 🥕',
  '{name} is doing wonderfully with {adopter}. Still {trait}, turns out that came along for the ride 💛',
];
// Fallback for the rare horse rehomed without a revealed trait.
const POSTCARD_TEMPLATES_NOTRAIT = [
  '{name} has settled right in with {adopter}, and could not be happier 💛',
  'A little note to say {name} is thriving with {adopter}. Thank you for everything 🐴',
];
// For a fear horse whose breakthrough happened before it left: the warmest
// lines in the game, because "still {trait}" would sell its bravery short.
const POSTCARD_TEMPLATES_BRAVE = [
  '{name} has settled right in with {adopter}. And guess what: not {trait} anymore, thanks to you 💛',
  'A little note to say {name} is thriving with {adopter}. And after everything, not {trait} these days 🐴',
  '{name} sends a happy nicker from their new home with {adopter}. Braver than ever: not {trait} anymore 💛',
];

function weightedPick(buckets) {
  const total = buckets.reduce((sum, b) => sum + b.weight, 0);
  let roll = Math.random() * total;
  for (const b of buckets) {
    roll -= b.weight;
    if (roll < 0) return b;
  }
  return buckets[buckets.length - 1];
}

/** Queue a postcard from a just-rehomed horse. Snapshots the horse (name, coat,
 *  outfit, trait) since it's about to leave the herd, and resolves the message
 *  and adopter now so the card is stable. */
function schedulePostcard(horse) {
  const bucket = weightedPick(POSTCARD_BUCKETS);
  const delaySec = randomBetween(bucket.min, bucket.max);
  const adopter = randomFrom(ADOPTERS);
  const overcameFear = isFearTrait(horse.trait) && horse.fearOvercome;
  const templates = overcameFear ? POSTCARD_TEMPLATES_BRAVE
    : horse.trait ? POSTCARD_TEMPLATES : POSTCARD_TEMPLATES_NOTRAIT;
  const message = randomFrom(templates)
    .replaceAll('{name}', horse.name)
    .replaceAll('{adopter}', adopter)
    .replaceAll('{trait}', horse.trait ?? '');
  gameState.pendingPostcards.push({
    id: `pc-${horse.id}-${Date.now().toString(36)}`,
    name: horse.name,
    paletteKey: horse.paletteKey,
    wardrobe: [...(horse.wardrobe ?? [])],
    adopter,
    message,
    // Who they are, remembered in case they ever come home (issue #35). A fear
    // overcome is part of their story now; it comes back overcome.
    trait: horse.trait ?? null,
    fearOvercome: !!horse.fearOvercome,
    dueAt: Date.now() + delaySec * 1000,
    deliveredAt: null,
    read: false,
  });
}

/** Move any pending postcards that have come due into the collection and return
 *  them (for the delivery toast). Runs on the tick and on load, so cards that
 *  came due while the game was closed are waiting on return. */
export function collectDuePostcards(now = Date.now()) {
  const pending = gameState.pendingPostcards ?? [];
  if (!pending.length) return [];
  const due = [];
  const stillPending = [];
  for (const pc of pending) {
    if (pc.dueAt <= now) {
      pc.deliveredAt = now;
      pc.read = false;
      gameState.postcards.push(pc);
      due.push(pc);
    } else {
      stillPending.push(pc);
    }
  }
  gameState.pendingPostcards = stillPending;
  return due;
}

/** Mark every collected postcard as read (called when the album is opened). */
export function markPostcardsRead(state = gameState) {
  for (const pc of state.postcards) pc.read = true;
}

// ---- statue keepsakes ----
// A garden statue arrives for each postcard milestone: a growing memorial to the
// horses you've found homes for. Awarded in order (wooden, stone, flowers, gold),
// once each, and the player keeps every one -- they stack up as the album grows.
export const STATUE_REWARDS = [
  { at: 1, id: 'statue-wooden' },
  { at: 5, id: 'statue-stone' },
  { at: 15, id: 'statue-flowers' },
  { at: 30, id: 'statue-gold' },
];

/** Grant any statue whose postcard threshold has just been reached (once each).
 *  A new statue drops straight into the home paddock if there's room, otherwise
 *  it waits in the stores. Returns [{ id, name, placed }] for the delivery toast. */
export function collectDueStatues(state = gameState) {
  // Defensive: a cloud save adopted mid-session may predate the stores, so make
  // sure the containers exist before we place or store a statue (see below).
  state.shop ??= {};
  state.shop.decorByPaddock ??= {};
  state.shop.stock ??= {};
  const given = (state.milestones.statuesGiven ??= []);
  const count = (state.postcards ?? []).length;
  const granted = [];
  for (const { at, id } of STATUE_REWARDS) {
    if (count < at || given.includes(id)) continue;
    given.push(id);
    const item = SHOP_ITEMS.find((i) => i.id === id);
    let placed = false;
    if (paddockHasRoomFor(item, state, 0)) {
      (state.shop.decorByPaddock[0] ??= []).push(id);
      placed = true;
    } else {
      state.shop.stock[id] = (state.shop.stock[id] ?? 0) + 1;
    }
    granted.push({ id, name: item.name, placed });
  }
  return granted;
}

// ---- little needs ----
// A content horse occasionally has a small want, shown as a thought bubble.
// Tending it (a tap on that horse) gives an instant supporter burst plus a
// short attraction glow. Ignoring a want never hurts the horse: it just fades
// untended and the reward goes uncollected. Gentle by design: one want at a
// time, spaced out, and only on horses already doing well.
const WANT_TRAIT_BIAS = 0.6;      // chance a quirk's linked need is the one asked for
const WANT_MIN_GAP = 60;          // seconds between wants, once none is active
const WANT_MAX_GAP = 150;
const WANT_TTL = 60;              // a want fades if untended this long
const WANT_MIN_WELLBEING = 60;   // only content-ish horses get little luxuries
const WANT_SUPPORTER_BURST = 3;  // supporters gained on fulfilling one
const WANT_GLOW_DURATION = 60;   // seconds the attraction glow lasts
const WANT_GLOW_MULT = 2;        // attraction multiplier during the glow
// A tended want is a photo-worthy moment, and the natural next thing a rescue
// does with one is post it: fulfilling a want charges the share meter by this
// much (issue #47). Any charge that doesn't fit converts straight to coins at
// the share rate — a watching supporter shares it for you — so the reward is
// never worth nothing, even for a following pinned at its capacity where the
// supporter burst and glow no longer bite. Scales with supporters and decor
// (via shareValue), and adds no passive income at all: only a player actually
// tending horses ever sees it.
const WANT_SHARE_CHARGE = 0.5;

// The very first want ever is a deliberate early hook: it lands soon after the
// money side opens and pays out most of a second rescue's cost, so a new player
// reaches their second horse quickly (the early economy is otherwise slow to
// build off a single supporter). One-off, gated by milestones.firstWantRewarded.
const FIRST_WANT_MIN = 6;             // seconds after "content" before it lands
const FIRST_WANT_MAX = 12;
const FIRST_WANT_RESCUE_FRACTION = 0.8; // its coin bonus, as a share of the next rescue's cost

// Each need: the bubble shown above the horse and the pop shown when tended.
// `photo` marks the "take a photo" want, which gets a camera flash in the UI.
const NEEDS = [
  { id: 'mint',    bubble: '🍬', done: '🍬 a happy crunch' },
  { id: 'carrot',  bubble: '🥕', done: '🥕 nom nom' },
  { id: 'apple',   bubble: '🍎', done: '🍎 crunch!' },
  { id: 'brush',   bubble: '🪮', done: '✨ a gleaming coat' },
  { id: 'scratch', bubble: '🫶', done: '💛 utter bliss' },
  { id: 'lonely',  bubble: '💭', done: '💛 feeling loved' },
  { id: 'play',    bubble: '🎾', done: '🎉 zoomies!' },
  { id: 'photo',   bubble: '📸', done: '📸 what a star!', photo: true },
];

let activeWant = null; // { horseId, need, expiresAt } or null; not persisted
// First want of a session comes sooner (discoverability); later ones use the
// gentle gap. Only counts down once the money side is unlocked (see tick).
let wantCountdown = randomBetween(20, 45);
let glowUntil = 0;     // timestamp; attraction is boosted until then (read above)

/** The current want (for drawing its bubble), or null. */
export function getActiveWant() {
  return activeWant;
}

// Wants land on horses in the home paddock (the newest PADDOCK_CAP rescues,
// both rows) that are content enough to fancy a little luxury. Keying off the
// whole home paddock (not just the front row) matters: the front row is
// usually the freshly-rescued scruffy arrivals, while the recovered horses
// that actually want treats sit just behind them. Magical horses live in
// their own paddock and are above wanting things.
function eligibleWantHorses() {
  return gameState.horses
    .filter((h) => !isMagicalCoat(h.paletteKey))
    .slice(-PADDOCK_CAP)
    .filter((h) => h.wellbeing >= WANT_MIN_WELLBEING)
    // A horse still working through its fear isn't fancying little luxuries
    // yet; wants start once the breakthrough lands.
    .filter((h) => !(isFearTrait(h.trait) && !h.fearOvercome));
}

/** Advance the little-needs cycle by dt seconds. One want at a time; spawns
 *  when the gap elapses, clears when it's tended, times out, or its horse
 *  leaves. Called from tick (so it only runs once the money side is unlocked). */
function updateWants(dt, now) {
  if (activeWant) {
    const horseGone = !gameState.horses.some((h) => h.id === activeWant.horseId);
    if (horseGone || now > activeWant.expiresAt) {
      activeWant = null;
      wantCountdown = randomBetween(WANT_MIN_GAP, WANT_MAX_GAP);
    }
    return;
  }
  wantCountdown -= dt;
  if (wantCountdown > 0) return;
  const candidates = eligibleWantHorses();
  if (!candidates.length) {
    wantCountdown = randomBetween(15, 30); // nobody content yet; check again soon
    return;
  }
  wantCountdown = randomBetween(WANT_MIN_GAP, WANT_MAX_GAP);
  // The carrot hoarder mostly wants carrots: a quirk with a linked need leans
  // the bubble that way, with the usual variety the rest of the time.
  const horse = randomFrom(candidates);
  const biasedNeed = TRAIT_INFO[horse.trait]?.want;
  const need = (biasedNeed && Math.random() < WANT_TRAIT_BIAS)
    ? NEEDS.find((n) => n.id === biasedNeed) ?? randomFrom(NEEDS)
    : randomFrom(NEEDS);
  activeWant = {
    horseId: horse.id,
    need,
    expiresAt: now + WANT_TTL * 1000,
  };
}

/** Tend the active want if this is the horse that wanted something. Grants the
 *  supporter burst + glow, charges the share meter (overflow pays out as coins
 *  at the share rate), and returns { need, supporters, coins } for feedback,
 *  else null (so a normal care tap is unaffected). */
export function fulfilWant(horseId, now = Date.now()) {
  if (!activeWant || activeWant.horseId !== horseId) return null;
  const { need } = activeWant;
  activeWant = null;
  wantCountdown = randomBetween(WANT_MIN_GAP, WANT_MAX_GAP);
  gameState.supporters += WANT_SUPPORTER_BURST;
  glowUntil = now + WANT_GLOW_DURATION * 1000;
  // Worth sharing: bump the meter, and pay any overflow out directly.
  const newCharge = shareCharge(gameState, now) + WANT_SHARE_CHARGE;
  const overflow = Math.max(0, newCharge - 1);
  let coins = 0;
  if (overflow > 0) {
    coins = overflow * shareValue();
    gameState.coins += coins;
    gameState.stats.totalDonated += coins;
  }
  // Rewind lastSharedAt so the meter reads the boosted charge (full at most).
  gameState.lastSharedAt = now - Math.min(newCharge, 1) * SHARE_CHARGE_TIME * 1000;
  // The very first want ever pays a big one-off bonus on top: most of a second
  // rescue's cost, so the early game finds its feet quickly (see FIRST_WANT_*).
  let firstWant = false;
  if (!gameState.milestones.firstWantRewarded) {
    gameState.milestones.firstWantRewarded = true;
    const bonus = Math.round(rescueCost() * FIRST_WANT_RESCUE_FRACTION);
    gameState.coins += bonus;
    gameState.stats.totalDonated += bonus;
    coins += bonus;
    firstWant = true;
  }
  return { need, supporters: WANT_SUPPORTER_BURST, coins, firstWant };
}

// ---- paddock life: bills & Visitors Day (issue #50) ----
// Every so often, running the rescue costs real money: the vet calls, a horse
// needs shoes, the hay is delivered, the horse box needs fixing. Bills arrive
// as illustrated popups; paying one always gives a warm payoff, declining is
// always safe (it just comes around again). And sometimes the volunteers plan
// a Visitors Day instead: a heads-up popup, a few minutes to groom the herd,
// then visitors arrive and their entry donations scale with how many horses
// are thriving. Deliberately gentle: one event at a time, well spaced, bills
// only ever a fraction of the fund, and nothing bad ever happens to a horse.
const EVENT_MIN_HORSES = 3;        // paddock life begins once the rescue feels real
const EVENT_GAP_MIN = 5 * 60;      // seconds between paddock-life events
const EVENT_GAP_MAX = 9 * 60;
const EVENT_RETRY_MIN = 60;        // fund too low for a bill: look in again soon
const EVENT_RETRY_MAX = 120;
const BILL_SNOOZE_MIN = 180;       // "not just yet": quietly comes around again
const BILL_SNOOZE_MAX = 300;
const BILL_AFFORD_MARGIN = 1.5;    // only bill a fund that can pay with room to spare
const VISITORS_CHANCE = 0.25;      // an event is sometimes a Visitors Day instead
const VISITORS_DELAY_MIN = 4 * 60; // planning popup -> the day itself
const VISITORS_DELAY_MAX = 7 * 60;
const VISITORS_ENTRY_FEE = 2.5;    // € each visitor donates on the day
const MECHANIC_SUPPORTERS = 3;     // passers-by who admire the freshly fixed box
// A foal is born: costly to raise, but who wouldn't visit a cute new arrival?
// Paying brings a small crowd of new supporters plus a short attraction glow.
const FOAL_SUPPORTERS_MIN = 4;
const FOAL_SUPPORTERS_MAX = 7;
const FOAL_GLOW = 120;             // seconds the new-foal buzz turns extra heads

// A foal born at the rescue is a real horse in the herd that grows up over
// active play (stats.playSeconds, the same clock seasons use): small and happy
// at birth, a personality showing halfway, and grown-and-adoptable at the end.
const FOAL_GROW_SECONDS = 8 * 60;  // active-play seconds a foal takes to grow up
const FOAL_REVEAL_AT = 0.5;        // growth fraction at which its personality shows
const FOAL_START_SCALE = 0.5;      // on-screen size (vs a grown horse) at birth
const FOAL_WELLBEING = 88;         // foals arrive thriving and never droop
// Foals draw a playful personality from this curated slice of the quirk pool
// (never a fear). Filtered to real QUIRK_TRAITS so the badge catalog stays in
// step even if a trait's wording changes; falls back to any quirk if empty.
const FOAL_QUIRK_POOL = [
  'obsessed with the hose',
  'a dedicated shoelace-nibbler',
  'an enthusiastic napper',
  'ticklish behind the ears',
  'convinced apples grow specifically for them',
  'prone to falling asleep on your foot',
  'a shameless attention hog',
].filter((t) => QUIRK_TRAITS.includes(t));

// Each bill's fee scales with the rescue's stage (via the next rescue's cost),
// so it stays felt-but-friendly from a three-horse paddock to a full rescue.
export const BILLS = {
  vet:        { fraction: 0.08, min: 6 },   // a named horse's check-up / worming
  farrier:    { fraction: 0.10, min: 8 },   // a named horse needs new shoes
  hay:        { fraction: 0.15, min: 10 },  // the hay delivery for the whole herd
  water:      { fraction: 0.09, min: 6 },   // fresh water delivered for the troughs
  mechanic:   { fraction: 0.20, min: 12 },  // the horse box needs a repair
  barn:       { fraction: 0.25, min: 15 },  // the stable roof needs fixing (issue #63)
  journalist: { fraction: 0.12, min: 10 },  // a Sur feature: pays off later (issue #64)
  foal:       { fraction: 0.22, min: 14 },  // a foal is born: cost, but draws visitors
};

// The Sur article chain (issue #64): pay the journalist now, and the story
// prints a few minutes later with donations always comfortably above the fee,
// sometimes far above (the front page). The pending article is persisted
// (gameState.pendingArticle), so closing the game never eats a paid-for story:
// it's waiting in print when the player comes back.
const ARTICLE_DELAY_MIN = 3 * 60;    // seconds from paying to the story printing
const ARTICLE_DELAY_MAX = 6 * 60;
const ARTICLE_FRONT_PAGE = 0.125;    // ~1 in 8 stories lands the front page
const REUNION_CHANCE = 0.12;         // windfall roll: Reunion Day (issue #61)

// A returned adoption (issue #35): sometimes, in real rescue life, an adoption
// doesn't hold — and it's never anyone's failing, least of all the horse's.
// Life just happens: a move, a health setback, a sold yard. The horse comes
// home free (no cost, no lost progress, no penalty of any kind), remembered by
// name and coat from its own postcard, keeps any personality it had (a fear
// once overcome STAYS overcome), and can be re-adopted like anyone else. Rare
// by design so a return feels like a story beat, not a revolving door; each
// rehomed horse returns at most once (its postcard is marked).
const RETURN_CHANCE = 0.05;          // windfall-roll slice, after Reunion Day
const RETURN_MIN_REHOMED = 3;        // only once rehoming is an established rhythm
const RETURN_WELLBEING_MIN = 50;     // arrives "a little unsettled", never rough
const RETURN_WELLBEING_MAX = 65;
// Why the adoption ended: always life circumstances, never blame. {name} is the
// horse, {adopter} the family it went to (from the original postcard). Phrased
// so they read right for any adopter, singular or plural ("Abuela Rosa" and
// "the García family" alike).
const RETURN_REASONS = [
  'a move abroad means a long journey ahead, and {adopter} would rather {name} kept these familiar fields',
  'a health setback means {adopter} cannot manage {name}’s care for now',
  'the yard where {name} lived is being sold, and {adopter} had nowhere for a horse to go',
  'a new baby has turned life upside down for {adopter}, the lovely kind of upside down, and {name} needs more time than anyone can spare',
];
const BARN_GLOW = 120;               // seconds the fixed roof turns heads

// Utilidad Pública (issue #62): a one-time recognition beat once the rescue is
// established. Real Spanish charities earn this official public-interest
// status; donations to them attract tax relief, so every euro goes further.
// Permanent and deliberately modest: supporter donations gain 10%, forever.
export const UTILIDAD_AT = 15;       // rescues at which the recognition arrives
export const UTILIDAD_MULT = 1.1;    // supporter donations, forever after
function utilidadMult() {
  return gameState.milestones.utilidadShown ? UTILIDAD_MULT : 1;
}

let eventCountdown = randomBetween(EVENT_GAP_MIN, EVENT_GAP_MAX);
let pendingBill = null;        // { kind, fee, horseId } while a bill popup is up (not persisted)
// The Visitors Day chain (issue #53): `visitorsPlanned` flips when the planning
// popup is queued, but the countdown to the day only starts when the player
// dismisses that popup (scheduleVisitorsDay, called by main.js), and it counts
// live tick seconds, not wall-clock time. A backgrounded tab barely ticks, so
// the preparation window is genuinely the player's, however long the popup sat
// unseen or the tab sat idle.
let visitorsPlanned = false;
let visitorsDayCountdown = 0;  // live seconds until the day, once scheduled; 0 = not started

// The game-time season (seasons.js). Derived live from stats.playSeconds, so
// nothing extra is persisted; this only remembers the last-announced season so
// the tick can toast the moment it turns over. Left null until the first tick
// seeds it, so a reload lands quietly in the current season rather than toasting.
let lastSeasonIndex = null;

export function billFee(kind, state = gameState) {
  const bill = BILLS[kind];
  const raw = Math.max(bill.min, Math.round(rescueCost(state) * bill.fraction));
  // Facilities trim recurring bills (vet station, hay barn) — issue #48.
  return Math.round(raw * (1 - billDiscount(state, kind)));
}

/** Start the countdown to the planned Visitors Day. Called by main.js when
 *  the planning popup is dismissed, so the preparation time starts from the
 *  moment the player has actually read the heads-up. */
export function scheduleVisitorsDay() {
  if (!visitorsPlanned || visitorsDayCountdown > 0) return;
  visitorsDayCountdown = randomBetween(VISITORS_DELAY_MIN, VISITORS_DELAY_MAX);
}

/** Advance paddock life by dt seconds: deliver a printed article, fire the
 *  planned Visitors Day when due, otherwise count down to the next event (a
 *  bill, a Reunion Day, or a Visitors Day plan). */
function updatePaddockLife(dt, now, events) {
  // A paid-for story prints when it prints, whatever else is going on; the
  // dueAt is wall-clock and persisted, so it also lands on returning to the
  // game (the paper doesn't wait for you to be watching).
  if (gameState.pendingArticle && now >= gameState.pendingArticle.dueAt) {
    events.push(runArticle());
  }
  if (visitorsPlanned && visitorsDayCountdown > 0) {
    visitorsDayCountdown -= dt;
    if (visitorsDayCountdown <= 0) {
      visitorsPlanned = false;
      visitorsDayCountdown = 0;
      events.push(runVisitorsDay());
      return;
    }
  }
  // One thing at a time: no new event while a bill is up or a day is planned.
  if (pendingBill || visitorsPlanned) return;
  if (gameState.horses.length < EVENT_MIN_HORSES) return;
  eventCountdown -= dt;
  if (eventCountdown > 0) return;
  eventCountdown = randomBetween(EVENT_GAP_MIN, EVENT_GAP_MAX);

  // The season flavours which event lands: summer draws more Visitors Days,
  // winter fewer; each season leans the bill draw toward its seasonal chores
  // (seasons.js). Purely a re-weighting — the events themselves are unchanged.
  const season = currentSeason(gameState.stats.playSeconds);
  const visitorsChance = VISITORS_CHANCE * season.visitorsMult;

  const roll = Math.random();
  if (roll < visitorsChance) {
    visitorsPlanned = true; // countdown starts when the popup is dismissed
    events.push({ type: 'visitors-planning' });
    return;
  }
  // Reunion Day (issue #61): only once there are old horses TO come back —
  // it's the horses this player rehomed, with their new families in tow.
  if (roll < visitorsChance + REUNION_CHANCE && gameState.stats.horsesRehomed >= 1) {
    events.push(runReunionDay());
    return;
  }
  // A returned adoption (issue #35): rare, and only when a remembered horse
  // can actually come back. No candidate or no room: quietly a bill instead.
  if (roll < visitorsChance + REUNION_CHANCE + RETURN_CHANCE) {
    const returned = maybeReturnHorse();
    if (returned) {
      events.push(returned);
      return;
    }
  }

  // A bill — though never a second story while one is already at the printers.
  const kinds = Object.keys(BILLS).filter((k) => k !== 'journalist' || !gameState.pendingArticle);
  const kind = weightedFrom(kinds, season.billWeights);
  const fee = billFee(kind);
  // Never bill a fund that would struggle to pay: skip and look in again soon.
  if (gameState.coins < fee * BILL_AFFORD_MARGIN) {
    eventCountdown = randomBetween(EVENT_RETRY_MIN, EVENT_RETRY_MAX);
    return;
  }
  let horse = null;
  if (kind === 'vet' || kind === 'farrier' || kind === 'foal') {
    // The vet/farrier tend a named horse; the foal is born to a named mare.
    const candidates = gameState.horses.filter((h) => !isMagicalCoat(h.paletteKey));
    if (!candidates.length) return;
    horse = randomFrom(candidates);
  }
  // The vet visits for one of two reasons; the variant rides on pendingBill too
  // so paying a worming bill can count toward its badge (issue #65).
  const variant = kind === 'vet' ? (Math.random() < 0.5 ? 'checkup' : 'worming') : null;
  pendingBill = { kind, fee, variant, horseId: horse?.id ?? null };
  events.push({ type: 'bill', kind, fee, horseName: horse?.name ?? null, variant });
}

/** Pay the pending bill. Every payment lands a warm payoff: the vet and
 *  farrier leave their horse topped up (the farrier's new shoes turn heads for
 *  a while too), the hay settles the whole herd, and the fixed horse box wins
 *  a few admirers, and a new foal brings a small crowd of well-wishers.
 *  Returns { ok, kind, fee, horse, supporters } or null. */
export function acceptBill(now = Date.now()) {
  if (!pendingBill) return null;
  const { kind, fee, variant, horseId } = pendingBill;
  pendingBill = null;
  if (gameState.coins < fee) return { ok: false, kind, fee, horse: null, supporters: 0 };
  gameState.coins -= fee;
  // Badge tracking (issue #65): note the kind paid, and the care specifics.
  const st = gameState.stats;
  (st.billKindsPaid ??= []);
  if (!st.billKindsPaid.includes(kind)) st.billKindsPaid.push(kind);
  if (kind === 'farrier') st.farrierVisits = (st.farrierVisits ?? 0) + 1;
  if (kind === 'vet' && variant === 'worming') st.wormings = (st.wormings ?? 0) + 1;
  const horse = gameState.horses.find((h) => h.id === horseId) ?? null;
  let supporters = 0;
  let foalBorn = null;
  if (kind === 'vet' || kind === 'farrier') {
    if (horse) {
      horse.wellbeing = WELLBEING_MAX;
      horse.lastCaredAt = now;
    }
    if (kind === 'farrier') glowUntil = now + WANT_GLOW_DURATION * 1000;
  } else if (kind === 'hay') {
    for (const h of gameState.horses) {
      if (isMagicalCoat(h.paletteKey)) continue;
      h.wellbeing = Math.min(WELLBEING_MAX, h.wellbeing + 2);
      h.lastCaredAt = now; // well fed: the whole herd holds its shine a while
    }
  } else if (kind === 'water') {
    // Fresh troughs all round: the herd stays content and holds its shine.
    for (const h of gameState.horses) {
      if (isMagicalCoat(h.paletteKey)) continue;
      h.lastCaredAt = now;
    }
  } else if (kind === 'foal') {
    // A new foal is the best kind of advert: a small crowd comes to coo, and
    // the paddock buzzes for a while after.
    supporters = FOAL_SUPPORTERS_MIN + Math.floor(Math.random() * (FOAL_SUPPORTERS_MAX - FOAL_SUPPORTERS_MIN + 1));
    supporters = Math.round(supporters * eventDrawMultiplier(gameState)); // visitor centre (#48)
    gameState.supporters += supporters;
    gameState.stats.foalsBorn = (gameState.stats.foalsBorn ?? 0) + 1;
    glowUntil = now + FOAL_GLOW * 1000;
    // ...and, new for #48, an actual foal joins the herd: born to the mare the
    // bill named, happy and healthy, small for now. It grows up over play
    // (updateFoals) and takes a slot like any horse until it's rehomed.
    foalBorn = spawnFoal(horse, now);
  } else if (kind === 'mechanic') {
    supporters = MECHANIC_SUPPORTERS;
    gameState.supporters += MECHANIC_SUPPORTERS;
  } else if (kind === 'barn') {
    glowUntil = now + BARN_GLOW * 1000; // the smart new roof turns heads a while
  } else if (kind === 'journalist') {
    // The story goes to the printers; the payoff arrives when it runs.
    gameState.pendingArticle = {
      fee,
      dueAt: now + randomBetween(ARTICLE_DELAY_MIN, ARTICLE_DELAY_MAX) * 1000,
    };
  }
  return { ok: true, kind, fee, horse, supporters, foal: foalBorn, damName: foalBorn?.damName ?? null };
}

/** Bring a foal into the herd, born to `dam` (the mare the bill named). Arrives
 *  small, happy and healthy, with a hidden playful personality; grows up over
 *  active play (updateFoals). Returns the new foal. */
function spawnFoal(dam, now = Date.now()) {
  const herd = gameState.horses;
  const name = randomUnused(HORSE_NAMES, herd.map((h) => h.name));
  const pool = FOAL_QUIRK_POOL.length ? FOAL_QUIRK_POOL : QUIRK_TRAITS;
  const trait = randomUnused(pool, herd.map((h) => h.trait).filter(Boolean));
  const foal = createHorse({
    id: `foal-${herd.length + 1}-${now.toString(36)}`,
    name,
    paletteKey: 'foal',
    wellbeing: FOAL_WELLBEING,
    rescueOrder: herd.length + 1,
    trait,
    foal: true,
    bornAtPlay: gameState.stats.playSeconds,
    damName: dam?.name ?? null,
    bornHere: true,
    ageYears: 0, // a newborn; becomes a yearling when it grows up
  });
  herd.push(foal);
  return foal;
}

/** Growth fraction of a foal, 0 (newborn) → 1 (grown), from active play time.
 *  Returns 1 for any horse that isn't a foal. */
export function foalGrowth(horse, state = gameState) {
  if (!horse.foal) return 1;
  const born = horse.bornAtPlay ?? state.stats.playSeconds;
  return Math.max(0, Math.min(1, (state.stats.playSeconds - born) / FOAL_GROW_SECONDS));
}

/** On-screen size of a horse relative to a grown one: a foal starts small and
 *  scales up as it grows; every other horse is 1. Read by render.js. */
export function foalSizeFactor(horse, state = gameState) {
  if (!horse.foal) return 1;
  return FOAL_START_SCALE + (1 - FOAL_START_SCALE) * foalGrowth(horse, state);
}

/** Advance every foal's growth: a personality-showing beat at the halfway mark,
 *  and growing up into an adult horse (a real, collectable coat) at the end. */
function updateFoals(events) {
  for (const horse of gameState.horses) {
    if (!horse.foal) continue;
    const growth = foalGrowth(horse);
    if (!horse.foalTraitRevealed && growth >= FOAL_REVEAL_AT) {
      horse.foalTraitRevealed = true;
      recordTraitSeen(horse.trait);
      gameState.stats.traitsRevealed = (gameState.stats.traitsRevealed ?? 0) + 1;
      const near = horse.damName ? `, never far from ${horse.damName},` : '';
      events.push({
        type: 'foal-growing',
        message: `${horse.name}${near} is all legs and mischief now: turns out ${horse.name} is ${horse.trait} 🐴`,
      });
    }
    if (growth >= 1) {
      horse.foal = false;
      const coat = pickRescueCoat();
      horse.paletteKey = coat;
      horse.wellbeing = WELLBEING_MAX; // grown and thriving, ready for a home
      horse.lastCaredAt = Date.now();
      horse.ageYears = 1; // a yearling now, all grown up
      gameState.stats.foalsGrown = (gameState.stats.foalsGrown ?? 0) + 1;
      const newForCollection = collectCoat(coat);
      events.push({ type: 'foal-grown', name: horse.name, coat, damName: horse.damName, newForCollection });
    }
  }
}

/** Decline the pending bill. Always safe: nothing happens to any horse, the
 *  bill just quietly comes around again a few minutes later. */
export function declineBill() {
  pendingBill = null;
  eventCountdown = randomBetween(BILL_SNOOZE_MIN, BILL_SNOOZE_MAX);
}

/** The Sur article runs (issue #64): donations always land comfortably above
 *  the fee paid, sometimes far above — and once in a while it makes the front
 *  page. Clears the pending article. */
function runArticle() {
  const { fee } = gameState.pendingArticle;
  gameState.pendingArticle = null;
  const frontPage = Math.random() < ARTICLE_FRONT_PAGE;
  const mult = 1.5 + Math.random() * 2.5; // 1.5x–4x the fee, always a profit
  const income = Math.round(fee * (frontPage ? mult * 2.5 : mult));
  let followers = 2 + Math.floor(Math.random() * 7);
  if (frontPage) followers *= 2;
  gameState.coins += income;
  gameState.stats.totalDonated += income;
  gameState.supporters += followers;
  return { type: 'article', income, followers, frontPage };
}

/** Reunion Day (issue #61): horses this player rehomed come back to visit
 *  with their families, and some of the visitors become supporters. */
function runReunionDay() {
  const returned = Math.max(1, Math.min(gameState.stats.horsesRehomed, 2 + Math.floor(Math.random() * 3)));
  const newSupporters = Math.round(3 + returned * 2 + Math.random() * 4);
  gameState.supporters += newSupporters;
  gameState.stats.reunionsHeld = (gameState.stats.reunionsHeld ?? 0) + 1;
  return { type: 'reunion', returned, newSupporters };
}

/** A rehomed horse comes home (issue #35): drawn from its own postcard, so it's
 *  a specific remembered horse, with the adopter's name in the story. Purely a
 *  return, never a penalty: free, arrives only a little unsettled, keeps its
 *  personality (an overcome fear stays overcome), and no counter ever goes
 *  down. Returns the event, or null when no one can come back right now. */
function maybeReturnHorse(now = Date.now()) {
  if (gameState.stats.horsesRehomed < RETURN_MIN_REHOMED) return null;
  if (herdAtCapacity(gameState)) return null;
  // A candidate is a delivered postcard whose horse has never returned before
  // (checked by name, so the fresh postcard a re-adoption writes can't bring
  // them back a second time) and who isn't standing in the paddock already.
  const herdNames = new Set(gameState.horses.map((h) => h.name));
  const returnedNames = new Set((gameState.postcards ?? []).filter((pc) => pc.returned).map((pc) => pc.name));
  const candidates = (gameState.postcards ?? [])
    .filter((pc) => !pc.returned && !herdNames.has(pc.name) && !returnedNames.has(pc.name));
  if (!candidates.length) return null;
  const pc = randomFrom(candidates);
  pc.returned = true; // each horse comes back at most once
  const horse = createHorse({
    id: `ret-${gameState.horses.length + 1}-${now.toString(36)}`,
    name: pc.name,
    paletteKey: pc.paletteKey,
    wellbeing: Math.round(randomBetween(RETURN_WELLBEING_MIN, RETURN_WELLBEING_MAX)),
    rescueOrder: gameState.horses.length + 1,
    // Older postcards predate the trait field; a fresh personality then.
    trait: pc.trait ?? randomUnused(TRAITS, gameState.horses.map((h) => h.trait)),
  });
  // Growth is theirs to keep: a fear overcome in their first stay (or any fear
  // restored from before the field existed) never has to be overcome again.
  if (isFearTrait(horse.trait)) horse.fearOvercome = pc.trait ? !!pc.fearOvercome : true;
  horse.returned = true;
  gameState.horses.push(horse);
  gameState.stats.horsesReturned = (gameState.stats.horsesReturned ?? 0) + 1;
  const reason = randomFrom(RETURN_REASONS)
    .replaceAll('{name}', pc.name)
    .replaceAll('{adopter}', pc.adopter ?? 'their family');
  return { type: 'horse-returned', name: pc.name, reason };
}

/** The planned Visitors Day arrives: entry donations scale with the supporter
 *  base, the herd size, and above all how much of the herd is thriving, so the
 *  pre-day grooming ritual (and the paddock decor) genuinely pays. */
function runVisitorsDay() {
  const herd = gameState.horses.filter((h) => !isMagicalCoat(h.paletteKey));
  const thrivingFrac = herd.length
    ? herd.filter((h) => h.wellbeing >= THRIVING_AT).length / herd.length
    : 0;
  const visitors = Math.max(6, Math.round(
    (gameState.supporters * 0.6 + herd.length * 2) * (0.6 + 0.6 * thrivingFrac)
    * eventDrawMultiplier(gameState), // the visitor centre draws a bigger crowd (#48)
  ));
  const income = visitors * VISITORS_ENTRY_FEE * shareMultiplier(gameState);
  const newSupporters = Math.round(visitors * 0.05);
  gameState.coins += income;
  gameState.stats.totalDonated += income;
  gameState.supporters += newSupporters;
  gameState.stats.visitorsDaysRun = (gameState.stats.visitorsDaysRun ?? 0) + 1;
  return { type: 'visitors-day', visitors, income, newSupporters };
}

/** Dev helper (console): make the next paddock-life beat land on the next
 *  tick — a pending article or planned Visitors Day if one is armed, else a
 *  fresh event. */
export function hurryPaddockLife() {
  if (gameState.pendingArticle) gameState.pendingArticle.dueAt = Date.now();
  else if (visitorsPlanned) visitorsDayCountdown = Math.min(visitorsDayCountdown || 1, 1);
  else eventCountdown = 0;
}

// Not persisted: restarting the wait after a reload is harmless.
let lonelyCountdown = LONELY_DELAY;

// With a big thriving herd, supporters can arrive every few seconds — far
// too fast to toast individually. Arrivals accumulate silently and get one
// combined toast at most this often.
const SUPPORTER_TOAST_EVERY = 18; // seconds
let pendingSupporters = 0;
let supporterToastCooldown = 0;

// Sponsorships batch the same way, once the first has taught what they are: a
// caring spree that lands several horses at thriving together collapses into
// one toast instead of a stack. Each is still shown permanently on its card.
const SPONSOR_TOAST_EVERY = 18; // seconds
let pendingSponsors = [];
let sponsorToastCooldown = 0;

// ---- offline earnings ----
// Time the game was closed still counts: the supporters and sponsors you've
// already earned keep donating, and a few new supporters drift in. Credited at
// OFFLINE_RATE of the live rate (so sitting and playing always beats leaving),
// and only up to OFFLINE_CAP_SECONDS of it (supporters can stockpile just so
// much goodwill). Under OFFLINE_MIN_SECONDS we skip it entirely -- a quick
// tab-switch shouldn't pop a "welcome back".
export const OFFLINE_MIN_SECONDS = 30 * 60;      // ignore anything under 30 min away
export const OFFLINE_CAP_SECONDS = 4 * 60 * 60;  // credit at most 4 hours
export const OFFLINE_RATE = 0.3;                 // offline earns at a fraction of the live rate

/**
 * Credit earnings accrued while the game was closed and return a summary for
 * the welcome-back popup, or null if nothing worth showing happened (too short
 * a trip, economy not unlocked yet, or the amounts round to nothing). Mutates
 * state: adds the money and any new supporters. `now` is injectable for tests.
 */
export function collectOfflineEarnings(lastPlayedAt, now = Date.now()) {
  if (!gameState.unlocks.moneyUI || !lastPlayedAt) return null;
  const awaySeconds = (now - lastPlayedAt) / 1000;
  if (awaySeconds < OFFLINE_MIN_SECONDS) return null;

  // Cap the raw time away, then scale by the offline rate — one knob feeds both
  // the donations and the new-supporter count below.
  const seconds = Math.min(awaySeconds, OFFLINE_CAP_SECONDS) * OFFLINE_RATE;
  const sponsored = gameState.horses.filter((h) => h.sponsor).length;
  const income = (gameState.supporters * SUPPORTER_RATE * utilidadMult() + sponsored * SPONSOR_RATE) * seconds;
  // New supporters arrive at the same per-second chance the live tick rolls,
  // but never past the herd's carrying capacity. They only start donating from
  // now on — we don't back-pay their giving.
  const room = Math.max(0, supporterCapacity() - gameState.supporters);
  const newSupporters = Math.min(Math.floor(attractionPerSecond() * seconds), Math.floor(room));

  // The herd eases too while you're gone, discounted by the same offline rate
  // as the earnings and never below the floor. `drifted` counts horses that
  // slipped out of thriving, so the welcome-back note can suggest a top-up.
  // Capacity and attraction were computed above, from the herd as it was left:
  // supporters arrived over the whole trip, most of it before the ease-down.
  const drop = seconds * DRIFT_PER_SEC;
  let drifted = 0;
  for (const horse of gameState.horses) {
    if (isMagicalCoat(horse.paletteKey) || horse.wellbeing <= DRIFT_FLOOR) continue;
    const before = horse.wellbeing;
    horse.wellbeing = Math.max(DRIFT_FLOOR, horse.wellbeing - drop);
    horse.lastCaredAt = now; // a fresh hold on return, so live drift waits its grace
    if (before >= THRIVING_AT && horse.wellbeing < THRIVING_AT) drifted += 1;
  }

  if (Math.floor(income) < 1 && newSupporters < 1) return null;

  gameState.coins += income;
  gameState.stats.totalDonated += income;
  gameState.supporters += newSupporters;

  return { awaySeconds, capped: awaySeconds > OFFLINE_CAP_SECONDS, income, newSupporters, drifted };
}

/**
 * Passive simulation step. dt in seconds. Returns events to show.
 */
export function tick(dt) {
  const events = [];
  if (!gameState.unlocks.moneyUI) return events;

  // Season turnover (seasons.js): a gentle toast the moment the game-time year
  // rolls into its next season. The backdrop follows via render.js.
  const seasonIndex = seasonIndexFor(gameState.stats.playSeconds);
  if (lastSeasonIndex === null) {
    lastSeasonIndex = seasonIndex;
  } else if (seasonIndex !== lastSeasonIndex) {
    lastSeasonIndex = seasonIndex;
    events.push({ type: 'season-change', season: SEASONS[seasonIndex].key, message: SEASONS[seasonIndex].toast });
  }

  // The loneliness beat: a little after the first donation, unlock the second
  // rescue -- horses are herd animals. The "wants a friend" message is delivered
  // by the onboarding popup (main.js), which waits until the player can actually
  // afford the rescue so its arrow points at a usable button.
  if (!gameState.unlocks.rescue && gameState.horses.length === 1) {
    lonelyCountdown -= dt;
    if (lonelyCountdown <= 0) {
      gameState.unlocks.rescue = true;
      gameState.milestones.lonelyShown = true;
    }
  }

  // supporters donate steadily (a touch more once Utilidad Pública is won);
  // sponsored horses bring extra committed income
  const sponsored = gameState.horses.filter((h) => h.sponsor).length;
  const income = (gameState.supporters * SUPPORTER_RATE * utilidadMult() + sponsored * SPONSOR_RATE) * dt;
  gameState.coins += income;
  gameState.stats.totalDonated += income;

  // Reaching "thriving" earns a horse a sponsor: a permanent income bump
  // tied to that horse. This is the payoff that makes each rescue an
  // investment rather than just more work. Checked here (not on the care
  // click) so it also catches horses that are already thriving.
  for (const horse of gameState.horses) {
    if (horse.foal) continue; // a foal earns its sponsor once it's grown
    const sponsorThreshold = horse.rescueOrder === 1 ? FIRST_SPONSOR_AT : SPONSOR_AT;
    if (!horse.sponsor && horse.wellbeing >= sponsorThreshold) {
      horse.sponsor = randomFrom(SUPPORTER_NAMES);
      gameState.supporters += 1;
      if (!gameState.milestones.firstSponsorship) {
        // The very first sponsorship explains what it means, in its own toast.
        gameState.milestones.firstSponsorship = true;
        events.push({
          type: 'sponsor',
          message: `${horse.sponsor} is so taken with ${horse.name} that they've set up a sponsorship: steady support, every month 💛`,
        });
      } else {
        // Later ones batch (emitted below) so a spree collapses into one toast.
        pendingSponsors.push({ supporter: horse.sponsor, horseName: horse.name });
      }
    }
  }

  // A fear horse recovered past the threshold has its breakthrough: the day it
  // walks right past the thing that scared it. Checked here (like sponsors) so
  // every path up counts — care taps, the vet topping a horse to 100, all of
  // it. Fires once per horse; the story fills the share meter on the spot,
  // because a recovery like this is exactly what you'd post.
  for (const horse of gameState.horses) {
    const traitInfo = TRAIT_INFO[horse.trait];
    if (traitInfo?.kind !== 'fear' || horse.fearOvercome || horse.wellbeing < FEAR_OVERCOME_AT) continue;
    horse.fearOvercome = true;
    gameState.stats.fearsOvercome = (gameState.stats.fearsOvercome ?? 0) + 1;
    gameState.supporters += FEAR_BREAKTHROUGH_SUPPORTERS;
    gameState.lastSharedAt = 0; // share meter: instantly full
    events.push({
      type: 'breakthrough',
      supporters: FEAR_BREAKTHROUGH_SUPPORTERS,
      message: `💛 ${horse.name} ${traitInfo.breakthrough}. Not scared anymore!`,
    });
  }

  sponsorToastCooldown = Math.max(0, sponsorToastCooldown - dt);
  if (pendingSponsors.length > 0 && sponsorToastCooldown === 0) {
    const n = pendingSponsors.length;
    const first = pendingSponsors[0];
    events.push({
      type: 'sponsor',
      message: n === 1
        ? `${first.supporter} has sponsored ${first.horseName} 💛`
        : `${first.supporter} and ${n - 1} other${n > 2 ? 's' : ''} have set up sponsorships 💛`,
    });
    pendingSponsors = [];
    sponsorToastCooldown = SPONSOR_TOAST_EVERY;
  }

  // happy horses attract new supporters — but only up to the herd's capacity,
  // so a following (and its income) plateaus rather than growing without bound.
  if (Math.random() < attractionPerSecond() * attractionFalloff() * dt) {
    gameState.supporters += 1;
    pendingSupporters += 1;
  }

  supporterToastCooldown = Math.max(0, supporterToastCooldown - dt);
  if (pendingSupporters > 0 && supporterToastCooldown === 0) {
    // Early on, named "X started following" toasts teach the mechanic. Once the
    // first sponsorship lands (the economy has clearly clicked), these would
    // just be noise amid the richer beats, so they step down to a subtle "+N"
    // pop on the supporters chip instead. The HUD count climbs either way.
    if (gameState.milestones.firstSponsorship) {
      events.push({ type: 'supporter-quiet', count: pendingSupporters });
    } else {
      const name = randomFrom(SUPPORTER_NAMES);
      events.push({
        type: 'supporter',
        message: pendingSupporters === 1
          ? `${name} started following the rescue 💛`
          : `${name} and ${pendingSupporters - 1} other${pendingSupporters > 2 ? 's' : ''} started following the rescue 💛`,
      });
    }
    pendingSupporters = 0;
    supporterToastCooldown = SUPPORTER_TOAST_EVERY;
  }

  updateDrift(dt, Date.now(), events); // the gentle-upkeep ease-down
  updateFoals(events); // foals grow up over play (issue #48)
  maybeOfferRehome(dt, events);
  checkMilestones(events);
  updateWants(dt, Date.now()); // the little-needs cycle (bubbles drawn by main)
  updatePaddockLife(dt, Date.now(), events); // bills & Visitors Day story cards

  return events;
}

/** Ease long-untended horses back toward the floor (see the gentle-upkeep
 *  tuning above). Pushes a one-time intro event the first time a horse drifts
 *  out of "thriving", so the mechanic explains itself the moment it shows. */
function updateDrift(dt, now, events) {
  for (const horse of gameState.horses) {
    if (horse.foal) continue; // foals are doted on and never droop
    if (isMagicalCoat(horse.paletteKey) || horse.wellbeing <= DRIFT_FLOOR) continue;
    horse.lastCaredAt ??= now; // self-heal a save that predates the field
    // The hay barn keeps a well-fed herd steady longer (issue #48).
    if (now - horse.lastCaredAt < DRIFT_GRACE * driftGraceMultiplier(gameState) * 1000) continue;
    const before = horse.wellbeing;
    horse.wellbeing = Math.max(DRIFT_FLOOR, horse.wellbeing - DRIFT_PER_SEC * dt);
    if (!gameState.milestones.driftIntroShown && before >= THRIVING_AT && horse.wellbeing < THRIVING_AT) {
      gameState.milestones.driftIntroShown = true;
      events.push({
        type: 'drift-intro',
        message: `${horse.name} could do with a top-up: horses love routine, and a few taps keep a thriving horse thriving 💛`,
      });
    }
  }
}

/** Occasionally offer a thriving horse a forever home, once the herd is large
 *  enough that one can be spared. One offer at a time. */
function maybeOfferRehome(dt, events) {
  if (pendingRehome || gameState.horses.length <= REHOME_MIN_HERD) return;
  rehomeCountdown -= dt;
  if (rehomeCountdown > 0) return;
  rehomeCountdown = randomBetween(REHOME_GAP_MIN, REHOME_GAP_MAX);
  // Magical gift horses are permanent residents; foals aren't grown yet; and a
  // kept horse (issue #83) lives here for good, so it's never offered a home.
  const thriving = gameState.horses.filter(isAdoptable);
  if (!thriving.length) return; // no one ready; try again next interval
  const horse = randomFrom(thriving);
  const income = rehomeIncome();
  pendingRehome = { horseId: horse.id, income };
  events.push({ type: 'rehome-offer', horseName: horse.name, income, bornHere: horse.bornHere, returned: horse.returned });
}

/** A horse the rescue could find a forever home: thriving, and not a magical
 *  gift horse, a foal, or a kept permanent resident. */
function isAdoptable(h) {
  return h.wellbeing >= THRIVING_AT && !isMagicalCoat(h.paletteKey) && !h.foal && !h.kept;
}

// ---- the sanctuary: permanent residents (issue #83) ----
// Once the Sanctuary field is built, a paddock's worth of horses can be kept
// for good: they live at the rescue and are never offered for rehoming. The cap
// keeps the rehoming loop alive rather than letting the whole herd be kept.
export const SANCTUARY_CAP = PADDOCK_CAP;

/** Whether keeping horses is unlocked yet (the Sanctuary field is built). */
export function canKeep(state = gameState) {
  return hasFacility(state, 'sanctuary-field');
}

/** How many horses are currently kept as permanent residents. */
export function keptCount(state = gameState) {
  return state.horses.filter((h) => h.kept).length;
}

/** Mark a horse a permanent resident, or release it back to the adoptable pool.
 *  Honours the sanctuary cap when keeping. Returns { ok, reason?, horse? }. */
export function setKept(horseId, kept, state = gameState) {
  const horse = state.horses.find((h) => h.id === horseId);
  if (!horse) return { ok: false, reason: 'missing' };
  if (kept) {
    if (!canKeep(state)) return { ok: false, reason: 'locked' };
    if (!horse.kept && keptCount(state) >= SANCTUARY_CAP) return { ok: false, reason: 'full' };
  }
  horse.kept = !!kept;
  // If this horse had a rehome offer in the air, keeping it retires that offer
  // so a stale popup can't adopt out a horse the player just decided to keep.
  if (kept && pendingRehome && pendingRehome.horseId === horseId) pendingRehome = null;
  return { ok: true, horse };
}

/** Player-initiated rehoming: ask around for a forever home right now (the
 *  lever offered when the paddocks are full) instead of waiting for the timer.
 *  Same offer flow as maybeOfferRehome; returns the rehome-offer event to
 *  process, or null if no horse can be spared / one is already on offer. */
export function requestRehome() {
  if (pendingRehome || gameState.horses.length <= REHOME_MIN_HERD) return null;
  const thriving = gameState.horses.filter(isAdoptable);
  if (!thriving.length) return null;
  const horse = randomFrom(thriving);
  const income = rehomeIncome();
  pendingRehome = { horseId: horse.id, income };
  return { type: 'rehome-offer', horseName: horse.name, income, bornHere: horse.bornHere, returned: horse.returned };
}

/** Reward + donate milestones for the rescue and rehome counters. Bonuses land
 *  in the fund immediately; the popup just announces them. */
function checkMilestones(events) {
  const m = gameState.milestones;
  for (const n of RESCUE_MILESTONES) {
    if (gameState.stats.horsesRescued >= n && !m.rescueRewardsGiven.includes(n)) {
      m.rescueRewardsGiven.push(n);
      const gift = RESCUE_GIFTS[n];
      if (gift) {
        // A milestone with a magical gift horse instead of cash.
        const horse = grantGiftHorse(gift.coat, gift.name, gift.trait);
        if (horse) events.push({ type: 'gift-horse', count: n, coat: gift.coat, name: horse.name });
      } else {
        const bonus = milestoneBonus();
        gameState.coins += bonus;
        events.push({ type: 'rescue-milestone', count: n, bonus });
      }
    }
  }
  if (gameState.stats.horsesRescued >= DONATE_MILESTONE && !m.donateMilestoneShown && !m.donateOptOut) {
    m.donateMilestoneShown = true;
    events.push({ type: 'donate-milestone', count: DONATE_MILESTONE });
  }
  // Utilidad Pública (issue #62): once the rescue is established, official
  // recognition arrives — one popup, and supporter donations gain 10% forever.
  // Deliberately not backfilled quietly for returning players: it's a reward
  // beat, so anyone already past the mark earns the popup on their next tick.
  if (gameState.stats.horsesRescued >= UTILIDAD_AT && !m.utilidadShown) {
    m.utilidadShown = true;
    events.push({ type: 'utilidad' });
  }
  for (const n of REHOME_MILESTONES) {
    if (gameState.stats.horsesRehomed >= n && !m.rehomeRewardsGiven.includes(n)) {
      m.rehomeRewardsGiven.push(n);
      const bonus = milestoneBonus();
      gameState.coins += bonus;
      events.push({ type: 'rehome-milestone', count: n, bonus });
    }
  }
  // Supporter-count milestones: a rare celebratory toast (no cash) that marks
  // growth now that per-arrival follow toasts have tapered off.
  for (const n of SUPPORTER_MILESTONES) {
    if (gameState.supporters >= n && !m.supporterMilestonesShown.includes(n)) {
      m.supporterMilestonesShown.push(n);
      events.push({ type: 'supporter-milestone', count: n });
    }
  }
}
