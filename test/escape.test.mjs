// HTML escaping.
//
// Several places build markup as strings and assign it with innerHTML. Most of
// what goes in is authored in this codebase, but some of it traces back to
// gameState (horse names, postcard text) or to a leaderboard row, and both can
// hold arbitrary text: a save can arrive from another device via a save code,
// and the leaderboard's display_name is only length-checked in the database
// while the publishable key is public by design. That was two live XSS holes.
//
// escapeHtml is the single chokepoint for that, so it is worth pinning down.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../js/escape.js';

describe('escapeHtml', () => {
  test('defuses a script tag', () => {
    assert.equal(
      escapeHtml('<script>alert(1)</script>'),
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  test('defuses an event handler on an image, the classic save payload', () => {
    const out = escapeHtml('<img src=x onerror="steal()">');
    assert.ok(!out.includes('<'), 'no tag can survive');
    assert.ok(!out.includes('"'), 'no attribute can be broken out of');
  });

  test('escapes quotes, so a value cannot escape an attribute', () => {
    // Horse names land in aria-label="...", so a bare double quote would let a
    // crafted name inject an attribute of its own.
    assert.equal(escapeHtml('a"b'), 'a&quot;b');
    assert.equal(escapeHtml("a'b"), 'a&#39;b');
  });

  test('escapes ampersands, and does so first', () => {
    // If & were escaped after < then "&lt;" would come back out as a real "<".
    assert.equal(escapeHtml('&'), '&amp;');
    assert.equal(escapeHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
  });

  test('leaves ordinary text alone', () => {
    // Real horse names, including the accented Spanish ones and emoji.
    for (const name of ['Biscuit', 'María', 'Luz de Luna', 'Turrón', 'Bibbles 💛']) {
      assert.equal(escapeHtml(name), name, `${name} should pass through untouched`);
    }
  });

  test('survives values that are not strings', () => {
    // Save data is arbitrary JSON, so a name could be a number or null.
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(null), 'null');
    assert.equal(escapeHtml(undefined), 'undefined');
  });

  test('is safe to apply twice over', () => {
    // Not the intent, but harmless if it happens: the result must still contain
    // no live markup.
    const once = escapeHtml('<b>x</b>');
    const twice = escapeHtml(once);
    assert.ok(!twice.includes('<'));
  });
});
