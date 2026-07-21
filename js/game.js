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
import { attractionBonus, shareMultiplier, paddockCap, reclaimOrphanedDecor, SHOP_ITEMS, paddockHasRoomFor } from './shop.js';

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
export const SHARE_BASE = 1;         // € per shared update...
export const SHARE_PER_SUPPORTER = 0.3; // ...plus this per supporter
export const TIP_CHANCE = 0.02;      // ~1 in 50 care clicks draws a spontaneous tip
export const TIP_MIN = 2;            // € range a watching supporter chips in on the spot
export const TIP_MAX = 5;
export const THRIVING_AT = 95;       // wellbeing for "thriving" (matches wellbeingLabel)
export const FRONT_ROW = 3;          // horses shown up close; the rest fall to the back row (matches render.js)
const LONELY_DELAY = 14;             // seconds after first donation before the loneliness beat

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
  return herdPull() * SUPPORTER_CAP_PER_PULL;
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

// Silly-as-seasoning personality traits. Phrased to follow "<name> is ...".
const TRAITS = [
  'afraid of buckets',
  'dramatic about puddles',
  'prone to falling asleep on your foot',
  'obsessed with the hose',
  'suspicious of butterflies',
  'a dedicated shoelace-nibbler',
  'very protective of the hay',
  'convinced the wheelbarrow is a rival',
  'a secret carrot hoarder',
  'convinced apples grow specifically for them',
  'unreasonably picky about hay quality',
  'willing to trade dignity for a mint',
  'terrified of plastic bags',
  'deeply suspicious of umbrellas',
  'nervous around anything shiny',
  'unsettled by their own shadow at dusk',
  'wary of the sound of velcro',
  'the self-appointed paddock lookout',
  'a shameless attention hog',
  'oddly formal with new arrivals',
  'fiercely loyal to whoever groomed them first',
  'the gossip, always leaning over the fence',
  'vain about their mane',
  'ticklish behind the ears',
  'an enthusiastic napper',
  'stubborn about literally everything',
  'convinced every fence post is new',
  'allergic to being told what to do',
  'nosy about anything in your pockets',
];

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
  const crit = !maxed && Math.random() < CRIT_CHANCE;
  const gain = maxed ? 0 : (crit ? CRIT_GAIN : CARE_GAIN);
  // Captured before the first-supporter unlock flips it: the click that first
  // unlocks the money side shouldn't also roll a tip on the same tap.
  const moneyUnlocked = gameState.unlocks.moneyUI;

  const before = horse.wellbeing;
  horse.wellbeing = Math.min(WELLBEING_MAX, horse.wellbeing + gain);

  const events = [];
  // Personality emerges as a horse recovers enough to relax. Assign one here
  // if the horse doesn't have it yet (Biscuit starts without one) so this beat
  // lands early, well before the donation/rescue/sponsor beats.
  if (before < TRAIT_REVEAL_AT && horse.wellbeing >= TRAIT_REVEAL_AT) {
    horse.trait ??= randomUnused(TRAITS, gameState.horses.map((h) => h.trait).filter(Boolean));
    // The first couple of these introduce the mechanic in full; after that the
    // "starting to relax" preamble just repeats, so trim to the punchline.
    const shown = gameState.stats.traitsRevealed ?? 0;
    gameState.stats.traitsRevealed = shown + 1;
    events.push({
      type: 'trait',
      message: shown < 2
        ? `${horse.name} is starting to relax — turns out ${horse.name} is ${horse.trait} 🐴`
        : `Turns out ${horse.name} is ${horse.trait} 🐴`,
    });
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

  const message = maxed
    ? `${horse.name} is thriving ♥`
    : (crit ? randomFrom(CRIT_MESSAGES) : randomFrom(CARE_MESSAGES));

  return { gain, crit, message, tip, events };
}

/** € one shared update brings in at current supporter count. A nicer-looking
 *  paddock makes every post perform better — decor items multiply this. */
export function shareValue(state = gameState) {
  return (SHARE_BASE + SHARE_PER_SUPPORTER * state.supporters) * shareMultiplier(state);
}

/**
 * The active income lever: share an update about the horses and supporters
 * chip in. Care clicks never mint money — fundraising asks people, and the
 * more supporters you've earned, the more each ask brings in.
 */
export function shareUpdate() {
  const amount = shareValue();
  gameState.coins += amount;
  gameState.stats.totalDonated += amount;
  return { amount };
}

/** Cost of the next rescue. Escalates with herd size; phase 3 will add
 *  paddock-space and hay-budget gates on top. Magical gift horses (the unicorn,
 *  rainbow and golden) are gifts, not rescues, so they don't count toward it. */
export function rescueCost(state = gameState) {
  const rescued = state.horses.filter((h) => !isMagicalCoat(h.paletteKey)).length;
  return Math.round(RESCUE_BASE_COST * Math.pow(RESCUE_COST_FACTOR, rescued - 1));
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
  const cost = rescueCost();
  if (gameState.coins < cost) return { ok: false, horse: null, events: [] };
  // Don't send a still-struggling horse to the back row to make space.
  if (rescueNeedsCareFirst()) return { ok: false, horse: null, reason: 'needs-care', events: [] };

  gameState.coins -= cost;
  const herd = gameState.horses;
  const name = randomUnused(HORSE_NAMES, herd.map((h) => h.name));
  const coat = pickRescueCoat();
  const horse = createHorse({
    // rescueOrder makes this unique even for rescues in the same millisecond
    id: `horse-${herd.length + 1}-${Date.now().toString(36)}`,
    name,
    paletteKey: coat,
    wellbeing: 4 + Math.floor(Math.random() * 4), // 4–7: rougher than Biscuit's 12
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
  if (rareLabel) {
    message = `✨ ${name} arrives, thin and wary, but look closer: a rare ${rareLabel}! What a treasure 🌟`;
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
  return Math.max(1, Math.round(rescueCost(state) * 0.1));
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
  // The horse goes to its new home, but its clothes stay: anything it was
  // wearing comes off into the stores to re-use on another horse.
  const leftBehind = horse.wardrobe.length > 0;
  for (const id of horse.wardrobe) {
    gameState.shop.stock[id] = (gameState.shop.stock[id] ?? 0) + 1;
  }
  horse.wardrobe = [];
  // The herd just shrank -- a paddock may have vanished; rescue its decor.
  reclaimOrphanedDecor(gameState);
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
  const templates = horse.trait ? POSTCARD_TEMPLATES : POSTCARD_TEMPLATES_NOTRAIT;
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
const WANT_MIN_GAP = 60;          // seconds between wants, once none is active
const WANT_MAX_GAP = 150;
const WANT_TTL = 60;              // a want fades if untended this long
const WANT_MIN_WELLBEING = 60;   // only content-ish horses get little luxuries
const WANT_SUPPORTER_BURST = 3;  // supporters gained on fulfilling one
const WANT_GLOW_DURATION = 60;   // seconds the attraction glow lasts
const WANT_GLOW_MULT = 2;        // attraction multiplier during the glow

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

// Wants land on horses in the home paddock (the newest paddockCap(), both rows,
// all visible on the default view) that are content enough to fancy a little
// luxury. Keying off the whole home chunk (not just the front row) matters:
// the front row is usually the freshly-rescued scruffy arrivals, while the
// recovered horses that actually want treats sit just behind them.
function eligibleWantHorses() {
  return gameState.horses.slice(-paddockCap()).filter((h) => h.wellbeing >= WANT_MIN_WELLBEING);
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
  activeWant = {
    horseId: randomFrom(candidates).id,
    need: randomFrom(NEEDS),
    expiresAt: now + WANT_TTL * 1000,
  };
}

/** Tend the active want if this is the horse that wanted something. Grants the
 *  supporter burst + glow and returns { need, supporters } for feedback, else
 *  null (so a normal care tap is unaffected). */
export function fulfilWant(horseId, now = Date.now()) {
  if (!activeWant || activeWant.horseId !== horseId) return null;
  const { need } = activeWant;
  activeWant = null;
  wantCountdown = randomBetween(WANT_MIN_GAP, WANT_MAX_GAP);
  gameState.supporters += WANT_SUPPORTER_BURST;
  glowUntil = now + WANT_GLOW_DURATION * 1000;
  return { need, supporters: WANT_SUPPORTER_BURST };
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
  const income = (gameState.supporters * SUPPORTER_RATE + sponsored * SPONSOR_RATE) * seconds;
  // New supporters arrive at the same per-second chance the live tick rolls,
  // but never past the herd's carrying capacity. They only start donating from
  // now on — we don't back-pay their giving.
  const room = Math.max(0, supporterCapacity() - gameState.supporters);
  const newSupporters = Math.min(Math.floor(attractionPerSecond() * seconds), Math.floor(room));

  if (Math.floor(income) < 1 && newSupporters < 1) return null;

  gameState.coins += income;
  gameState.stats.totalDonated += income;
  gameState.supporters += newSupporters;

  return { awaySeconds, capped: awaySeconds > OFFLINE_CAP_SECONDS, income, newSupporters };
}

/**
 * Passive simulation step. dt in seconds. Returns events to show.
 */
export function tick(dt) {
  const events = [];
  if (!gameState.unlocks.moneyUI) return events;

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

  // supporters donate steadily; sponsored horses bring extra committed income
  const sponsored = gameState.horses.filter((h) => h.sponsor).length;
  const income = (gameState.supporters * SUPPORTER_RATE + sponsored * SPONSOR_RATE) * dt;
  gameState.coins += income;
  gameState.stats.totalDonated += income;

  // Reaching "thriving" earns a horse a sponsor: a permanent income bump
  // tied to that horse. This is the payoff that makes each rescue an
  // investment rather than just more work. Checked here (not on the care
  // click) so it also catches horses that are already thriving.
  for (const horse of gameState.horses) {
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

  maybeOfferRehome(dt, events);
  checkMilestones(events);
  updateWants(dt, Date.now()); // the little-needs cycle (bubbles drawn by main)

  return events;
}

/** Occasionally offer a thriving horse a forever home, once the herd is large
 *  enough that one can be spared. One offer at a time. */
function maybeOfferRehome(dt, events) {
  if (pendingRehome || gameState.horses.length <= REHOME_MIN_HERD) return;
  rehomeCountdown -= dt;
  if (rehomeCountdown > 0) return;
  rehomeCountdown = randomBetween(REHOME_GAP_MIN, REHOME_GAP_MAX);
  // Magical gift horses are permanent residents, never offered for rehoming.
  const thriving = gameState.horses.filter((h) => h.wellbeing >= THRIVING_AT && !isMagicalCoat(h.paletteKey));
  if (!thriving.length) return; // no one ready; try again next interval
  const horse = randomFrom(thriving);
  const income = rehomeIncome();
  pendingRehome = { horseId: horse.id, income };
  events.push({ type: 'rehome-offer', horseName: horse.name, income });
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
