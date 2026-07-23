// share.js — inviting people to the game on social media.
//
// Issue #27: keep it game-general, not spammy per-rescue updates. So every
// entry point shares the same warm, whole-game message rather than "I rescued
// Nube". On mobile we hand off to the native share sheet (which includes
// Instagram, WhatsApp, etc.); on desktop, where there's no share sheet and
// Instagram has no web share URL, we show a small menu: Facebook, X, Copy link.

import { gameState, save } from './state.js';

const SHARE_URL = 'https://formerhermit.github.io/HorsingAround/';
const SHARE_TITLE = 'Horsing Around';
const SHARE_TEXT =
  'I found this little game about looking after rescue horses. It raises real money for ARCH horse rescue. Come and play 💛';

/** Honour-based: the player actually shared the game somewhere (native sheet,
 *  a social link, or copying the link). Earns "Word of mouth" (issue #65).
 *  Fires a DOM event so main.js can run the badge check without a circular
 *  import back into this low-level module. */
function markSharedForReal() {
  if (!gameState || gameState.milestones.sharedForReal) return;
  gameState.milestones.sharedForReal = true;
  save();
  window.dispatchEvent(new CustomEvent('achievements-check'));
}

/** Fire the native share sheet if the browser has one (mostly mobile). Returns
 *  true if we handed off, false if the caller should fall back to the menu. */
async function tryNativeShare() {
  if (!navigator.share) return false;
  try {
    await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_URL });
    return true;
  } catch (err) {
    // AbortError = the user dismissed the sheet; treat that as handled rather
    // than popping our own menu on top of their deliberate cancel.
    if (err && err.name === 'AbortError') return true;
    return false;
  }
}

let menuEl = null;

/** Close the desktop fallback menu and drop its outside-click listener. */
function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  document.removeEventListener('click', onOutsideClick, true);
  document.removeEventListener('keydown', onMenuKeydown, true);
}

function onOutsideClick(e) {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
}

function onMenuKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); }
}

/** Build and position the desktop share menu just under the button. */
function openMenu(anchor) {
  closeMenu();
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}`;
  const x = `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`;

  menuEl = document.createElement('div');
  menuEl.className = 'share-menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.innerHTML = `
    <a class="share-menu-item" role="menuitem" href="${fb}" target="_blank" rel="noopener">
      <span aria-hidden="true">📘</span> Facebook
    </a>
    <a class="share-menu-item" role="menuitem" href="${x}" target="_blank" rel="noopener">
      <span aria-hidden="true">✖️</span> X
    </a>
    <button class="share-menu-item" role="menuitem" type="button" data-copy-link>
      <span aria-hidden="true">🔗</span> <span data-copy-label>Copy link</span>
    </button>`;

  // A share link opening in a new tab is the user's own broadcast, not the app
  // posting for them — so the links act on click; only Copy needs a handler.
  const copyBtn = menuEl.querySelector('[data-copy-link]');
  copyBtn.addEventListener('click', async () => {
    const label = copyBtn.querySelector('[data-copy-label]');
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      label.textContent = 'Copied!';
      markSharedForReal();
      setTimeout(closeMenu, 900);
    } catch {
      label.textContent = 'Copy failed';
    }
  });
  menuEl.addEventListener('click', (e) => {
    if (e.target.closest('a')) { markSharedForReal(); closeMenu(); } // link opens, then tidy up
  });

  document.body.appendChild(menuEl);

  // Position under the anchor, nudged left to stay on-screen.
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + window.scrollY + 6;
  const left = Math.min(
    r.left + window.scrollX,
    window.scrollX + document.documentElement.clientWidth - menuEl.offsetWidth - 8,
  );
  menuEl.style.top = `${top}px`;
  menuEl.style.left = `${Math.max(8, left)}px`;

  // Defer the outside-click listener so this very click doesn't close it.
  setTimeout(() => {
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', onMenuKeydown, true);
  }, 0);
}

/** Entry point wired to every [data-share-game] button. */
export async function shareGame(anchor) {
  if (menuEl) { closeMenu(); return; } // toggle off if already open
  const handed = await tryNativeShare();
  if (handed) markSharedForReal();
  else openMenu(anchor);
}

/** One delegated listener covers every current and future share button. */
export function initShare() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-share-game]');
    if (!btn) return;
    e.preventDefault();
    shareGame(btn);
  });
}
