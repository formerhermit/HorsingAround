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
  // resumes mid-track instead of restarting from the top.
  audio.play().catch(() => {}); // blocked until a user gesture — retried below
}

attemptPlay();
const startOnGesture = () => {
  attemptPlay();
  document.removeEventListener('pointerdown', startOnGesture);
  document.removeEventListener('keydown', startOnGesture);
};
document.addEventListener('pointerdown', startOnGesture);
document.addEventListener('keydown', startOnGesture);
