// horse.js — the horse figure.
//
// EXPERIMENT (horse-art-experiment branch): the horse is now a raster image
// per coat + emotional state, rather than the parameterised SVG. Wellbeing
// picks one of three states (sad / neutral / happy), so a horse visibly cheers
// up as it's cared for. Costumes are an SVG layer overlaid on top of the image
// in the image's own 500x480 coordinate space (see costumeMarkup).

import { escapeHtml } from './escape.js';

// The common coats. Kept exported as PALETTE_KEYS so game.js can pick one
// at random for an ordinary rescue. Donkeys share the horses' common pool.
export const PALETTE_KEYS = ['bay', 'brown', 'grey', 'palomino', 'white', 'brown-donkey', 'grey-donkey'];

// Rare coats: never in the common random pool. They only appear via the low
// per-rescue odds in game.js. The unicorn is rarer still (donation-only).
export const RARE_COATS = ['spotty', 'red-boy', 'piebald', 'piebald-donkey', 'zebra', 'patchy', 'creamy'];

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
  { id: 'patchy',         name: 'Patchy',        rarity: 'rare' },
  { id: 'creamy',         name: 'Creamy mane',   rarity: 'rare' },
  { id: 'unicorn',        name: 'Unicorn',       rarity: 'magical', unlock: 'Donate to ARCH' },
  { id: 'rainbow',        name: 'Rainbow',       rarity: 'magical', unlock: 'Rescue 100 horses' },
  { id: 'golden',         name: 'Golden',        rarity: 'magical', unlock: 'Rescue 500 horses' },
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

/** Path to the image for a horse's current coat + state. A foal has a single
 *  image (foals are always happy and healthy) until it grows up (game.js), at
 *  which point it takes a real coat and this returns the usual per-state art. */
export function horseImageSrc(horse) {
  if (horse.foal) return 'assets/horses/foal.png';
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

// (The neck scarf was retired in issue #38: neck placement never sat right
// across the different builds. Its slot went to the winter rug, which is
// back-worn like the saddle blanket.)

// Several coats stand at a different height in the shared 500x480 frame than
// the common horses (donkeys and a few of the rare coats sit lower; golden
// sits higher), so a back garment tuned to the common horses' withers line
// floats above or sinks below the actual back on those coats (issue #128,
// and a follow-up once piebald/spotty/etc turned out to need the same fix).
// Offsets are measured per coat by sampling the art's own top line (the first
// non-transparent pixel down each column, on the 500x480 frame the costume SVG
// shares 1:1 with the PNG) and comparing it with the garment's top edge across
// that garment's x-span. Two things make this fiddly, and both bit earlier
// passes: a column's topmost pixel is often mane, tail or wing rather than
// back, so those regions have to be excluded by eye; and the garment's top edge
// arcs UP toward the middle while a donkey's back slopes DOWN about twice as
// steeply as the horse the path was drawn for. The second means no single
// offset fits a donkey's whole span -- covering the rear corner floats the
// middle clear of the back -- so each value here is the midpoint of the range,
// then confirmed against a 2.5x render of the back rather than trusted from
// arithmetic. An earlier pass scaled a raw measurement by 80% instead, which
// pushed the rug offsets far enough past the midpoint to leave a visible strip
// of back above the rug on piebald donkeys (and, less obviously, on patchy,
// spotty and brown donkeys). Coats not listed sit right with no offset.
const BACK_GARMENT_OFFSET = {
  rug: {
    'brown-donkey': 48, 'grey-donkey': 57, 'piebald-donkey': 36, zebra: 30,
    piebald: 26, spotty: 35, 'red-boy': 16, patchy: 3, creamy: 19, golden: -39,
  },
  blanket: {
    'brown-donkey': 47, 'grey-donkey': 55, 'piebald-donkey': 30, zebra: 30,
    piebald: 25, spotty: 37, 'red-boy': 16, patchy: 4, creamy: 20, golden: -40,
  },
};

// Where the four lower legs sit (each [x0, x1]) for boots and leg-wraps. Donkeys
// stand a little narrower and the zebra's forelegs sit further forward, so the
// horse-tuned set lands off their legs. Coats not listed use the horse default.
const DEFAULT_LEGS = [[94, 128], [149, 183], [281, 316], [331, 366]];
// Donkey ranges measured from the art across the boot band (the legs splay out
// slightly toward the hoof, so these span the whole footprint the boot covers).
const LEG_POSITIONS = {
  'brown-donkey':   [[83, 119], [137, 174], [278, 315], [324, 361]],
  'grey-donkey':    [[82, 119], [137, 174], [278, 316], [324, 362]],
  'piebald-donkey': [[78, 115], [133, 170], [283, 321], [331, 370]],
  'zebra':          [[96, 130], [146, 179], [297, 331], [343, 377]],
};

// Seasonal wardrobe colours (issue #48-style recolour): every coloured
// wardrobe piece takes on the season's palette, so a dressed herd looks right
// for the time of year without the player ever re-buying anything. Spring and
// summer keep the original cozy colours (the year-round "default"); only
// autumn and winter swap in. Autumn and winter are sampled straight from the
// seasonal flower-buckets art (assets/decor/flower-buckets-{autumn,winter}
// .png) so the wardrobe reads as the same bright gold/orange/coral or soft
// sky-blue/lilac as the rest of the seasonal decor -- deliberately light and
// cheerful, not the deep rust/browns or dark navy an early pass used, which
// read as bolder and muddier than everything else in the scene. Each boot's
// sole is the one place a touch more depth than the sampled art is added, so
// the thin sole band stays visible against the boot body above it.
const WARDROBE_PALETTES = {
  default: {
    rugMain: '#E895B3', rugHem: '#F9EFE3', rugTrim: '#D3719B',
    flowerPetal: '#A971D6', flowerCenter: '#F1C40F',
    bowRibbon: '#F7CD3A', bowKnot: '#E0A81E',
    blanketMain: '#A971D6', blanketTrim: '#E6D6F5',
    wrapBase: '#F7F7F4', wrapLine: '#D5DBE0',
    bootMain: '#A971D6', bootCuff: '#BE8FE0', bootSole: '#7E51AE',
  },
  autumn: {
    rugMain: '#F87B13', rugHem: '#FFE9A6', rugTrim: '#E95633',
    flowerPetal: '#FFC808', flowerCenter: '#E95633',
    bowRibbon: '#F87B13', bowKnot: '#E95633',
    blanketMain: '#F87B13', blanketTrim: '#FFE9A6',
    wrapBase: '#FFE9A6', wrapLine: '#E95633',
    bootMain: '#E95633', bootCuff: '#FFC808', bootSole: '#C2451C',
  },
  winter: {
    rugMain: '#8FB0D6', rugHem: '#CBDCEE', rugTrim: '#5E7EA8',
    flowerPetal: '#8FB0D6', flowerCenter: '#CBDCEE',
    bowRibbon: '#8FB0D6', bowKnot: '#5E7EA8',
    blanketMain: '#8FB0D6', blanketTrim: '#CBDCEE',
    wrapBase: '#E7E4FF', wrapLine: '#5E7EA8',
    bootMain: '#5E7EA8', bootCuff: '#8FB0D6', bootSole: '#4A7096',
  },
};
function wardrobeColors(seasonKey) {
  return WARDROBE_PALETTES[seasonKey] ?? WARDROBE_PALETTES.default;
}

/**
 * Costume overlay markup, in the image's 500x480 space. Split by where it sits
 * so head-worn pieces could be tuned independently of leg/back pieces.
 * Coordinates are re-tuned for the raster horse (task in progress) — empty for
 * now so horses render bare until the overlay is dialled in.
 */
function costumeMarkup(wardrobe = [], coat = 'bay', seasonKey = 'default') {
  const c = wardrobeColors(seasonKey);
  let m = '';
  if (wardrobe.includes('winter-rug')) {
    // a cozy rug over the whole back, withers to rump, hanging well down the
    // barrel, with a lighter hem band. Dropped to the coat's own back line on
    // the shorter-standing coats (issue #128's fix, applied here too since the
    // rug shares the exact same horse-tuned coordinates).
    const dy = BACK_GARMENT_OFFSET.rug[coat] ?? 0;
    m += `<g transform="translate(0,${dy})">`;
    m += `<path d="M152,206 Q232,186 314,197 Q327,204 324,255 Q321,300 313,309 Q234,323 160,309 Q150,298 148,252 Q147,212 152,206 Z" fill="${c.rugMain}"/>`;
    m += `<path d="M156,292 Q236,308 318,290" fill="none" stroke="${c.rugHem}" stroke-width="8" stroke-linecap="round"/>`;
    m += `<path d="M160,309 Q234,322 313,309" fill="none" stroke="${c.rugTrim}" stroke-width="6" stroke-linecap="round"/>`;
    m += `</g>`;
  }
  if (wardrobe.includes('ear-flower')) {
    // a small daisy tucked at the base of the forward ear
    const { cx, cy } = EAR_FLOWER_ANCHOR[coat] ?? DEFAULT_EAR_FLOWER;
    const petals = [[cx, cy - 10], [cx + 9.5, cy - 3.1], [cx + 5.9, cy + 8.1], [cx - 5.9, cy + 8.1], [cx - 9.5, cy - 3.1]];
    for (const [px, py] of petals) m += `<circle cx="${px}" cy="${py}" r="6.5" fill="${c.flowerPetal}"/>`;
    m += `<circle cx="${cx}" cy="${cy}" r="5" fill="${c.flowerCenter}"/>`;
  }
  if (wardrobe.includes('forelock-bow')) {
    // a ribbon bow on the forehead, tracking the same per-coat head position as
    // the ear flower (just in and down a touch) so it doesn't float above heads
    // that sit lower in the frame.
    const f = EAR_FLOWER_ANCHOR[coat] ?? DEFAULT_EAR_FLOWER;
    const bx = f.cx + 20, by = f.cy + 14;
    m += `<path d="M${bx},${by} L${bx - 23},${by - 10} Q${bx - 29},${by} ${bx - 23},${by + 10} Z" fill="${c.bowRibbon}"/>`;
    m += `<path d="M${bx},${by} L${bx + 23},${by - 10} Q${bx + 29},${by} ${bx + 23},${by + 10} Z" fill="${c.bowRibbon}"/>`;
    m += `<rect x="${bx - 6}" y="${by - 7}" width="12" height="14" rx="4" fill="${c.bowKnot}"/>`;
  }
  if (wardrobe.includes('saddle-blanket')) {
    // a cloth draped over the back behind the withers, hanging down the
    // barrel. Dropped to the coat's own back line on the shorter-standing
    // coats -- it was floating well above a donkey's actual back (#128).
    const dy = BACK_GARMENT_OFFSET.blanket[coat] ?? 0;
    m += `<g transform="translate(0,${dy})">`;
    m += `<path d="M175,200 Q230,189 278,195 Q288,199 286,238 Q284,272 277,282 Q228,289 179,283 Q170,273 168,238 Q166,199 175,200 Z" fill="${c.blanketMain}"/>`;
    // light trim stripe near the hem
    m += `<path d="M173,266 Q228,277 282,266" fill="none" stroke="${c.blanketTrim}" stroke-width="7" stroke-linecap="round"/>`;
    m += `</g>`;
  }
  const legs = LEG_POSITIONS[coat] ?? DEFAULT_LEGS;
  // leg wraps first so boots layer in front of them when both are worn
  if (wardrobe.includes('leg-wraps')) {
    // a bandage wrapped around each lower leg (cannon), above the hoof
    for (const [x0, x1] of legs) {
      const w = x1 - x0;
      m += `<rect x="${x0 - 2}" y="388" width="${w + 4}" height="52" rx="6" fill="${c.wrapBase}"/>`;
      for (const wy of [400, 413, 426]) m += `<line x1="${x0 - 1}" y1="${wy}" x2="${x1 + 1}" y2="${wy + 4}" stroke="${c.wrapLine}" stroke-width="2.5"/>`;
    }
  }
  if (wardrobe.includes('boots')) {
    // a boot over each lower leg + hoof: body, cuff band, darker sole.
    for (const [x0, x1] of legs) {
      const w = x1 - x0;
      m += `<rect x="${x0 - 3}" y="414" width="${w + 6}" height="52" rx="8" fill="${c.bootMain}"/>`;
      m += `<rect x="${x0 - 5}" y="409" width="${w + 10}" height="12" rx="5" fill="${c.bootCuff}"/>`;
      m += `<rect x="${x0 - 3}" y="457" width="${w + 6}" height="10" rx="4" fill="${c.bootSole}"/>`;
    }
  }
  return m;
}

/**
 * Full figure HTML for one horse: soft ground shadow, the coat/state image,
 * and the costume overlay. Driven entirely by horse data.
 */
export function horseFigureHTML(horse, wardrobe = [], seasonKey = 'default') {
  return `
<div class="horse-figure">
  <div class="horse-shadow"></div>
  <img class="horse-img" src="${horseImageSrc(horse)}" alt="${escapeHtml(horse.name)} the horse" draggable="false">
  <svg class="horse-costume" viewBox="0 0 ${FIGURE_W} ${FIGURE_H}" aria-hidden="true">${costumeMarkup(wardrobe, horse.paletteKey, seasonKey)}</svg>
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
