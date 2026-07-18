// horse.js — the horse figure.
//
// EXPERIMENT (horse-art-experiment branch): the horse is now a raster image
// per coat + emotional state, rather than the parameterised SVG. Wellbeing
// picks one of three states (sad / neutral / happy), so a horse visibly cheers
// up as it's cared for. Costumes are an SVG layer overlaid on top of the image
// in the image's own 500x480 coordinate space (see costumeMarkup).

// The five coats a horse can have. Kept exported as PALETTE_KEYS so game.js can
// still pick one at random for a new rescue without changes.
export const PALETTE_KEYS = ['bay', 'brown', 'grey', 'palomino', 'white'];

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
  return PALETTE_KEYS.includes(horse.paletteKey) ? horse.paletteKey : 'brown';
}

/** Path to the image for a horse's current coat + state. */
export function horseImageSrc(horse) {
  return `assets/horses/${coatOf(horse)}-${wellbeingState(horse.wellbeing)}.png`;
}

/**
 * Costume overlay markup, in the image's 500x480 space. Split by where it sits
 * so head-worn pieces could be tuned independently of leg/back pieces.
 * Coordinates are re-tuned for the raster horse (task in progress) — empty for
 * now so horses render bare until the overlay is dialled in.
 */
function costumeMarkup(wardrobe = []) {
  let m = '';
  if (wardrobe.includes('scarf')) {
    // band spanning the whole neck from the mane edge (~x305) to the throat
    // (~x390), with a knotted tail hanging at the front of the throat
    m += `<path d="M300,188 Q345,179 390,179 Q401,191 397,203 Q394,213 388,216 Q345,220 303,214 Q295,202 300,188 Z" fill="#D9534F"/>`;
    m += `<path d="M382,213 Q378,239 385,259 Q397,241 396,211 Z" fill="#C0392B"/>`;
  }
  if (wardrobe.includes('ear-flower')) {
    // a small daisy tucked at the base of the forward ear
    const cx = 392, cy = 70;
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
  <svg class="horse-costume" viewBox="0 0 ${FIGURE_W} ${FIGURE_H}" aria-hidden="true">${costumeMarkup(wardrobe)}</svg>
</div>`;
}

/** Short human-readable condition for the nameplate. */
export function wellbeingLabel(wellbeing) {
  if (wellbeing < 20) return 'just arrived — needs a lot of care';
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
