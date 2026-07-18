// horse.js — the reusable horse illustration.
//
// One parameterised template built from the validated reference shapes.
// Instead of two hardcoded states (scruffy / after-care), every colour is
// interpolated between a "scruffy" and a "healthy" palette by wellbeing
// (0–100), so a horse visibly perks up with every bit of care. The eye
// shine fades in the same way.

const PALETTES = {
  chestnut: {
    scruffy: { coat: '#9C8465', legs: '#8F7A5C', mane: '#7A6A50', muzzle: '#C2A886' },
    healthy: { coat: '#C07A3E', legs: '#A5652E', mane: '#6B4423', muzzle: '#E8C49A' },
  },
  bay: {
    scruffy: { coat: '#8A7261', legs: '#5C5049', mane: '#4A3F38', muzzle: '#B99C82' },
    healthy: { coat: '#8B5A33', legs: '#3E332C', mane: '#2E2620', muzzle: '#D9B692' },
  },
  grey: {
    scruffy: { coat: '#9A9890', legs: '#8A8880', mane: '#787468', muzzle: '#C0BCB2' },
    healthy: { coat: '#C9C7BE', legs: '#A8A69D', mane: '#8E8B80', muzzle: '#E8E4DA' },
  },
  // More coats are just two palettes each — no new artwork.
};

export const PALETTE_KEYS = Object.keys(PALETTES);

/** Linear interpolation between two #rrggbb colours, t in [0,1]. */
function lerpHex(a, b, t) {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const channel = (shift) =>
    Math.round((ah >> shift & 255) * (1 - t) + (bh >> shift & 255) * t);
  return '#' + [16, 8, 0]
    .map((s) => channel(s).toString(16).padStart(2, '0'))
    .join('');
}

export function paletteFor(horse) {
  const def = PALETTES[horse.paletteKey] ?? PALETTES.chestnut;
  const t = Math.min(Math.max(horse.wellbeing / 100, 0), 1);
  const out = {};
  for (const part of Object.keys(def.scruffy)) {
    out[part] = lerpHex(def.scruffy[part], def.healthy[part], t);
  }
  return out;
}

/**
 * Wardrobe layers, drawn on top of the base shape in purchase order.
 * `wardrobe` is the list of owned shop item ids (see shop.js) — global,
 * not per-horse, so every horse wears whatever's been bought so far.
 */
function accessoryMarkup(wardrobe = []) {
  let markup = '';
  // Saddle blanket first so its front edge tucks behind the scarf, not
  // over it -- the scarf wraps the neck in front of where the blanket sits.
  if (wardrobe.includes('saddle-blanket')) {
    markup += `<path d="M45,75 Q55,60 85,58 Q115,60 124,76 Q126,86 118,90 Q85,80 52,90 Q44,86 45,75 Z" fill="#5F8FBF"/><path d="M45,75 Q55,60 85,58 Q115,60 124,76" fill="none" stroke="#3F6C99" stroke-width="2"/>`;
  }
  if (wardrobe.includes('scarf')) {
    markup += `<path d="M113,60 Q130,72 148,56 Q151,68 146,77 Q126,88 109,71 Q107,65 113,60 Z" fill="#D9534F"/><path d="M117,74 Q110,90 117,103 Q126,92 121,76 Z" fill="#C0392B"/>`;
  }
  if (wardrobe.includes('ear-flower')) {
    markup += `<g transform="translate(133,26)"><circle cy="-4" r="3" fill="#F2A6C6"/><circle cx="4" cy="-1" r="3" fill="#F2A6C6"/><circle cx="2" cy="4" r="3" fill="#F2A6C6"/><circle cx="-3" cy="3" r="3" fill="#F2A6C6"/><circle cx="-4" cy="-2" r="3" fill="#F2A6C6"/><circle r="2" fill="#F5D949"/></g>`;
  }
  if (wardrobe.includes('boots')) {
    markup += `<rect x="48" y="139" width="15" height="13" rx="4" fill="#4A7FB5"/><rect x="66" y="139" width="15" height="13" rx="4" fill="#4A7FB5"/><rect x="96" y="139" width="15" height="13" rx="4" fill="#4A7FB5"/><rect x="114" y="139" width="15" height="13" rx="4" fill="#4A7FB5"/>`;
  }
  if (wardrobe.includes('leg-wraps')) {
    markup += `<rect x="48" y="119" width="15" height="11" rx="3" fill="#E091A8"/><rect x="66" y="123" width="15" height="10" rx="3" fill="#E091A8"/><rect x="96" y="123" width="15" height="10" rx="3" fill="#E091A8"/><rect x="114" y="119" width="15" height="11" rx="3" fill="#E091A8"/>`;
  }
  if (wardrobe.includes('forelock-bow')) {
    markup += `<g transform="translate(145,7) rotate(-8)"><path d="M-7,0 Q-2,-6 0,0 Q-2,6 -7,0 Z" fill="#F0529B"/><path d="M7,0 Q2,-6 0,0 Q2,6 7,0 Z" fill="#F0529B"/><circle r="2.2" fill="#C93478"/></g>`;
  }
  return markup;
}

/**
 * Full inline SVG for one horse, driven entirely by horse data.
 * Geometry is the validated reference shape: mane on the crest edge,
 * short forelock.
 */
export function horseSVG(horse, wardrobe = []) {
  const c = paletteFor(horse);
  const shine = (Math.min(Math.max(horse.wellbeing / 100, 0), 1)).toFixed(2);
  return `
<svg viewBox="-2 -4 192 170" role="img" aria-label="${horse.name} the horse" xmlns="http://www.w3.org/2000/svg">
  <!-- ground shadow -->
  <ellipse cx="95" cy="152" rx="80" ry="9" fill="rgba(55,75,30,0.16)"/>
  <!-- tail -->
  <path data-part="mane" d="M42,88 q-22,8 -16,36" fill="none" stroke="${c.mane}" stroke-width="7" stroke-linecap="round"/>
  <!-- legs -->
  <rect data-part="legs" x="50" y="108" width="11" height="44" rx="5" fill="${c.legs}"/>
  <rect data-part="legs" x="68" y="118" width="11" height="35" rx="5" fill="${c.legs}"/>
  <rect data-part="legs" x="98" y="118" width="11" height="35" rx="5" fill="${c.legs}"/>
  <rect data-part="legs" x="116" y="108" width="11" height="44" rx="5" fill="${c.legs}"/>
  <!-- body, neck, head, ear -->
  <ellipse data-part="coat" cx="85" cy="92" rx="52" ry="30" fill="${c.coat}"/>
  <path data-part="coat" d="M112,80 L127,34 L149,42 L131,94 Z" fill="${c.coat}"/>
  <path data-part="coat" d="M120,40 Q124,14 145,12 Q168,14 176,38 Q178,50 168,56 Q156,58 146,50 Q128,52 120,40 Z" fill="${c.coat}"/>
  <path data-part="coat" d="M129,20 Q129,2 139,0 Q144,12 137,21 Z" fill="${c.coat}"/>
  <!-- mane along the crest + forelock -->
  <path data-part="mane" d="M130,24 q-7,9 1,18" fill="none" stroke="${c.mane}" stroke-width="5" stroke-linecap="round"/>
  <path data-part="mane" d="M125,35 q-7,9 1,18" fill="none" stroke="${c.mane}" stroke-width="5" stroke-linecap="round"/>
  <path data-part="mane" d="M120,46 q-6,8 1,16" fill="none" stroke="${c.mane}" stroke-width="5" stroke-linecap="round"/>
  <path data-part="mane" d="M117,56 q-6,7 1,14" fill="none" stroke="${c.mane}" stroke-width="5" stroke-linecap="round"/>
  <path data-part="mane" d="M142,13 q5,8 1,16" fill="none" stroke="${c.mane}" stroke-width="5" stroke-linecap="round"/>
  <!-- face -->
  <ellipse data-part="muzzle" cx="174" cy="48" rx="7" ry="5" fill="${c.muzzle}"/>
  <circle cx="177" cy="47" r="1.6" fill="#4A3A28"/>
  <circle cx="156" cy="26" r="3" fill="#3A2A18"/>
  <circle data-part="shine" cx="157" cy="25" r="1" fill="#FFFFFF" opacity="${shine}"/>
  <path d="M178,51 q-5,3 -10,1" fill="none" stroke="#4A3A28" stroke-width="1.6" stroke-linecap="round"/>
  <g class="accessories">${accessoryMarkup(wardrobe)}</g>
</svg>`;
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
