// translate.js — a free, no-budget path to other languages (no i18n framework,
// no translation files, no ongoing cost: the charity can't afford any of
// that). Two layers, both free:
//
//  1. Chrome/Edge/Safari already offer to translate the whole page on their
//     own, no code needed -- this file doesn't touch that.
//  2. Google's free Website Translator widget, wired to a small language menu
//     here instead of its own banner. It exists specifically to cover what
//     browser-native translate sometimes misses: text added *after* load
//     (toasts, dialog popups) via plain DOM writes, since the widget watches
//     the page for changes rather than only translating once on load.
//
// Not a module (loaded as a plain script) so Google's callback-style API
// (a global function it calls once its script loads) can find it.

/** Google's own callback, named by the ?cb= param on its <script> tag.
 *  autoDisplay:false keeps its default banner/dropdown from ever appearing --
 *  the menu below is the only UI a player sees. */
function googleTranslateElementInit() {
  // eslint-disable-next-line no-undef
  new google.translate.TranslateElement(
    { pageLanguage: 'en', autoDisplay: false },
    'google_translate_element',
  );
}
window.googleTranslateElementInit = googleTranslateElementInit;

/** Read the language the googtrans cookie currently names, '' for English. */
function currentLang() {
  const m = document.cookie.match(/googtrans=\/en\/(\w+)/);
  return m ? m[1] : '';
}

/** Point Google's widget at a language (or back to English) and reload --
 *  the widget reads this cookie on load, same trick used site-wide wherever
 *  the Website Translator widget is driven by a custom menu instead of its
 *  own UI. */
function setLanguage(lang) {
  const value = lang ? `/en/${lang}` : '';
  document.cookie = `googtrans=${value};path=/`;
  location.reload();
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('lang-btn');
  const menu = document.getElementById('lang-menu');
  if (!btn || !menu) return;

  const active = currentLang();
  for (const item of menu.querySelectorAll('button')) {
    item.classList.toggle('is-active', item.dataset.lang === active);
    item.addEventListener('click', () => setLanguage(item.dataset.lang));
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) menu.hidden = true;
  });
});
