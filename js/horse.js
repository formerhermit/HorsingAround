// horse.js — the horse figure.
//
// EXPERIMENT (horse-art-experiment branch): the horse is now a raster image
// per coat + emotional state, rather than the parameterised SVG. Wellbeing
// picks one of three states (sad / neutral / happy), so a horse visibly cheers
// up as it's cared for. Costumes are an SVG layer overlaid on top of the image
// in the image's own 500x480 coordinate space (see costumeMarkup).

// The common coats. Kept exported as PALETTE_KEYS so game.js can pick one
// at random for an ordinary rescue. Donkeys share the horses' common pool.
export const PALETTE_KEYS = ['bay', 'brown', 'grey', 'palomino', 'white', 'brown-donkey', 'grey-donkey'];

// Rare coats: never in the common random pool. They only appear via the low
// per-rescue odds in game.js. The unicorn is rarer still (donation-only).
export const RARE_COATS = ['spotty', 'red-boy', 'piebald', 'piebald-donkey', 'zebra'];

// Magical gift horses: earned, not rescued. They arrive thriving and stay
// permanent residents -- never counted toward a rescue's cost, never offered
// for adoption, and never dressed up in the shop. They all shimmer.
export const MAGICAL_COATS = ['unicorn', 'rainbow', 'golden'];
const MAGICAL_SET = new Set(MAGICAL_COATS);
export function isMagicalCoat(key) {
  return MAGICAL_SET.has(key);
}

const SPECIAL_COATS = new Set([...RARE_COATS, ...MAGICAL_COATS]);
const KNOWN_COATS = new Set([...PALETTE_KEYS, ...RARE_COATS, ...MAGICAL_COATS]);

/** A rare or magical coat, i.e. one that gets the shiny shimmer. */
export function isShinyCoat(horse) {
  return SPECIAL_COATS.has(horse.paletteKey);
}

// Every collectable coat, for the collection book. `rarity` groups the stamps;
// `mystery` keeps a locked stamp fully hidden (a "?") instead of the usual
// dimmed-ghost preview; `unlock` is a short hint shown under a locked stamp so
// a player knows how to earn it. Add coats here (with art) to grow the collection.
export const COAT_CATALOG = [
  { id: 'bay',            name: 'Bay',           rarity: 'common' },
  { id: 'brown',          name: 'Brown',         rarity: 'common' },
  { id: 'grey',           name: 'Grey',          rarity: 'common' },
  { id: 'palomino',       name: 'Palomino',      rarity: 'common' },
  { id: 'white',          name: 'Snowy',         rarity: 'common' },
  { id: 'brown-donkey',   name: 'Brown donkey',  rarity: 'common' },
  { id: 'grey-donkey',    name: 'Grey donkey',   rarity: 'common' },
  { id: 'spotty',         name: 'Spotted',       rarity: 'rare' },
  { id: 'red-boy',        name: 'Chestnut',      rarity: 'rare' },
  { id: 'piebald',        name: 'Piebald',       rarity: 'rare', mystery: true },
  { id: 'piebald-donkey', name: 'Piebald donkey', rarity: 'rare' },
  { id: 'zebra',          name: 'Zebra',         rarity: 'rare', mystery: true },
  { id: 'unicorn',        name: 'Unicorn',       rarity: 'magical', unlock: 'Donate to ARCH' },
  { id: 'rainbow',        name: 'Rainbow',       rarity: 'magical', unlock: 'Rescue 50 horses' },
  { id: 'golden',         name: 'Golden',        rarity: 'magical', unlock: 'Rescue 100 horses' },
];

// Normalised image canvas (see scripts that build assets/horses/*). Costume
// coordinates live in this same space.
export const FIGURE_W = 500;
export const FIGURE_H = 480;

/** Emotional state from wellbeing — drives which image is shown. */
export function wellbeingState(wellbeing) {
  if (wellbeing >= 67) return 'happy';
  if (wellbeing >= 34) return 'neutral';
  return 'sad';
}

function coatOf(horse) {
  return KNOWN_COATS.has(horse.paletteKey) ? horse.paletteKey : 'brown';
}

/** Path to the image for a horse's current coat + state. */
export function horseImageSrc(horse) {
  return `assets/horses/${coatOf(horse)}-${wellbeingState(horse.wellbeing)}.png`;
}

// Where the ear flower sits (the base of the forward ear) depends on the
// animal's build: donkeys have taller ears and stand lower in the frame, so a
// horse-tuned anchor floats above their heads. Coats not listed use the horse
// default. All coats of one animal share a template, so they share an anchor.
const EAR_FLOWER_ANCHOR = {
  'brown-donkey':   { cx: 392, cy: 120 },
  'grey-donkey':    { cx: 392, cy: 120 },
  'piebald-donkey': { cx: 392, cy: 120 },
  'zebra':          { cx: 394, cy: 84 },
  // the rare-coat horses have fluffier forelocks and sit a touch lower
  'red-boy':        { cx: 396, cy: 105 },
  'piebald':        { cx: 400, cy: 110 },
  'spotty':         { cx: 399, cy: 110 },
};
const DEFAULT_EAR_FLOWER = { cx: 392, cy: 70 };

/**
 * Costume overlay markup, in the image's 500x480 space. Split by where it sits
 * so head-worn pieces could be tuned independently of leg/back pieces.
 * Coordinates are re-tuned for the raster horse (task in progress) — empty for
 * now so horses render bare until the overlay is dialled in.
 */
function costumeMarkup(wardrobe = [], coat = 'bay') {
  let m = '';
  if (wardrobe.includes('scarf')) {
    // band spanning the whole neck from the mane edge (~x305) to the throat
    // (~x390), with a knotted tail hanging at the front of the throat
    m += `<path d="M300,188 Q345,179 390,179 Q401,191 397,203 Q394,213 388,216 Q345,220 303,214 Q295,202 300,188 Z" fill="#D9534F"/>`;
    m += `<path d="M382,213 Q378,239 385,259 Q397,241 396,211 Z" fill="#C0392B"/>`;
  }
  if (wardrobe.includes('ear-flower')) {
    // a small daisy tucked at the base of the forward ear
    const { cx, cy } = EAR_FLOWER_ANCHOR[coat] ?? DEFAULT_EAR_FLOWER;
    const petals = [[cx, cy - 10], [cx + 9.5, cy - 3.1], [cx + 5.9, cy + 8.1], [cx - 5.9, cy + 8.1], [cx - 9.5, cy - 3.1]];
    for (const [px, py] of petals) m += `<circle cx="${px}" cy="${py}" r="6.5" fill="#A971D6"/>`;
    m += `<circle cx="${cx}" cy="${cy}" r="5" fill="#F1C40F"/>`;
  }
  if (wardrobe.includes('forelock-bow')) {
    // a ribbon bow tied in the forelock, between the ears on the forehead
    m += `<path d="M412,84 L389,74 Q383,84 389,94 Z" fill="#F7CD3A"/>`;
    m += `<path d="M412,84 L435,74 Q441,84 435,94 Z" fill="#F7CD3A"/>`;
    m += `<rect x="406" y="77" width="12" height="14" rx="4" fill="#E0A81E"/>`;
  }
  if (wardrobe.includes('saddle-blanket')) {
    // a cloth draped over the back behind the withers, hanging down the barrel
    m += `<path d="M175,200 Q230,189 278,195 Q288,199 286,238 Q284,272 277,282 Q228,289 179,283 Q170,273 168,238 Q166,199 175,200 Z" fill="#3F7FD6"/>`;
    // light trim stripe near the hem
    m += `<path d="M173,266 Q228,277 282,266" fill="none" stroke="#BFDBF7" stroke-width="7" stroke-linecap="round"/>`;
  }
  // leg wraps first so boots layer in front of them when both are worn
  if (wardrobe.includes('leg-wraps')) {
    // white bandage wrapped around each lower leg (cannon), above the hoof
    const legs = [[94, 128], [149, 183], [281, 316], [331, 366]];
    for (const [x0, x1] of legs) {
      const w = x1 - x0;
      m += `<rect x="${x0 - 2}" y="388" width="${w + 4}" height="52" rx="6" fill="#F7F7F4"/>`;
      for (const wy of [400, 413, 426]) m += `<line x1="${x0 - 1}" y1="${wy}" x2="${x1 + 1}" y2="${wy + 4}" stroke="#D5DBE0" stroke-width="2.5"/>`;
    }
  }
  if (wardrobe.includes('boots')) {
    // a boot over each lower leg + hoof: body, cuff band, darker sole
    const legs = [[94, 128], [149, 183], [281, 316], [331, 366]];
    for (const [x0, x1] of legs) {
      const w = x1 - x0;
      m += `<rect x="${x0 - 3}" y="414" width="${w + 6}" height="52" rx="8" fill="#3F7FD6"/>`;
      m += `<rect x="${x0 - 5}" y="409" width="${w + 10}" height="12" rx="5" fill="#5B97E8"/>`;
      m += `<rect x="${x0 - 3}" y="457" width="${w + 6}" height="10" rx="4" fill="#2C5AA0"/>`;
    }
  }
  return m;
}

/**
 * Full figure HTML for one horse: soft ground shadow, the coat/state image,
 * and the costume overlay. Driven entirely by horse data.
 */
export function horseFigureHTML(horse, wardrobe = []) {
  return `
<div class="horse-figure">
  <div class="horse-shadow"></div>
  <img class="horse-img" src="${horseImageSrc(horse)}" alt="${horse.name} the horse" draggable="false">
  <svg class="horse-costume" viewBox="0 0 ${FIGURE_W} ${FIGURE_H}" aria-hidden="true">${costumeMarkup(wardrobe, horse.paletteKey)}</svg>
</div>`;
}

/** Short human-readable condition for the nameplate. */
export function wellbeingLabel(wellbeing) {
  if (wellbeing < 20) return 'just arrived, needs a lot of care';
  if (wellbeing < 40) return 'in rough shape';
  if (wellbeing < 60) return 'recovering';
  if (wellbeing < 80) return 'doing well';
  if (wellbeing < 95) return 'content';
  return 'thriving';
}

/** Bar colour shifts from amber to green as wellbeing rises. */
export function wellbeingColor(wellbeing) {
  const hue = 35 + (wellbeing / 100) * 75; // 35 (amber) → 110 (green)
  return `hsl(${hue}, 55%, 50%)`;
}
