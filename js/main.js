// main.js — boot the game: load state, render, wire input and persistence.

import { initState, save, gameState, adoptCloudState, DONATE_MILESTONE, SAVE_KEY, disableSaving } from './state.js';
import { careFor, tick, rescueHorse, shareUpdate, rescueCost, rescuePrice, acceptRehome, declineRehome, requestRehome, collectOfflineEarnings, collectDuePostcards, collectDueStatues, markPostcardsRead, fulfilWant, grantUnicorn, hasUnicorn, acceptBill, declineBill, scheduleVisitorsDay, hurryPaddockLife } from './game.js';
import {
  renderAll, renderHUD, renderActions, updateHorseCard,
  showCareFeedback, showTipPop, showToast, showMoneyPop, showSupporterPop, burstConfetti, changePaddock, resetPaddockView,
  showNudgePopup, hideNudgePopup, showDialog,
  renderShopButton, openShopModal, closeShopModal, renderShopModal, shopDecorPaddock, shopWardrobeHorse,
  renderPostcardButton, openPostcardAlbum, closePostcardAlbum,
  renderWantBubbles, showWantFulfilled,
  renderCollectionButton, openCollection, closeCollection, renderStats, renderAchievements,
  formatDate, paddockLabel,
} from './render.js';
import { ACHIEVEMENTS, checkAchievements } from './achievements.js';
import { buyFacility } from './facilities.js';
import { currentSeason } from './seasons.js';
import {
  buyDecorIn, buyWardrobe, placeDecor, removeDecor, placeWardrobe, removeWardrobe,
  hasNewAffordableItem, buyPaddock, nextPaddockPrice,
} from './shop.js';
import { syncOnLoad, pullCloudSave, pushCloudSave, markSyncSettled, getCloudUserId, deleteCloudData, getClient } from './cloud.js';
import { createSaveCode, previewSaveCode, confirmSaveCode } from './saveCode.js';
import { linkGoogle, signInWithGoogle, isGoogleLinked } from './google.js';
import {
  monthLabel, prevMonthLabel, generateName, rolloverIfNeeded, recordRescue,
  pushScore, joinBoard, fetchBoard, leaveBoard, fetchChampion, fetchMyChampionship,
} from './leaderboard.js';
import { initShare } from './share.js';
import './audio.js';

// Wrap a key figure (a count, a € amount, a supporter tally) so it renders bold
// and green in a popup -- see the .fig rule and showDialog's innerHTML. Values
// are always numbers/short strings authored in-code, so plain interpolation is safe.
const fig = (v) => `<span class="fig">${v}</span>`;

// Visit index.html?reset to discard the save during development.
const reset = new URLSearchParams(location.search).has('reset');
const state = initState({ reset });

// Which Google flow (if any) we're returning from, per the ?google= marker
// google.js adds to its redirect URL -- see js/google.js for why this is
// simpler than timing an onAuthStateChange listener against Supabase's own
// URL-token parsing on boot. Supabase appends its own error/error_description
// on a failed link -- check both query and hash, since which one depends on
// the OAuth flow type.
//
// Read these now, but do NOT scrub the URL yet: Supabase's client reads its
// own session-establishing parameters (a PKCE ?code=... or an implicit-flow
// #access_token=...) from this exact URL when it's constructed a moment from
// now, inside getClient()'s dynamic import. Wiping the query/hash early --
// which a first version of this code did, via history.replaceState(null, '',
// location.pathname) run synchronously here -- silently deleted those
// parameters before Supabase ever saw them, so "signin"/"override" always
// fell back to whatever session already existed instead of the one just
// signed into. The cleanup call now happens later, after getClient() has
// definitely run.
const googleQuery = new URLSearchParams(location.search);
const googleHash = new URLSearchParams(location.hash.replace(/^#/, ''));
const googleReturn = googleQuery.get('google');
const googleError = googleQuery.get('error_description') || googleQuery.get('error')
  || googleHash.get('error_description') || googleHash.get('error');
function scrubGoogleReturnUrl() {
  if (googleReturn) history.replaceState(null, '', location.pathname);
}

// "Keep my progress instead" on the Google conflict card stashes this
// device's save here before switching accounts, since the redirect to
// Google and back fully reloads the page -- nothing in JS memory survives
// it. Read back and cleared once we're signed in as the other account.
const OVERRIDE_STASH_KEY = 'horsing-around:google-override-stash';

// Captured before save() stamps a fresh time: how long ago the last session was.
const lastPlayedAt = state.savedAt;

// Credit anything the rescue earned while the game was closed, before the first
// paint, so the HUD already shows the boosted totals. The summary (or null) is
// held for the welcome-back popup, shown once the dialog plumbing is set up.
const offlineSummary = collectOfflineEarnings(lastPlayedAt);

renderAll(state);
save(); // persist immediately so the save shape exists from first load
backfillAchievements(); // grant already-earned badges quietly, before live play can toast

// ---- intro popup ----
// Brand-new players don't know clicking a horse does anything. A small toast
// was too easy to miss, so this is a big centred welcome card (the same modal
// as the other event dialogs) that introduces the rescue and points them at
// Biscuit. Shown once ever, a couple of seconds after load so the paddock has
// painted first, then dismissed with a single obvious button.
if (!state.milestones.introToastShown) {
  state.milestones.introToastShown = true;
  save();
  const first = state.horses[0]?.name ?? 'Biscuit';
  setTimeout(() => enqueueDialog({
    emoji: '🐴',
    text: `Welcome to your little horse rescue! This is ${fig(first)}, your very first rescue. He arrived tired and hungry, and needs some care to recover. Tap him to look after him, and watch him perk up 💛`,
    buttons: [{ label: `Let's help ${first}!`, variant: 'primary' }],
  }), 2000);
}

// (Onboarding nudges are re-asserted on load once their definitions below have
// run -- see the updateOnboardingNudges() call after the dismiss wiring.)

// ---- real-donation banner ----
// A permanent fixture at the foot of the screen (markup in index.html): always
// shown, never dismissible. Its "Donate to ARCH" link doubles as a way to earn
// the unicorn while it's unclaimed (see wireDonateButtons below).

// ---- the donation unicorn ----
// Well into the rescue (around DONATE_MILESTONE horses saved), offer a magical
// friend as a thank-you for donating to the real ARCH horses. Honor-based on
// the Donate click, since there's no way to verify the donation itself. This is
// the same beat as the 10-rescue "donate to ARCH" popup (see handleEvent), so
// the player only ever gets one donate prompt there, not two.
//
// The offer surfaces two ways: automatically once per session (maybeOfferUnicorn),
// and on demand whenever the player taps a Donate button while the unicorn is
// still unclaimed (see wireDonateButtons). Either way the magical friend stays
// winnable, so the auto-popup is never the single missable chance to get it.
let unicornSnoozed = false;

/** Honour-based: the player pressed a real Donate-to-ARCH button. Earns the
 *  "Real hero" badge (issue #65). Can't be verified, so we take it on trust. */
function markDonatedForReal() {
  if (state.milestones.donatedForReal) return;
  state.milestones.donatedForReal = true;
  runAchievementCheck();
}

/** Open the real donation page and, honor-based, grant the unicorn as thanks. */
function claimUnicorn() {
  window.open(DONATE_URL, '_blank', 'noopener');
  markDonatedForReal();
  const unicorn = grantUnicorn();
  if (unicorn) {
    resetPaddockView();
    renderAll(state);
    refreshUI();
    persist();
    setTimeout(() => showToast(`🦄 Thank you for helping the real horses. Say hello to ${unicorn.name}, your magical friend 💛`), 600);
  }
}

/** Show the magical-friend offer. Always shows (used for the on-demand Donate
 *  tap); the snooze/milestone gating lives in maybeOfferUnicorn. */
function offerUnicorn() {
  enqueueDialog({
    emoji: '🦄',
    text: 'The horses here are pretend, but the ones at ARCH are real, and they need help. Donate to the rescue and a magical friend will come to live in your paddock 💛',
    buttons: [
      { label: 'Donate 💛', variant: 'primary', onClick: claimUnicorn },
      { label: 'Not now', variant: 'ghost' },
    ],
  });
}

function maybeOfferUnicorn() {
  if (state.stats.horsesRescued < DONATE_MILESTONE || hasUnicorn(state)
      || state.milestones.donateOptOut || unicornSnoozed) return;
  unicornSnoozed = true; // one gentle ask per session
  offerUnicorn();
}

// The Donate buttons at the foot of the screen (the footer credit link and the
// donation banner) double as a way to earn the unicorn. While it's unclaimed, a
// tap opens the magical-friend offer instead of jumping straight to the donation
// page, so the reward is discoverable from every donate entry point. Once the
// unicorn is home, the links behave as plain donation links again.
function wireDonateButtons() {
  document.querySelectorAll('[data-donate]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (hasUnicorn(state)) { markDonatedForReal(); return; } // already won: link opens normally
      e.preventDefault();
      offerUnicorn();
    });
  });
}

wireDonateButtons();

// "Load other save" and "Keep this game" both already know exactly what
// should happen to the save -- force-load the other account's, or
// force-overwrite it -- so neither goes through syncOnLoad()'s "whichever was
// saved more recently wins" reconciliation. That heuristic is wrong for an
// explicit load/save action: the local device is usually the one being
// actively played, so its fresh timestamp would routinely "win" and silently
// keep the local game (or even push it up over the other account's save)
// instead of doing what was asked.
//
// getSession() is awaited first (and only then is the URL scrubbed) because
// constructing the client is what makes Supabase read window.location for
// its own session-establishing parameters (a PKCE ?code=... or an implicit
// #access_token=...), and getSession() is documented to always wait for that
// detection to finish before resolving. Scrubbing any earlier would silently
// delete those parameters before Supabase ever saw them, so a
// "signin"/"override" return would just fall back to whatever session
// already existed instead of the new one.
getClient().then((client) => client.auth.getSession()).then(() => {
  scrubGoogleReturnUrl();

  if (googleReturn === 'signin') {
    pullCloudSave().then((adopted) => {
      if (adopted) { resetPaddockView(); renderAll(state); save(); backfillAchievements(); }
      pushScore();
      maybeCelebrateChampionship();
      showToast(adopted ? 'Welcome back! Your Google save is here 💛' : 'Signed in with Google 💛', 'ok');
    });
  } else if (googleReturn === 'override') {
    const stashed = localStorage.getItem(OVERRIDE_STASH_KEY);
    localStorage.removeItem(OVERRIDE_STASH_KEY);
    if (stashed) {
      try {
        adoptCloudState(JSON.parse(stashed));
        resetPaddockView();
        renderAll(state);
        save();
        markSyncSettled(); // this push IS the reconciliation: keep my progress
        pushCloudSave();
        pushScore();
        backfillAchievements();
        maybeCelebrateChampionship();
        showToast('Your progress is now saved to this Google account 💛', 'ok');
      } catch (err) {
        console.warn('Could not restore the stashed save after overriding:', err);
        showToast('Signed in with Google, but restoring your other progress failed — sorry!', 'alert');
      }
    } else {
      showToast('Signed in with Google 💛', 'ok');
    }
  } else {
    // Cloud sync is a background enhancement, never a blocker on first paint —
    // Biscuit is already on screen and clickable before this resolves. This is
    // the normal path (including a successful Google *link*, which never
    // changes which account owns the save, so the usual reconciliation is
    // fine). lastPlayedAt (captured before the boot save() stamped a fresh
    // time) is what the cloud save is compared against — see issue #67.
    syncOnLoad(lastPlayedAt).then((adopted) => {
      if (adopted) {
        resetPaddockView();
        renderAll(state);
        save();
        backfillAchievements();
      }
      pushScore();
      maybeCelebrateChampionship();
      if (googleReturn === 'linked') {
        if (googleError) {
          openSync().then(() => { document.getElementById('google-conflict').hidden = false; });
        } else {
          showToast('Google connected — this save can follow you now 💛', 'ok');
        }
      }
    });
  }
});

// ---- input: click (or Enter/Space) on a horse = one care action ----

function refreshUI() {
  renderHUD(state);
  renderActions(state);
  renderShopButton(state);
  updateOnboardingNudges();
  updateRestoreWhisper();
}

// Three big centred call-to-action popups that teach the core loop, each with a
// playful arrow pointing at its button. Shown one at a time; each is snoozed
// individually once dismissed (so it doesn't nag), but dismissing one never
// hides the others -- the rescue and shop prompts still fire when their button
// goes live. Snoozes reset next visit while a goal is still outstanding.
/** The popup shown for a given onboarding goal. Rescue reads the first horse's
 *  name so it lands as "Biscuit wants a friend", not a generic prompt. */
function nudgeConfig(id) {
  if (id === 'share') return {
    emoji: '💛', dir: 'down',
    text: 'You can raise money for the rescue! Tap “Share an update” below to chat with your supporters on social media.',
  };
  if (id === 'rescue') {
    const first = state.horses[0]?.name ?? 'your horse';
    return {
      emoji: '🐴', dir: 'down',
      text: `You've saved enough to help another horse: tap “Rescue another horse” below to get ${first} a friend.`,
    };
  }
  if (id === 'collection') return {
    emoji: '📖', dir: 'up-right',
    text: "You've rescued a whole paddock! Tap the book up top to see every horse type there is, and which you've collected so far.",
  };
  if (id === 'left-behind') return {
    emoji: '🧥', dir: 'up-right',
    text: `${leftBehindHorseName} has gone to their new home, but left their outfit behind. It's waiting in your Tack room up top, ready for another horse.`,
  };
  if (id === 'leaderboard') return {
    emoji: '🏆', dir: 'up-right',
    text: "Rescuers like you are on this month's Top rescuers board. It lives in the book up top, if you'd like to join in.",
  };
  return {
    emoji: '🛍️', dir: 'up-right',
    text: 'The Tack room is open! Tap the button up top to dress your horses and decorate the paddock.',
  };
}

const snoozedNudges = new Set(); // nudge ids dismissed this session
// A rehomed horse's clothes have just landed in the stores; show the one-time
// explainer on the next nudge sweep. Cleared (and never repeated) once seen.
let leftBehindPending = false;
let leftBehindHorseName = '';

/** The highest-priority onboarding goal that's outstanding and not snoozed, or
 *  null. Rescue and shop only surface once they're actually actionable -- enough
 *  money for the first rescue, or an affordable item in the shop -- so their
 *  arrow always points at a button the player can use right now. */
function pendingNudge() {
  const m = state.milestones;
  const candidates = [];
  if (leftBehindPending && !m.leftBehindShown) candidates.push('left-behind');
  // Armed by collecting a rescue milestone, then persisted. It outranks the
  // shop/collection nudges: those re-assert themselves every session until
  // resolved, whereas this introduction belongs to the milestone moment --
  // behind the shop nudge it would wait forever for a player who never opens
  // the Tack room. (Share/rescue can't collide: both are long done by the
  // time a milestone is collectable.)
  if (m.leaderboardNudgeQueued && !m.leaderboardNudgeShown && !state.leaderboard.optedIn) candidates.push('leaderboard');
  if (state.unlocks.moneyUI && !m.hasSharedUpdate) candidates.push('share');
  if (state.unlocks.rescue && !m.hasRescuedAgain && state.coins >= rescuePrice(state)) candidates.push('rescue');
  if (state.unlocks.moneyUI && !m.shopIntroDone && hasNewAffordableItem(state)) candidates.push('shop');
  if (state.stats.horsesRescued >= 8 && !m.collectionIntroDone) candidates.push('collection');
  return candidates.find((id) => !snoozedNudges.has(id)) ?? null;
}

function updateOnboardingNudges() {
  const id = pendingNudge();
  if (id) showNudgePopup(id, nudgeConfig(id));
  else hideNudgePopup();
}

// Only the "Got it!" button dismisses -- clicking the dimmed background does
// nothing, so a player can't skip past the prompt by accident. Snoozes just the
// popup that's showing, so a later prompt still fires when its button goes live.
document.getElementById('nudge-dismiss').addEventListener('click', () => {
  const id = document.getElementById('nudge-overlay').dataset.nudge;
  if (id) snoozedNudges.add(id);
  if (id === 'collection') { state.milestones.collectionIntroDone = true; save(); }
  if (id === 'left-behind') { state.milestones.leftBehindShown = true; leftBehindPending = false; save(); }
  if (id === 'leaderboard') { state.milestones.leaderboardNudgeShown = true; save(); }
  hideNudgePopup();
});

// Re-assert the onboarding nudge on load: a player who unlocked money but never
// shared (or found the shop, or grew the herd) still gets the prompt on return.
updateOnboardingNudges();

function persist() {
  save();
  pushCloudSave();
}

// Grant any already-earned badges quietly (issue #65): no toast, no dot. Run
// once at boot and again whenever a cloud save is adopted, so a returning
// player (or one whose save predates badges) isn't greeted by a toast flood —
// only badges earned during live play toast. Idempotent: badges already in the
// list are skipped, and marking seen just clears the dot for the caught-up set.
function backfillAchievements() {
  checkAchievements(state); // grants earned-but-unlisted into state.achievements
  state.achievementsSeen = state.achievements.length;
  save();
}

// ---- leaderboard champion celebration (issue #73) ----
// On the first visit after a month this player WON, a one-time popup: the
// rosette pony, confetti, and a bonus into the fund. The celebrated months
// live in the synced save, so it fires once per won month across devices.
// Called after each boot-sync path settles (the save is accurate by then).
async function maybeCelebrateChampionship() {
  const won = await fetchMyChampionship();
  if (!won) return;
  const m = state.milestones;
  m.championMonthsCelebrated ??= [];
  if (m.championMonthsCelebrated.includes(won.month)) return;
  m.championMonthsCelebrated.push(won.month);
  const bonus = Math.max(20, Math.round(rescueCost(state) * 0.25));
  state.coins += bonus;
  state.stats.totalDonated += bonus;
  enqueueDialog({
    emoji: '', image: 'assets/events/leaderboard-winner.jpg', confetti: true, share: true,
    text: `Champion! ${fig(won.name)} finished top of the rescuers board for ${prevMonthLabel()}, with ${fig(won.rescues)} ${won.rescues === 1 ? 'rescue' : 'rescues'}. The whole paddock is proud of you, and a ${fig(`€${bonus}`)} celebration bonus has gone into the fund 💛`,
    buttons: [{ label: 'Amazing!', variant: 'primary' }],
  });
  refreshUI();
  persist();
}

// Modal event dialogs (rehoming offers, milestone rewards) show one at a time.
const dialogQueue = [];
let dialogActive = false;

function enqueueDialog(spec) {
  dialogQueue.push(spec);
  pumpDialogs();
}

function pumpDialogs() {
  if (dialogActive || dialogQueue.length === 0) return;
  // Don't interrupt the open shop (the "tack room"): a rehome offer popping up
  // over it is confusing -- you could adopt a horse that's still listed for
  // dressing in the shop. Hold queued dialogs; closing the shop re-pumps them.
  if (!document.getElementById('shop-overlay').hidden) return;
  dialogActive = true;
  const spec = dialogQueue.shift();
  showDialog({
    ...spec,
    buttons: spec.buttons.map((b) => ({
      ...b,
      onClick: () => { b.onClick?.(); dialogActive = false; pumpDialogs(); },
    })),
  });
}

// ---- welcome back ----
// A warm summary of what the rescue earned while the game was closed. The money
// and supporters were already credited at boot; this just tells the story.

/** "2h 14m", "45m" — the human-friendly length of a trip away. */
function formatAway(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function showWelcomeBack(summary) {
  const money = Math.floor(summary.income);
  const parts = [`your supporters donated ${fig(`€${money}`)}`];
  if (summary.newSupporters > 0) {
    parts.push(summary.newSupporters === 1
      ? `${fig('1')} new supporter found the rescue`
      : `${fig(summary.newSupporters)} new supporters found the rescue`);
  }
  // A random horse "missed you" — the personal touch that makes it warm. If the
  // herd eased down while you were gone, the same line invites the top-up.
  const horse = state.horses[Math.floor(Math.random() * state.horses.length)];
  const earnings = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0];
  const missedYou = (summary.drifted ?? 0) > 0
    ? `${horse.name} missed you, and the herd would love a little top-up of care 🐴`
    : `${horse.name} missed you 🐴`;
  enqueueDialog({
    emoji: '💛',
    text: `Welcome back! While you were away (${formatAway(summary.awaySeconds)}), ${earnings}. ${missedYou}`,
    buttons: [{ label: 'Lovely!', variant: 'primary' }],
  });
}

if (offlineSummary) showWelcomeBack(offlineSummary);

// ---- postcards ----
// Deliver any postcards that have come due (checked on load and each tick, so
// ones that matured while the game was closed are waiting on return) and toast
// them. The first one explains the album; later ones just announce themselves.
function deliverPostcards(due) {
  if (!due.length) return;
  const first = !state.milestones.firstPostcardShown;
  state.milestones.firstPostcardShown = true;
  if (due.length === 1) {
    showToast(first
      ? `💌 ${due[0].name} sent a postcard from their new home. Find it in your album up top!`
      : `💌 A postcard arrived from ${due[0].name}!`);
  } else {
    showToast(`💌 ${due.length} postcards arrived from horses you've rehomed!`);
  }
  renderPostcardButton(state);
  persist();
}

// A postcard milestone may have earned a keepsake statue. Runs after every
// delivery and once on load (catching up returning players), independent of
// whether any new postcards arrived this time.
function grantStatues() {
  const granted = collectDueStatues(state);
  if (!granted.length) return;
  if (granted.length === 1) {
    const s = granted[0];
    showToast(s.placed
      ? `🏆 A ${s.name.toLowerCase()} arrived in your paddock, a keepsake for the horses you've rehomed 💛`
      : `🏆 A ${s.name.toLowerCase()} is waiting in your Tack room, a keepsake for the horses you've rehomed 💛`);
  } else {
    showToast(`🏆 ${granted.length} keepsake statues arrived for the horses you've rehomed. Check your paddock and Tack room 💛`);
  }
  if (granted.some((s) => s.placed)) renderAll(state); // show any auto-placed statue
  refreshUI(); // badge the Tack room for any that went to the stores
  persist();
}

deliverPostcards(collectDuePostcards());
grantStatues();

const DONATE_URL = 'https://donorbox.org/donate-to-arch?amount=10';

// ---- paddock life: bills & Visitors Day ----
// Illustrated story cards (see updatePaddockLife in game.js). Each bill kind
// maps to its artwork, its dialog copy, its pay-button label, and the warm
// toast shown once it's paid.

const BILL_ART = {
  vet: 'assets/events/vet-visit.jpg',
  farrier: 'assets/events/farrier-visit.jpg',
  hay: 'assets/events/hay-delivery.jpg',
  water: 'assets/events/water-delivery.jpg',
  mechanic: 'assets/events/horse-box.jpg',
  barn: 'assets/events/stable-repairs.jpg',
  journalist: 'assets/events/journalist-offer.jpg',
  foal: 'assets/events/foal-born.jpg',
};

function billCopy(e) {
  const fee = fig(`€${e.fee}`);
  if (e.kind === 'vet') {
    return {
      pay: 'Book the vet',
      text: e.variant === 'worming'
        ? `${fig(e.horseName)} is due a worming treatment. The vet can pop out today for ${fee}.`
        : `The vet is due to see ${fig(e.horseName)} for a check-up. She can come out today for ${fee}.`,
    };
  }
  if (e.kind === 'farrier') return {
    pay: 'Book the farrier',
    text: `${fig(e.horseName)} needs new shoes! The farrier can come out today for ${fee}.`,
  };
  if (e.kind === 'hay') return {
    pay: 'Pay for the hay',
    text: `The hay delivery has arrived: enough bales to keep everyone fed and cosy. The bill comes to ${fee}.`,
  };
  if (e.kind === 'water') return {
    pay: 'Pay for the water',
    text: `A water delivery has arrived to fill the troughs, fresh and clean for the whole herd. The bill comes to ${fee}.`,
  };
  if (e.kind === 'barn') return {
    pay: 'Fix the stable',
    text: `The stable roof is letting the rain in. The volunteers can patch it up properly for ${fee}.`,
  };
  if (e.kind === 'journalist') return {
    pay: 'Pay for the story',
    text: `A journalist from the Sur wants to write a feature about the rescue. A story like that could bring in real support, for a fee of ${fee}.`,
  };
  if (e.kind === 'foal') return {
    pay: 'Welcome the foal',
    text: `Wonderful news: ${fig(e.horseName)} has had a foal! Raising a newborn and its mother isn't cheap, ${fee} to see them both right, but a cute new arrival is sure to draw some visitors.`,
  };
  return {
    pay: 'Fix the horse box',
    text: `The horse box needs a repair before it can fetch any more horses. The mechanic can fix it today for ${fee}.`,
  };
}

function billPaidToast(res) {
  if (res.kind === 'vet') return `🩺 ${res.horse?.name ?? 'Everyone'} has a clean bill of health 💛`;
  if (res.kind === 'farrier') return `✨ ${res.horse?.name ?? 'The herd'}'s new shoes are turning heads!`;
  if (res.kind === 'hay') return '🌾 The hay barn is full: the whole herd is fed and holding their shine 💛';
  if (res.kind === 'water') return '💧 The troughs are brimming with fresh water: the whole herd is content 💛';
  if (res.kind === 'barn') return '🔨 The stable is snug and dry again, and the smart new roof is turning heads 💛';
  if (res.kind === 'journalist') return '📰 The journalist got the full tour. Watch the paper: the story runs soon!';
  if (res.kind === 'foal') return `🐴 The foal is up on its wobbly legs, and word of the new arrival is bringing visitors 💛`;
  return '🔧 The horse box is roadworthy again, ready for the next rescue 💛';
}

/** Turn one event into either a toast or a queued modal dialog. */
function handleEvent(e) {
  if (e.type === 'rehome-offer') {
    enqueueDialog({
      emoji: '🏡',
      text: `${e.horseName} is ready for rehoming. Agree to adoption for ${fig(`€${e.income}`)}?`,
      buttons: [
        { label: 'Yes please!', variant: 'primary', onClick: () => {
          const res = acceptRehome();
          if (res) {
            if (res.leftBehind && !state.milestones.leftBehindShown) {
              leftBehindHorseName = res.horse.name;
              leftBehindPending = true; // refreshUI's nudge sweep will surface it
            }
            resetPaddockView(); renderAll(state); refreshUI(); persist();
          }
        } },
        { label: 'Not now', variant: 'ghost', onClick: () => declineRehome() },
      ],
    });
  } else if (e.type === 'rescue-milestone') {
    enqueueDialog({
      emoji: '🎉', share: true,
      text: `You have rescued ${fig(e.count)} horses. What an amazing job you're doing! Here's ${fig(`€${e.bonus}`)} extra to keep up the good work.`,
      buttons: [{ label: 'Collect', variant: 'primary', onClick: () => {
        // First rescue milestone doubles as the leaderboard's introduction.
        // Queued persistently: if another onboarding nudge holds the slot
        // right now, this one shows at a later sweep instead of being lost.
        if (!state.milestones.leaderboardNudgeShown && !state.leaderboard.optedIn) {
          state.milestones.leaderboardNudgeQueued = true;
          save();
          updateOnboardingNudges();
        }
      } }],
    });
  } else if (e.type === 'rehome-milestone') {
    enqueueDialog({
      emoji: '🎉', share: true,
      text: `You have re-homed ${fig(e.count)} horses. What an amazing job you're doing! Here's ${fig(`€${e.bonus}`)} extra to keep up the good work.`,
      buttons: [{ label: 'Collect', variant: 'primary' }],
    });
  } else if (e.type === 'gift-horse') {
    // A magical gift horse (rainbow at 50, golden at 100). It's already in the
    // herd; show it, then a congratulations popup.
    resetPaddockView();
    renderAll(state);
    const kind = e.coat === 'golden' ? 'golden horse 🌟' : 'rainbow horse 🌈';
    enqueueDialog({
      emoji: e.coat === 'golden' ? '🌟' : '🌈', confetti: true, share: true,
      text: `You've saved ${fig(e.count)} horses! 🎉 That's an incredible thing to have done, so here's a gift: a magical ${kind} has come to live in your paddock. Say hello to ${e.name}!`,
      buttons: [{ label: 'Wonderful!', variant: 'primary' }],
    });
  } else if (e.type === 'donate-milestone') {
    // The 10-rescue donate beat. If the unicorn's still unclaimed, this is where
    // it's offered (the magical-friend ask, with confetti); once it's home the
    // same beat becomes a plain thank-you donate nudge.
    if (hasUnicorn(state)) {
      enqueueDialog({
        emoji: '💛', confetti: true,
        text: `You have rescued ${fig(e.count)} horses. If you're enjoying this game, why not donate to ARCH to help our real horses too?`,
        buttons: [
          { label: 'Donate', variant: 'primary', onClick: () => { window.open(DONATE_URL, '_blank', 'noopener'); markDonatedForReal(); } },
          { label: "Don't ask again", variant: 'ghost', onClick: () => { state.milestones.donateOptOut = true; save(); } },
        ],
      });
    } else {
      unicornSnoozed = true; // this beat is the session's unicorn offer; don't double up
      enqueueDialog({
        emoji: '🦄', confetti: true,
        text: `You've rescued ${fig(e.count)} horses! The ones here are pretend, but the horses at ARCH are real, and they need help. Donate to the rescue and a magical friend will come to live in your paddock 💛`,
        buttons: [
          { label: 'Donate 💛', variant: 'primary', onClick: claimUnicorn },
          { label: "Don't ask again", variant: 'ghost', onClick: () => { state.milestones.donateOptOut = true; save(); } },
        ],
      });
    }
  } else if (e.type === 'bill') {
    const copy = billCopy(e);
    enqueueDialog({
      emoji: '', image: BILL_ART[e.kind],
      text: copy.text,
      buttons: [
        { label: `${copy.pay} · €${e.fee}`, variant: 'primary', onClick: () => {
          const res = acceptBill();
          if (!res?.ok) return;
          showToast(billPaidToast(res));
          if (res.supporters > 0) showSupporterPop(res.supporters); // mechanic admirers, foal well-wishers
          state.horses.forEach(updateHorseCard); // topped-up bars show right away
          runAchievementCheck(); // farrier / worming / good-books badges
          refreshUI();
          persist();
        } },
        { label: 'Not just yet', variant: 'ghost', onClick: () => declineBill() },
      ],
    });
  } else if (e.type === 'visitors-planning') {
    enqueueDialog({
      emoji: '', image: 'assets/events/volunteer-planning.jpg',
      text: `The volunteers are planning a ${fig('Visitors Day')}! People will be coming to meet the horses very soon. A well-groomed herd and a pretty paddock will make it a day to remember 💛`,
      // The countdown to the day starts from this dismissal (issue #53), so
      // the preparation window belongs to the player, not to a background tab.
      buttons: [{ label: "We'll be ready!", variant: 'primary', onClick: () => scheduleVisitorsDay() }],
    });
    // The day itself follows in a few minutes; have its artwork ready and waiting.
    new Image().src = 'assets/events/visitors-day.jpg';
  } else if (e.type === 'article') {
    const followers = ` ${fig(e.followers)} readers started following the rescue!`;
    enqueueDialog({
      emoji: '', image: 'assets/events/newspaper-article.jpg', confetti: e.frontPage, share: true,
      text: e.frontPage
        ? `Front page! The Sur ran the story right up top, and donations came flooding in: ${fig(`€${e.income}`)} for the rescue 💛${followers}`
        : `The article is out! The Sur's feature brought in ${fig(`€${e.income}`)} of donations 💛${followers}`,
      buttons: [{ label: e.frontPage ? 'Incredible!' : 'Lovely!', variant: 'primary' }],
    });
  } else if (e.type === 'reunion') {
    const who = e.returned === 1
      ? 'One of the horses you found a forever home for came back'
      : `${fig(e.returned)} of the horses you found forever homes for came back`;
    enqueueDialog({
      emoji: '', image: 'assets/events/reunion-day.jpg', confetti: true, share: true,
      text: `Reunion Day! ${who} to visit, families in tow. Seeing them so happy won the rescue ${fig(e.newSupporters)} new supporters 💛`,
      buttons: [{ label: 'What a day 💛', variant: 'primary' }],
    });
  } else if (e.type === 'utilidad') {
    enqueueDialog({
      emoji: '', image: 'assets/events/utilidad-publica.jpg', confetti: true, share: true,
      text: `Big news: ARCH has been declared ${fig('Utilidad Pública')}! It's Spain's official recognition for charities that serve the public good, and it means donations to the rescue now attract tax relief, so every supporter's euro goes a little further. Supporter donations are worth ${fig('10%')} more, forever 💛`,
      buttons: [{ label: 'What an honour!', variant: 'primary' }],
    });
  } else if (e.type === 'visitors-day') {
    const followers = e.newSupporters > 0
      ? ` ${fig(e.newSupporters)} of them liked it so much they started following the rescue!`
      : '';
    enqueueDialog({
      emoji: '', image: 'assets/events/visitors-day.jpg', confetti: true, share: true,
      text: `Visitors Day! ${fig(e.visitors)} people came to meet the horses, and entry donations raised ${fig(`€${Math.round(e.income)}`)} for the rescue 💛${followers}`,
      buttons: [{ label: 'Wonderful!', variant: 'primary' }],
    });
  } else if (e.type === 'breakthrough') {
    // A fear horse's big day: the toast tells the story, the supporter pop
    // shows who it reached, and refreshUI (via processEvents) lights up the
    // freshly-filled share meter.
    showToast(e.message);
    showSupporterPop(e.supporters);
  } else if (e.type === 'supporter-quiet') {
    showSupporterPop(e.count); // subtle chip pop, not a toast
  } else if (e.type === 'supporter-milestone') {
    showToast(`🎉 ${e.count} people now follow the rescue 💛`);
  } else if (e.type === 'season-change') {
    // A gentle toast; the paddock backdrop re-skins to match (renderPaddock
    // reads the season), so re-render the scene without disturbing the view.
    showToast(e.message);
    renderAll(state);
  } else {
    showToast(e.message);
  }
}

function processEvents(events) {
  if (!events.length) return;
  events.forEach(handleEvent);
  // The unicorn offer isn't fired here: the 10-rescue 'donate-milestone' event
  // (handled above) is the single trigger for the crossing, and maybeOfferUnicorn
  // on load covers returning players. Firing it here too would double the popup.
  runAchievementCheck();
  refreshUI();
  persist(); // story beats are worth persisting immediately
}

// ---- pride-only badges (issue #65) ----
// Grant any freshly-earned badge and toast it, one at a time so a spree (e.g.
// crossing a rescue milestone that also unlocks a tier) doesn't stack. Called
// after any moment that could unlock one. refreshUI relights the book dot.
function runAchievementCheck() {
  const earned = checkAchievements(state);
  if (!earned.length) return;
  for (const a of earned) showToast(`🎖️ Badge earned: ${a.name} — ${a.hint}`);
  renderCollectionButton(state);
  persist();
}

// share.js sets its honour flag on a low level and pings us to check (avoids a
// circular import). Same hook is future-proof for any other decoupled unlock.
window.addEventListener('achievements-check', runAchievementCheck);

function handleCare(card, event) {
  const horse = state.horses.find((h) => h.id === card.dataset.horseId);
  if (!horse) return;
  // A tap on a horse that wants something tends the want; otherwise it's a
  // normal care click. Either way the tap still cares for the horse.
  const want = fulfilWant(horse.id);
  const { message, crit, tip, events } = careFor(horse);
  updateHorseCard(horse);
  if (want) {
    showWantFulfilled(card, want, event); // its own flavour + supporter-burst pops
    renderWantBubbles(state);             // clear the tended bubble
    renderHUD(state);                     // supporters jumped
    if (want.coins > 0) showMoneyPop(want.coins); // meter overflow, paid out directly
    refreshUI();                          // the share meter just jumped — show it
    persist();
  } else {
    showCareFeedback(card, message, event, { crit });
  }
  if (tip) {
    showTipPop(card, tip);
    renderHUD(state); // the tip lands in the fund right away
    persist();        // money changed — tips are rare enough to save on the spot
  }
  processEvents(events);
}

const horsesEl = document.getElementById('horses');

horsesEl.addEventListener('click', (event) => {
  const card = event.target.closest('.horse');
  if (card) handleCare(card, event);
});

document.getElementById('actions').addEventListener('click', (event) => {
  if (event.target.closest('#share-btn')) {
    const result = shareUpdate();
    if (!result) return; // still recharging (the button should be disabled anyway)
    showMoneyPop(result.amount);
    if (result.viral) {
      // A full-charge share took off: celebrate the jackpot and its new crowd.
      burstConfetti();
      showSupporterPop(result.newSupporters);
      showToast(`🚀 Your update went viral! €${result.amount.toFixed(2)} raised and ${result.newSupporters} new followers 💛`);
    }
    if (!state.milestones.hasSharedUpdate) {
      state.milestones.hasSharedUpdate = true;
      save();
    }
    refreshUI(); // empties the charge meter; dismisses the share nudge, then surfaces the shop nudge
    return;
  }
  if (event.target.closest('#rescue-btn')) {
    const { ok, reason, events } = rescueHorse();
    if (ok) {
      recordRescue(); // count it toward this month's leaderboard
      state.milestones.hasRescuedAgain = true; // resolves the rescue nudge
      resetPaddockView(); // always show the new arrival
      renderAll(state);
      processEvents(events);
    } else if (reason === 'needs-care') {
      showToast('You still have horses which need help', 'alert');
    } else if (reason === 'full') {
      showFullPaddocksDialog();
    }
  }
});

// Every paddock space is taken: exactly how the real rescue works. The two
// ways to make room are both offered on the spot.
function showFullPaddocksDialog() {
  const price = nextPaddockPrice(state);
  const buttons = [
    { label: '🏡 Ask around for a forever home', variant: 'primary', onClick: () => {
      const offer = requestRehome();
      if (offer) processEvents([offer]);
      else showToast('No horse is settled enough for a forever home yet. Keep caring!', 'alert');
    } },
  ];
  if (price !== null) {
    buttons.push({ label: `🔨 Build a paddock · €${price}`, onClick: () => {
      const res = buyPaddock(state);
      if (res.ok) {
        showToast(`🎉 The ${paddockLabel(res.count - 1)} is ready: room for 8 more horses, and a fresh spot to decorate!`);
        renderAll(state);
        refreshUI();
        persist();
      } else {
        showToast(`A new paddock costs €${price}. Keep fundraising!`, 'alert');
      }
    } });
  }
  buttons.push({ label: 'Not now', variant: 'ghost' });
  enqueueDialog({
    emoji: '🐴',
    text: price !== null
      ? `The rescue is full: every paddock space is taken. Find a thriving horse a forever home, or build a new paddock for ${fig(`€${price}`)}.`
      : 'The rescue is full: every paddock space is taken. Find a thriving horse a forever home to make room.',
    buttons,
  });
}

document.getElementById('nav-older').addEventListener('click', () => changePaddock(1, state));
document.getElementById('nav-newer').addEventListener('click', () => changePaddock(-1, state));

// ---- shop ----

document.getElementById('shop-btn').addEventListener('click', () => {
  if (!state.milestones.shopIntroDone) {
    state.milestones.shopIntroDone = true;
    save();
  }
  updateOnboardingNudges(); // clears the shop nudge if it was up
  openShopModal(state);
});
// Close the shop, then flush any dialogs (rehome offers, milestones) that were
// held back while it was open -- see the guard in pumpDialogs.
function closeShop() {
  closeShopModal();
  pumpDialogs();
}
document.getElementById('shop-close').addEventListener('click', closeShop);
document.getElementById('shop-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'shop-overlay') closeShop();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!document.getElementById('shop-overlay').hidden) closeShop();
  if (!document.getElementById('album-overlay').hidden) closePostcardAlbum();
  if (!document.getElementById('collection-overlay').hidden) closeCollection();
  if (!document.getElementById('privacy-overlay').hidden) closePrivacy();
  if (!document.getElementById('sync-overlay').hidden) closeSync();
});

// ---- privacy popup ----
// NOTE: this popup is the game's privacy notice. Any feature that changes what
// data is collected, stored, or shown publicly (email linking, leaderboard,
// analytics, ...) must update its copy in the same change.

function closePrivacy() {
  document.getElementById('privacy-overlay').hidden = true;
}
async function openPrivacy() {
  document.getElementById('privacy-overlay').hidden = false;
  // Fill in the anonymous cloud id so a player can quote it in a deletion
  // request; resolves after the popup is already up, so no waiting.
  const id = await getCloudUserId();
  document.getElementById('privacy-player-id').textContent =
    id ?? 'none: playing locally in this browser only';
}
document.getElementById('privacy-link').addEventListener('click', openPrivacy);
document.getElementById('privacy-close').addEventListener('click', closePrivacy);
document.getElementById('privacy-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'privacy-overlay') closePrivacy();
});
document.getElementById('privacy-to-sync').addEventListener('click', () => {
  closePrivacy();
  openSync();
});

// ---- save & sign in popup ----
// Cross-device continuity is a distinct thing from the privacy notice --
// "how do I get my progress somewhere else" isn't a data-practices question,
// so it gets its own popup rather than living inside Game privacy.

function closeSync() {
  document.getElementById('sync-overlay').hidden = true;
}
async function openSync() {
  document.getElementById('sync-overlay').hidden = false;
  // Once Google's linked, there's no reason to offer linking it again --
  // swap the button for a plain status line instead. The conflict card is
  // only ever revealed right after a real conflict (see googleReturn
  // handling above), so a normal open always starts with it hidden.
  document.getElementById('google-conflict').hidden = true;
  const linked = await isGoogleLinked();
  document.getElementById('google-signin-btn').hidden = linked;
  const status = document.getElementById('google-status');
  status.hidden = !linked;
  if (linked) status.textContent = 'Google is connected to this save.';
}
document.getElementById('sync-link').addEventListener('click', openSync);
document.getElementById('sync-close').addEventListener('click', closeSync);
document.getElementById('sync-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'sync-overlay') closeSync();
});

// Data portability: hand the player their whole save as a JSON download.
document.getElementById('privacy-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(gameState, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `horsing-around-save-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Self-service erasure: two taps (the button re-labels itself as the confirm
// step, and disarms after a few seconds), then cloud row + local save are
// wiped and the page reloads into a fresh game. If the cloud half fails, say
// so and delete nothing -- a half-truthful "all gone" would be worse than an
// error.
const deleteBtn = document.getElementById('privacy-delete');
const DELETE_LABEL = deleteBtn.textContent;
let deleteArmedTimer = null;
deleteBtn.addEventListener('click', async () => {
  if (!deleteArmedTimer) {
    deleteBtn.textContent = 'Really delete everything? Tap again';
    deleteBtn.classList.add('is-armed');
    deleteArmedTimer = setTimeout(() => {
      deleteArmedTimer = null;
      deleteBtn.textContent = DELETE_LABEL;
      deleteBtn.classList.remove('is-armed');
    }, 6000);
    return;
  }
  clearTimeout(deleteArmedTimer);
  deleteBtn.disabled = true;
  deleteBtn.textContent = 'Deleting…';
  const cloudGone = await deleteCloudData();
  if (!cloudGone) {
    deleteBtn.disabled = false;
    deleteArmedTimer = null;
    deleteBtn.textContent = 'Couldn’t reach the cloud, nothing deleted. Try again?';
    deleteBtn.classList.remove('is-armed');
    return;
  }
  // The beforeunload/visibilitychange handlers fire during the reload and
  // would write the save straight back -- shut saving off before wiping.
  disableSaving();
  localStorage.removeItem(SAVE_KEY);
  location.replace(location.pathname);
});

// ---- save across devices (issue #25): no-email cross-device transfer ----
// A code minted for this save copies it onto whichever device redeems it.
// Not a sign-in -- see js/saveCode.js for why, and supabase/schema.sql for
// the security-definer functions that do the actual work.

const scGetCodeBtn = document.getElementById('sc-get-code');
const scCodeDisplay = document.getElementById('sc-code-display');
const scCodeValue = document.getElementById('sc-code-value');
const scCodeEntry = document.getElementById('sc-code-entry');
const scCodeInput = document.getElementById('sc-code-input');
const scCodeSubmit = document.getElementById('sc-code-submit');
const scCodeError = document.getElementById('sc-code-error');
const scConfirm = document.getElementById('sc-confirm');
const scConfirmText = document.getElementById('sc-confirm-text');
const scConfirmLoad = document.getElementById('sc-confirm-load');

let scPreviewedState = null; // the game_state previewSaveCode found, awaiting confirm
let scPreviewedCode = null;

function scResetPanels() {
  scCodeDisplay.hidden = true;
  scCodeEntry.hidden = true;
  scConfirm.hidden = true;
  scCodeError.hidden = true;
  scCodeInput.value = '';
  scPreviewedState = null;
  scPreviewedCode = null;
}

scGetCodeBtn.addEventListener('click', async () => {
  scResetPanels();
  scGetCodeBtn.disabled = true;
  scGetCodeBtn.textContent = 'Getting a code…';
  const code = await createSaveCode();
  scGetCodeBtn.disabled = false;
  scGetCodeBtn.textContent = 'Get a code for this device';
  if (!code) {
    showToast('Couldn’t reach the service just now. Try again in a bit.', 'alert');
    return;
  }
  scCodeValue.textContent = code;
  scCodeDisplay.hidden = false;
});

function openSaveCodeEntry() {
  scResetPanels();
  scCodeEntry.hidden = false;
  scCodeInput.focus();
}
document.getElementById('sc-open-entry').addEventListener('click', openSaveCodeEntry);

scCodeSubmit.addEventListener('click', async () => {
  const code = scCodeInput.value.trim();
  if (!code) return;
  scCodeSubmit.disabled = true;
  scCodeSubmit.textContent = 'Looking up…';
  const result = await previewSaveCode(code);
  scCodeSubmit.disabled = false;
  scCodeSubmit.textContent = 'Look it up';
  if (!result.ok) {
    scCodeError.hidden = false;
    scCodeError.textContent = result.reason === 'invalid'
      ? 'That code isn’t valid, or it’s expired. Double-check it, or get a new one on the other device.'
      : 'Couldn’t reach the service just now. Try again in a bit.';
    return;
  }
  scCodeError.hidden = true;
  scPreviewedState = result.gameState;
  scPreviewedCode = code;
  const horseCount = result.gameState?.horses?.length ?? 0;
  const since = result.gameState?.stats?.startedAt ? formatDate(result.gameState.stats.startedAt) : null;
  scConfirmText.textContent = `Found a paddock with ${horseCount} ${horseCount === 1 ? 'horse' : 'horses'}` +
    (since ? `, caring since ${since}` : '') + '. Load it here?';
  scCodeEntry.hidden = true;
  scConfirm.hidden = false;
});

document.getElementById('sc-confirm-cancel').addEventListener('click', scResetPanels);

scConfirmLoad.addEventListener('click', async () => {
  if (!scPreviewedCode || !scPreviewedState) return;
  scConfirmLoad.disabled = true;
  scConfirmLoad.textContent = 'Loading…';
  const result = await confirmSaveCode(scPreviewedCode);
  scConfirmLoad.disabled = false;
  scConfirmLoad.textContent = 'Load it here';
  if (result !== 'ok') {
    showToast(result === 'invalid'
      ? 'That code just expired or was already used. Get a fresh one on the other device.'
      : 'Couldn’t reach the service just now. Try again in a bit.', 'alert');
    return;
  }
  adoptCloudState(scPreviewedState);
  state.milestones.restoreWhisperRetired = true; // they've got their real game now
  scResetPanels();
  closePrivacy();
  resetPaddockView();
  renderAll(state);
  refreshUI();
  save();
  pushCloudSave(); // this device's cloud row should reflect the adopted state too
  showToast('Welcome back! Your paddock is here 💛', 'ok');
});

// Google sign-in. Both redirect away immediately -- see js/google.js for why
// the feedback toast happens on the *next* load instead of here.
//
// One button, one safe default: always try to attach Google to this save
// first. If that Google account turns out to already have a save of its own,
// Supabase reports it as an error on the redirect back (see googleReturn
// handling above), and only then does the conflict card offer a real choice:
// load that other save here, or save this device's game there instead
// (overwriting what that account had).
// A full-page redirect can take a visible moment to actually kick in (a
// network round trip to build the authorize URL happens before the browser
// navigates anywhere) -- with no feedback in between, a click looked like it
// did nothing. Give every Google button an immediate "Redirecting…" state,
// and if the call comes back false (it failed before ever navigating --
// misconfigured, or Supabase rejecting the request outright), restore the
// button and say so, rather than leaving it stuck with no explanation.
async function runGoogleRedirect(button, attempt) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Redirecting to Google…';
  const started = await attempt();
  if (!started) {
    button.disabled = false;
    button.textContent = label;
    showToast('Couldn’t reach Google just now. Try again in a bit.', 'alert');
  }
  // If it did start, the page is already navigating away -- nothing left to do.
}

document.getElementById('google-signin-btn').addEventListener('click', (e) => {
  runGoogleRedirect(e.target, () => linkGoogle());
});
document.getElementById('google-conflict-load').addEventListener('click', (e) => {
  runGoogleRedirect(e.target, () => signInWithGoogle('signin'));
});
document.getElementById('google-conflict-override').addEventListener('click', (e) => {
  // Stash this device's save before the redirect -- nothing in memory
  // survives it, and main.js's googleReturn handling reads this back once
  // we're signed in as the other account.
  localStorage.setItem(OVERRIDE_STASH_KEY, JSON.stringify(gameState));
  runGoogleRedirect(e.target, () => signInWithGoogle('override'));
});
// No separate cancel action here -- the modal's own × (sync-close) already
// dismisses the card without doing anything, and the conflict card's own
// text points players there.

// The header whisper: quiet, and only ever seen on a brand-new save (see
// updateRestoreWhisper). Jumps straight to the code-entry step, since anyone
// who taps this already knows what they want.
document.getElementById('restore-whisper').addEventListener('click', async () => {
  await openSync();
  openSaveCodeEntry();
});

const RESTORE_WHISPER_MS = 10 * 60 * 1000; // 10 minutes of play retires it
function updateRestoreWhisper() {
  const whisper = document.getElementById('restore-whisper');
  const m = state.milestones;
  if (m.restoreWhisperRetired) {
    whisper.hidden = true;
    return;
  }
  const outgrown = state.stats.horsesRescued > 1 // more than just Biscuit
    || Date.now() - state.stats.startedAt > RESTORE_WHISPER_MS;
  if (outgrown) {
    m.restoreWhisperRetired = true;
    whisper.hidden = true;
    save();
    return;
  }
  whisper.hidden = false;
}
updateRestoreWhisper();

// ---- postcard album ----

document.getElementById('album-btn').addEventListener('click', () => {
  markPostcardsRead(state);   // opening the album clears the unread badge
  openPostcardAlbum(state);
  renderPostcardButton(state);
  persist();
});
document.getElementById('album-close').addEventListener('click', closePostcardAlbum);
document.getElementById('album-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'album-overlay') closePostcardAlbum();
});

// ---- collection book ----

// Switch between the tabs inside the collection modal.
const COLLECTION_TABS = {
  collection:  { tab: 'tab-collection',  panel: 'panel-collection',  title: 'Collection' },
  badges:      { tab: 'tab-badges',      panel: 'panel-badges',      title: 'Badges' },
  stats:       { tab: 'tab-stats',       panel: 'panel-stats',       title: 'Stats' },
  leaderboard: { tab: 'tab-leaderboard', panel: 'panel-leaderboard', title: 'Top rescuers' },
};

function showCollectionTab(name) {
  for (const [key, ids] of Object.entries(COLLECTION_TABS)) {
    const active = key === name;
    document.getElementById(ids.panel).hidden = !active;
    const tab = document.getElementById(ids.tab);
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  document.getElementById('collection-title').textContent = COLLECTION_TABS[name].title;
  if (name === 'badges') {
    renderAchievements(state);
    state.achievementsSeen = state.achievements.length; // clear the "new" dot
    renderCollectionButton(state);
    persist();
  }
  if (name === 'stats') renderStats(state);
  if (name === 'leaderboard') renderLeaderboardPanel();
}

document.getElementById('collection-btn').addEventListener('click', () => {
  state.collectionSeen = state.collectedCoats.length; // clear the "new" dot
  state.milestones.collectionIntroDone = true;        // they've found it; no nudge needed
  showCollectionTab('collection'); // always open on the Collection tab
  openCollection(state);
  renderCollectionButton(state);
  updateOnboardingNudges(); // clears the collection nudge if it's up
  persist();
});
document.getElementById('tab-collection').addEventListener('click', () => showCollectionTab('collection'));
document.getElementById('tab-badges').addEventListener('click', () => showCollectionTab('badges'));
document.getElementById('tab-stats').addEventListener('click', () => showCollectionTab('stats'));
document.getElementById('tab-leaderboard').addEventListener('click', () => showCollectionTab('leaderboard'));

// ---- monthly leaderboard panel ----

// The champion's rosette (issue #66): worn on the board by last month's
// winner until the next one is crowned. Inline SVG in the game's flat style —
// cozy purple, the same family as the ear flower, boots and saddle blanket.
const ROSETTE_SVG = `
<svg class="lb-rosette" viewBox="0 0 24 30" aria-label="last month's champion" role="img">
  <path d="M8 14 L4.5 27 L10 23.5 Z" fill="#8A5BB8"/>
  <path d="M16 14 L19.5 27 L14 23.5 Z" fill="#6E4497"/>
  <g fill="#A971D6">
    <circle cx="19" cy="11" r="3.6"/><circle cx="16.9" cy="16" r="3.6"/>
    <circle cx="12" cy="18" r="3.6"/><circle cx="7.1" cy="16" r="3.6"/>
    <circle cx="5" cy="11" r="3.6"/><circle cx="7.1" cy="6" r="3.6"/>
    <circle cx="12" cy="4" r="3.6"/><circle cx="16.9" cy="6" r="3.6"/>
  </g>
  <circle cx="12" cy="11" r="6.6" fill="#A971D6"/>
  <circle cx="12" cy="11" r="4.4" fill="#F0E6FA" stroke="#7E51AE" stroke-width="1.2"/>
</svg>`;

let lbPreviewName = null; // the generated name on offer in the join card

async function renderLeaderboardPanel() {
  rolloverIfNeeded();
  const lb = state.leaderboard;
  // They've found the board; the milestone nudge needn't ever fire.
  if (!state.milestones.leaderboardNudgeShown) {
    state.milestones.leaderboardNudgeShown = true;
    save();
  }
  document.getElementById('leaderboard-intro').textContent =
    `Top rescuers for ${monthLabel()}. The board starts fresh on the 1st of each month.`;
  document.getElementById('leaderboard-join').hidden = lb.optedIn;
  document.getElementById('leaderboard-board').hidden = !lb.optedIn;

  if (!lb.optedIn) {
    lbPreviewName ??= generateName();
    document.getElementById('lb-name-preview').textContent = lbPreviewName;
    return;
  }

  document.getElementById('lb-own-name').textContent = lb.name;
  const list = document.getElementById('lb-list');
  const championEl = document.getElementById('lb-champion');
  championEl.hidden = true;
  list.innerHTML = '<li class="lb-status">Loading the board…</li>';
  await pushScore(); // our row should be current before we read (may also heal a stuck name)
  document.getElementById('lb-own-name').textContent = lb.name; // pushScore can reroll it
  const [rows, champion] = await Promise.all([fetchBoard(), fetchChampion()]);
  if (!rows) {
    list.innerHTML = '<li class="lb-status">Couldn\'t reach the board just now. Try again in a bit.</li>';
    return;
  }
  if (champion) {
    championEl.hidden = false;
    championEl.innerHTML =
      `${ROSETTE_SVG} Reigning champion: <strong>${champion.name}</strong> · ${champion.rescues} rescues in ${prevMonthLabel()}`;
  }
  if (rows.length === 0) {
    list.innerHTML = '<li class="lb-status">Nobody on the board yet this month.</li>';
    return;
  }
  list.innerHTML = '';
  rows.forEach((row, i) => {
    const li = document.createElement('li');
    li.className = 'lb-row' + (row.you ? ' lb-you' : '');
    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    rank.textContent = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`;
    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = row.name + (row.you ? ' (you)' : '');
    // Last month's winner wears the rosette all this month.
    if (champion && row.name === champion.name) name.insertAdjacentHTML('beforeend', ROSETTE_SVG);
    const score = document.createElement('span');
    score.className = 'lb-score';
    score.textContent = `${row.rescues} ${row.rescues === 1 ? 'rescue' : 'rescues'}`;
    li.append(rank, name, score);
    list.appendChild(li);
  });
}

document.getElementById('lb-reroll').addEventListener('click', () => {
  lbPreviewName = generateName();
  document.getElementById('lb-name-preview').textContent = lbPreviewName;
});

document.getElementById('lb-join').addEventListener('click', async () => {
  const btn = document.getElementById('lb-join');
  btn.disabled = true;
  btn.textContent = 'Joining…';
  // The database enforces one name per month; on a collision quietly reroll,
  // falling back to a numbered variant so joining never dead-ends.
  let name = lbPreviewName ?? generateName();
  let result = 'error';
  for (let attempt = 0; attempt < 6; attempt++) {
    result = await joinBoard(name);
    if (result !== 'taken') break;
    name = attempt < 3 ? generateName() : `${generateName()} ${2 + Math.floor(Math.random() * 97)}`;
  }
  btn.disabled = false;
  btn.textContent = 'Join the board';
  if (result !== 'ok') {
    showToast('Couldn\'t reach the board just now. Try again in a bit.', 'alert');
    return;
  }
  lbPreviewName = null;
  persist();
  renderLeaderboardPanel();
});

document.getElementById('lb-leave').addEventListener('click', async () => {
  const btn = document.getElementById('lb-leave');
  btn.disabled = true;
  const ok = await leaveBoard();
  btn.disabled = false;
  if (!ok) {
    showToast('Couldn\'t reach the board just now. Try again in a bit.', 'alert');
    return;
  }
  persist();
  renderLeaderboardPanel();
});
document.getElementById('collection-close').addEventListener('click', closeCollection);
document.getElementById('collection-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'collection-overlay') closeCollection();
});

// ---- social sharing ----
// One delegated listener for every [data-share-game] button (postcards +
// collection headers today; anywhere they're added later, for free).
initShare();

document.getElementById('shop-modal').addEventListener('click', (event) => {
  // "Grow the rescue" facility upgrades (issue #48) are their own big-ticket buy.
  const facilityBtn = event.target.closest('.facility-buy-btn');
  if (facilityBtn) {
    const { ok, facility } = buyFacility(state, facilityBtn.dataset.facilityId);
    if (!ok) return;
    const capstone = facility.id === 'sanctuary-field';
    runAchievementCheck();     // may earn "A place of their own"
    renderShopModal(state);    // reflect built state + reveal the next rung
    renderAll(state);          // a new paddock may now be buildable (sanctuary)
    refreshUI();
    persist();
    // A big-ticket upgrade deserves a moment: an illustrated congratulations
    // card (it queues behind the open shop and pops when it's closed).
    enqueueDialog({
      emoji: facility.art ? '' : facility.icon,
      image: facility.art ?? null,
      confetti: capstone,
      text: capstone
        ? `The ${fig(facility.name)} is complete: ARCH is a true sanctuary now. ${facility.blurb} What a journey 💛`
        : `The ${fig(facility.name)} is built! ${facility.blurb}`,
      buttons: [{ label: capstone ? 'What a journey 💛' : 'Wonderful!', variant: 'primary' }],
    });
    return;
  }
  const buy = event.target.closest('.shop-buy-btn');
  const action = event.target.closest('[data-action]');
  if (!buy && !action) return;
  // The target (which horse / which paddock) is chosen once per section, not
  // per item, so every buy/place/remove acts on the current selection.
  const itemId = (buy ?? action).dataset.itemId;
  let ok = false;
  if (buy) {
    if (buy.dataset.cat === 'decor') ({ ok } = buyDecorIn(itemId, shopDecorPaddock(), state));
    else ({ ok } = buyWardrobe(itemId, shopWardrobeHorse(), state));
  } else {
    switch (action.dataset.action) {
      case 'place-decor': ({ ok } = placeDecor(itemId, shopDecorPaddock(), state)); break;
      case 'remove-decor': ({ ok } = removeDecor(itemId, shopDecorPaddock(), state)); break;
      case 'place-wardrobe': ({ ok } = placeWardrobe(itemId, shopWardrobeHorse(), state)); break;
      case 'remove-wardrobe': ({ ok } = removeWardrobe(itemId, shopWardrobeHorse(), state)); break;
    }
  }
  if (!ok) return;
  runAchievementCheck(); // dressing / buying can complete Best dressed, Compulsive shopper
  renderShopModal(state); // refresh owned/stored/afford states within the open modal
  renderAll(state); // wardrobe/decor changes show up on the horses/paddock immediately
  persist();
});

horsesEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.horse');
  if (card) {
    event.preventDefault();
    handleCare(card, null);
  }
});

// A returning player who's already past the 10-rescue mark (but hasn't got the
// unicorn) gets the offer on load too, after any welcome-back / postcard beats.
maybeOfferUnicorn();

// ---- simulation tick: supporter income + arrivals ----

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  // Clamp dt so a throttled background tab doesn't dump a huge jump;
  // proper offline earnings are a later feature.
  const dt = Math.min((now - lastTick) / 1000, 2);
  lastTick = now;
  state.stats.playSeconds += dt; // clamped dt keeps a backgrounded tab from inflating this
  const events = tick(dt);
  state.horses.forEach(updateHorseCard); // tick can change sponsor lines (and later, wellbeing)
  refreshUI();
  processEvents(events);
  runAchievementCheck(); // catch passive-threshold badges (income, supporters) on a quiet tick
  deliverPostcards(collectDuePostcards(now)); // same-visit postcards land here
  grantStatues();                             // ...and any statue they just earned
  renderWantBubbles(state); // show/hide the little-needs bubble as wants come and go
}, 1000);

// ---- persistence ----

setInterval(persist, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
});

// The number of horses one *view* shows is viewport-dependent (a paddock pages
// across several views on mobile), so crossing that breakpoint -- rotating a
// phone, resizing a window -- changes the view strip. Re-render from the home
// paddock so the newest arrivals stay in view rather than leaving a stale,
// half-off-screen layout behind.
window.matchMedia('(max-width: 560px)').addEventListener('change', () => {
  resetPaddockView();
  renderAll(state);
});
window.addEventListener('beforeunload', save); // no time for a network call here

// Handy in the console while developing.
window.HorsingAround = {
  get state() { return gameState; },
  get season() { return currentSeason(gameState.stats.playSeconds); },
  save, pushCloudSave, hurryPaddockLife,
};
