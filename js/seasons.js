// seasons.js — the spring→summer→autumn→winter cycle (issue #48). Data +
// pure helpers only; no DOM, no game rules. Mirrors traits.js / achievements.js
// as a plain catalog that game.js (event flavour), render.js (backdrop) and the
// achievement checker all read.
//
// The year is game-time, not the calendar: the season keys off stats.playSeconds
// (active play only, the clamped-dt accumulator), so it advances while you play
// and pauses when you're away — the same clock the "Time played" stat shows.
// Nothing new is persisted; a returning player simply resumes wherever their
// playtime places them in the year.

// One season lasts this many seconds of active play; a full year is 4× this.
export const SEASON_SECONDS = 10 * 60; // 10 minutes/season → 40 minutes/year

// Ordered so a brand-new rescue opens in spring. The climate is ARCH's own:
// inland Málaga (Alhaurín), a Mediterranean year — lush green springs, hot bone-
// dry golden summers, the first rains and harvest in autumn, and mild wet winters
// that stay green (no snow at this elevation). Each season layers lightly on the
// existing paddock-life systems:
//  - visitorsMult scales VISITORS_CHANCE (summer, the coast's high season, peaks;
//    the wet winter quietens).
//  - billWeights bias the bill draw toward seasonal chores (unlisted kinds = 1):
//    spring foals; the parched summer needs water delivered often; autumn lays in
//    hay; the wet winter leans on hay/barn/vet — the very bills the hay barn and
//    vet station soften, so growing the rescue is what carries the herd through.
// className drives the CSS backdrop (grass + weather scatter; render.js).
export const SEASONS = [
  { key: 'spring', label: 'Spring', emoji: '🌸', className: 'season-spring',
    toast: '🌸 Spring greens the paddock: almond blossom and wildflowers, and foals on the way 💛',
    visitorsMult: 1, billWeights: { foal: 3 } },
  { key: 'summer', label: 'Summer', emoji: '☀️', className: 'season-summer',
    toast: '☀️ Summer bakes the campo golden: long dry days, water hauled out to the troughs, and visitors along the coast 💛',
    visitorsMult: 1.7, billWeights: { water: 3 } },
  { key: 'autumn', label: 'Autumn', emoji: '🍂', className: 'season-autumn',
    toast: '🍂 Autumn brings the first rains and the harvest: the land greens again, and hay laid in for the year 💛',
    visitorsMult: 1, billWeights: { hay: 2.5 } },
  { key: 'winter', label: 'Winter', emoji: '🌧️', className: 'season-winter',
    toast: '🌧️ Winter settles in mild and wet: rugs on for the cold nights, and the rains keep the pasture green 💛',
    visitorsMult: 0.6, billWeights: { hay: 2, barn: 2, vet: 1.5 } },
];

/** Every season class name, for toggling exactly one on the scene root. */
export const SEASON_CLASSES = SEASONS.map((s) => s.className);

/** Which season index the given playtime falls in (0 = spring). */
export function seasonIndexFor(playSeconds = 0) {
  return Math.floor(Math.max(0, playSeconds) / SEASON_SECONDS) % SEASONS.length;
}

/** The current season object for the given playtime. */
export function currentSeason(playSeconds = 0) {
  return SEASONS[seasonIndexFor(playSeconds)];
}

/** How many full years (four seasons each) have been played through. Feeds the
 *  "Round the year" badge. */
export function yearsPlayed(playSeconds = 0) {
  return Math.floor(Math.max(0, playSeconds) / (SEASONS.length * SEASON_SECONDS));
}
