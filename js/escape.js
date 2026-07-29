// escape.js — HTML-escape untrusted strings before they reach an innerHTML
// sink. "Untrusted" here means anything that ultimately traces back to a
// gameState field (horse names, traits, postcard text, leaderboard display
// names) rather than a literal authored in this codebase: a crafted save
// (adopted via a save code, Google sign-in, or cloud sync) or a leaderboard
// row written directly against the public Supabase API can carry arbitrary
// text in those fields, so anywhere that text is interpolated into HTML
// (rather than assigned via textContent) needs this.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
