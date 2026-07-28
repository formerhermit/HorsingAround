// Regenerates the social share card (the picture that shows when someone posts
// a link to the game). Run it whenever the paddock's look changes:
//
//   node scripts/share-card.mjs
//
// It boots the real game in headless Chromium, stages a deliberate paddock on
// top of it, and captures the top 1200x630 of the page. 1.91:1 is what
// Facebook / X / WhatsApp / LinkedIn all crop to, so framing it ourselves beats
// letting each of them centre-crop a screenshot of a different shape.
//
// Nothing here touches a real save: the browser profile is a throwaway, and
// every request to Supabase is refused, so the staged horses can never be
// pushed to a cloud save.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.GAME_URL ?? 'http://localhost:8653/';
const OUT = path.join(ROOT, process.env.OUT ?? 'share-card.png');

// 1.91:1, the aspect every major unfurler crops to.
const WIDTH = 1200;
const HEIGHT = 630;
// 1200x630 at 1x is the size every platform documents, and it keeps the file
// small enough that WhatsApp still builds a thumbnail (it gives up on links
// whose image runs to a few hundred KB). Raise it for a crisper file if you
// don't care about that.
const SCALE = Number(process.env.SCALE ?? 1);

/** The paddock we want people to see: a settled spring herd, ordinary coats,
 *  a couple of horses dressed, and the props that make it feel cared for. The
 *  newest three horses stand in the front row (FRONT_ROW in game.js), so the
 *  dressed pair go at the end of the list where they read at thumbnail size. */
function stage() {
  const now = Date.now();
  const horse = (o) => ({
    trait: null, fearOvercome: false, cosmetics: [], sponsor: null, real: null,
    wardrobe: [], facing: 'right', sizeJitter: 1, foal: false, bornAtPlay: null,
    damName: null, bornHere: false, foalTraitRevealed: false, ageYears: 9,
    kept: false, returned: false, arrivedAt: now, lastCaredAt: now, ...o,
  });
  const s = window.HorsingAround.state;

  // Four along the back, three up front: enough to fill the paddock's width,
  // since the front row sits right of centre and a sparse back row leaves the
  // left third as bare grass.
  s.horses = [
    horse({ id: 'h1', name: 'Perla',  paletteKey: 'white',    wellbeing: 95,  rescueOrder: 1, sponsor: 'Ana',   facing: 'right', sizeJitter: 1.02 }),
    horse({ id: 'h2', name: 'Nube',   paletteKey: 'grey',     wellbeing: 96,  rescueOrder: 2, facing: 'left',  sizeJitter: 0.98 }),
    horse({ id: 'h3', name: 'Trigo',  paletteKey: 'palomino', wellbeing: 96,  rescueOrder: 3, facing: 'right', sizeJitter: 1.0 }),
    horse({ id: 'h4', name: 'Sombra', paletteKey: 'bay',      wellbeing: 97,  rescueOrder: 4, sponsor: 'Pilar', facing: 'left',  sizeJitter: 1.01 }),
    horse({ id: 'h5', name: 'Canela', paletteKey: 'bay',      wellbeing: 98,  rescueOrder: 5, sponsor: 'Javi',  facing: 'right', sizeJitter: 1.0 }),
    horse({ id: 'h6', name: 'Duna',   paletteKey: 'palomino', wellbeing: 99,  rescueOrder: 6, facing: 'right', sizeJitter: 1.0, wardrobe: ['boots'] }),
    horse({ id: 'h7', name: 'Bruno',  paletteKey: 'brown',    wellbeing: 100, rescueOrder: 7, sponsor: 'Lucía', facing: 'left',  sizeJitter: 1.04, wardrobe: ['ear-flower'] }),
  ];
  s.coins = 4230;
  s.supporters = 128;
  s.lastSharedAt = 0;        // share meter reads full rather than mid-charge
  s.stats.playSeconds = 120; // under one season's length => spring
  s.stats.horsesRescued = 7;
  s.unlocks.moneyUI = true;
  s.unlocks.rescue = true;
  // One paddock and no facilities: extra owned paddocks add paging arrows.
  s.paddocksOwned = 1;
  s.facilities = [];
  s.shop = { stock: {}, decorByPaddock: { 0: ['flower-barrow', 'flower-buckets', 'marmalade'] } };
  // Every onboarding prompt marked seen, so nothing pops up over the paddock.
  Object.assign(s.milestones, {
    introToastShown: true, wantIntroShown: true, hasSharedUpdate: true,
    hasRescuedAgain: true, shopIntroDone: true, collectionIntroDone: true,
    leaderboardNudgeQueued: false, leaderboardNudgeShown: true,
    restoreWhisperRetired: true, firstWantRewarded: true, driftIntroShown: true,
  });
}

/** Stop the world: the 1s tick brings drift, rehoming offers and autosaves,
 *  any of which can change the scene between staging it and capturing it. */
function freeze() {
  const maxInterval = setInterval(() => {}, 1e6);
  for (let i = 1; i <= maxInterval; i++) clearInterval(i);
  const maxTimeout = setTimeout(() => {}, 1e6);
  for (let i = 1; i <= maxTimeout; i++) clearTimeout(i);
}

/** Chrome the card doesn't want: overlays, and the donation banner, which eats
 *  the vertical room the horses need at this aspect ratio. */
function trim() {
  for (const id of ['dialog-overlay', 'nudge-overlay']) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  const banner = document.getElementById('donate-banner');
  if (banner) banner.style.display = 'none';
  const whisper = document.getElementById('restore-whisper');
  if (whisper) whisper.hidden = true;
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: SCALE,
});

// Belt and braces: the staged herd must never reach a real cloud save.
await page.route(/supabase|supabase\.co/i, (route) => route.abort());

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.HorsingAround?.state?.horses?.length > 0);

await page.evaluate(stage);
await page.evaluate(freeze);
await page.evaluate(trim);

// Re-render from the staged state (renderAll is what the game itself calls).
await page.evaluate(async () => {
  const r = await import('./js/render.js');
  r.resetPaddockView();
  r.renderAll(window.HorsingAround.state);
});

await page.waitForLoadState('networkidle').catch(() => {});
await page.evaluate(() => document.fonts?.ready);
// Let the horse art and the season's CSS settle before the shutter.
await page.waitForTimeout(600);

const metrics = await page.evaluate(() => {
  const r = document.querySelector('.paddock')?.getBoundingClientRect();
  return {
    pageHeight: document.body.scrollHeight,
    paddockBottom: r ? Math.round(r.bottom) : null,
    season: document.querySelector('.paddock')?.className,
    horses: [...document.querySelectorAll('.horse')].length,
  };
});

await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
await browser.close();

console.log(`share card -> ${path.relative(ROOT, OUT)} (${WIDTH * SCALE}x${HEIGHT * SCALE})`);
console.log(metrics);
