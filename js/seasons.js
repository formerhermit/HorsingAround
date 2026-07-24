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

// Ordered so a brand-new rescue opens in spring. Each season layers lightly on
// the existing paddock-life systems:
//  - visitorsMult scales VISITORS_CHANCE (summer peaks, winter quietens).
//  - billWeights bias the bill draw toward seasonal chores (unlisted kinds = 1).
//    Winter leans on hay/barn/vet — the very bills the hay barn and vet station
//    soften, so growing the rescue is what carries the herd through the storms.
// className drives the CSS backdrop tint + weather scatter (render.js).
export const SEASONS = [
  { key: 'spring', label: 'Spring', emoji: '🌸', className: 'season-spring',
    toast: '🌸 Spring comes to the paddock: blossom on the breeze, and foals on the way 💛',
    visitorsMult: 1, billWeights: { foal: 3 } },
  { key: 'summer', label: 'Summer', emoji: '☀️', className: 'season-summer',
    toast: '☀️ Summer settles in: long warm days, and visitors flocking to meet the horses 💛',
    visitorsMult: 1.7, billWeights: {} },
  { key: 'autumn', label: 'Autumn', emoji: '🍂', className: 'season-autumn',
    toast: '🍂 Autumn arrives: golden light, and hay laid in for the months ahead 💛',
    visitorsMult: 1, billWeights: { hay: 2.5 } },
  { key: 'winter', label: 'Winter', emoji: '❄️', className: 'season-winter',
    toast: '❄️ Winter closes in: rugs on, extra feed out, the whole herd kept cosy through the storms 💛',
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
