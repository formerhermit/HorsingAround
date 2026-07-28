// audio.js — background soundtrack. Quiet by default, one click to mute,
// and never forced on the player: browsers block audio-with-sound until a
// real user gesture, which also happens to be the polite default here —
// nothing plays before the player has actually touched the page.

const VOLUME = 0.25; // low and ambient, never meant to compete for attention
const MUTE_KEY = 'horsing-around:muted';

const audio = document.getElementById('soundtrack');
const btn = document.getElementById('sound-btn');
audio.volume = VOLUME;

let muted = localStorage.getItem(MUTE_KEY) === 'true';

function applyMuteState() {
  audio.muted = muted;
  btn.textContent = muted ? '🔇' : '🔊';
  btn.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
}

applyMuteState();

btn.addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, String(muted));
  applyMuteState();
  attemptPlay();
});

function attemptPlay() {
  // Play (even while muted) so position keeps advancing and unmuting
  // resumes mid-track instead of restarting from the top. Returns the promise
  // so the gesture hook below can tell a real start from a refusal.
  return audio.play().catch(() => {}); // blocked until a user gesture — retried below
}

attemptPlay();

// The first gesture is what lets the soundtrack in (browsers refuse audio with
// sound before one). Unhook only once a play attempt has actually succeeded:
// not every gesture grants permission — a touch that turns into a scroll, or a
// pointerdown on iOS Safari, can leave audio still blocked — and unhooking on
// the attempt rather than the result used to spend the one and only retry, so
// music stayed silent for the whole session. Listening on click as well as
// pointerdown covers browsers that only count the completed tap.
const GESTURES = ['pointerdown', 'click', 'keydown'];
const startOnGesture = () => {
  attemptPlay().then(() => {
    if (audio.paused) return; // still refused; leave the hooks up for next time
    for (const type of GESTURES) document.removeEventListener(type, startOnGesture);
  });
};
for (const type of GESTURES) document.addEventListener(type, startOnGesture);
