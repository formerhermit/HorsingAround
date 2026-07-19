// game.js — game rules and tuning. No DOM access here.
//
// The economy models how a real rescue works: care raises wellbeing,
// well-cared-for horses attract supporters, supporters donate money,
// and money pays for real costs. Care never generates money directly.

import { gameState, createHorse } from './state.js';
import { PALETTE_KEYS } from './horse.js';
import { attractionBonus, shareMultiplier } from './shop.js';

// ---- tuning ----
export const CARE_GAIN = 2;          // wellbeing per care click
export const WELLBEING_MAX = 100;
export const CONTENT_AT = 80;        // "content" — triggers the first donation
export const FIRST_DONATION = 12;    // € from the very first supporter
export const SUPPORTER_RATE = 0.15;  // € per supporter per second
export const RESCUE_BASE_COST = 25;  // second horse; later rescues escalate
export const RESCUE_COST_FACTOR = 1.8;
export const TRAIT_REVEAL_AT = 40;   // wellbeing at which personality shows
export const SPONSOR_AT = 95;        // "thriving" — earns the horse a sponsor
export const FIRST_SPONSOR_AT = 88;  // Biscuit sponsors a touch earlier, as its own beat
export const SPONSOR_RATE = 0.4;     // € per sponsored horse per second
export const SHARE_BASE = 1;         // € per shared update...
export const SHARE_PER_SUPPORTER = 0.3; // ...plus this per supporter
const LONELY_DELAY = 14;             // seconds after first donation before the loneliness beat

// Chance per second that a new supporter notices the rescue. Every horse
// contributes according to its own wellbeing and the contributions add up,
// so each recovered horse permanently speeds up supporter growth — and a
// fresh scruffy arrival adds nothing, but no longer drags the rest down.
function attractionPerSecond() {
  const fromHorses = gameState.horses.reduce((sum, h) => {
    if (h.wellbeing >= 95) return sum + 0.025;
    if (h.wellbeing >= 70) return sum + 0.015;
    if (h.wellbeing >= 50) return sum + 0.006;
    return sum;
  }, 0);
  // Dressed-up horses turn heads too — wardrobe items add a flat bonus.
  return fromHorses + attractionBonus(gameState);
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
  'Lola (Gabbi)', 'Borrego', 'Margarita', 'Bella', 'Brisa', 'Brava',
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

  if (horse.wellbeing >= WELLBEING_MAX) {
    return { gain: 0, message: `${horse.name} is thriving ♥`, events: [] };
  }

  const before = horse.wellbeing;
  horse.wellbeing = Math.min(WELLBEING_MAX, horse.wellbeing + CARE_GAIN);

  const events = [];
  // Personality emerges as a horse recovers enough to relax. Assign one here
  // if the horse doesn't have it yet (Biscuit starts without one) so this beat
  // lands early, well before the donation/rescue/sponsor beats.
  if (before < TRAIT_REVEAL_AT && horse.wellbeing >= TRAIT_REVEAL_AT) {
    horse.trait ??= randomUnused(TRAITS, gameState.horses.map((h) => h.trait).filter(Boolean));
    events.push({
      type: 'trait',
      message: `${horse.name} is starting to relax — turns out ${horse.name} is ${horse.trait} 🐴`,
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

  return { gain: CARE_GAIN, message: randomFrom(CARE_MESSAGES), events };
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
 *  paddock-space and hay-budget gates on top. */
export function rescueCost(state = gameState) {
  return Math.round(RESCUE_BASE_COST * Math.pow(RESCUE_COST_FACTOR, state.horses.length - 1));
}

/**
 * Spend rescue funds to bring in a new horse, arriving in worse condition
 * than Biscuit did. Returns { ok, horse, events }.
 */
export function rescueHorse() {
  const cost = rescueCost();
  if (gameState.coins < cost) return { ok: false, horse: null, events: [] };

  gameState.coins -= cost;
  const herd = gameState.horses;
  const name = randomUnused(HORSE_NAMES, herd.map((h) => h.name));
  const horse = createHorse({
    // rescueOrder makes this unique even for rescues in the same millisecond
    id: `horse-${herd.length + 1}-${Date.now().toString(36)}`,
    name,
    paletteKey: randomFrom(PALETTE_KEYS),
    wellbeing: 4 + Math.floor(Math.random() * 4), // 4–7: rougher than Biscuit's 12
    rescueOrder: herd.length + 1,
    trait: randomUnused(TRAITS, herd.map((h) => h.trait)),
  });
  herd.push(horse);
  gameState.stats.horsesRescued += 1;

  return {
    ok: true,
    horse,
    events: [{
      type: 'rescue',
      message: `${name} arrives — thin, wary, and keeping to the far end of the paddock. Time to get to work 🐴`,
    }],
  };
}

// Not persisted: restarting the wait after a reload is harmless.
let lonelyCountdown = LONELY_DELAY;

// With a big thriving herd, supporters can arrive every few seconds — far
// too fast to toast individually. Arrivals accumulate silently and get one
// combined toast at most this often.
const SUPPORTER_TOAST_EVERY = 18; // seconds
let pendingSupporters = 0;
let supporterToastCooldown = 0;

/**
 * Passive simulation step. dt in seconds. Returns events to show.
 */
export function tick(dt) {
  const events = [];
  if (!gameState.unlocks.moneyUI) return events;

  // The loneliness beat: a little after the first donation, motivate the
  // second rescue — horses are herd animals.
  if (!gameState.unlocks.rescue && gameState.horses.length === 1) {
    lonelyCountdown -= dt;
    if (lonelyCountdown <= 0) {
      gameState.unlocks.rescue = true;
      gameState.milestones.lonelyShown = true;
      const biscuit = gameState.horses[0];
      // Single toast now -- Biscuit's personality was already revealed earlier
      // (at TRAIT_REVEAL_AT) rather than bundled in here.
      events.push({
        type: 'milestone',
        message: `${biscuit.name} keeps looking down the lane. Horses are herd animals — no horse should be alone. Maybe the rescue fund can help someone else too?`,
      });
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
      // The first sponsorship explains what it means; once the player
      // knows, later ones just announce themselves.
      const message = gameState.milestones.firstSponsorship
        ? `${horse.sponsor} has sponsored ${horse.name} 💛`
        : `${horse.sponsor} is so taken with ${horse.name} that they've set up a sponsorship — steady support, every month 💛`;
      gameState.milestones.firstSponsorship = true;
      events.push({ type: 'sponsor', message });
    }
  }

  // happy horses attract new supporters — each one adds pull
  if (Math.random() < attractionPerSecond() * dt) {
    gameState.supporters += 1;
    pendingSupporters += 1;
  }

  supporterToastCooldown = Math.max(0, supporterToastCooldown - dt);
  if (pendingSupporters > 0 && supporterToastCooldown === 0) {
    const name = randomFrom(SUPPORTER_NAMES);
    events.push({
      type: 'supporter',
      message: pendingSupporters === 1
        ? `${name} started following the rescue 💛`
        : `${name} and ${pendingSupporters - 1} other${pendingSupporters > 2 ? 's' : ''} started following the rescue 💛`,
    });
    pendingSupporters = 0;
    supporterToastCooldown = SUPPORTER_TOAST_EVERY;
  }

  return events;
}
