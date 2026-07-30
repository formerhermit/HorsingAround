# Tests

Run them:

```
npm test
```

Green means the checks passed. Red names the check that failed. Nothing else
to learn: you are not expected to read these files, only the result.

## What is covered, and why only this

Three things are tested, chosen because they share the same three traits: the
code changes constantly, it is pure calculation with no screens involved, and a
mistake there is silent rather than visible.

- **`save.test.mjs`** — loading and healing a save. `repair()` was edited in 45
  of this project's first 100-odd commits, almost always as a side effect of
  building something else, because every new field needs backfilling into old
  saves. When it goes wrong a player's rescue disappears without anything
  looking wrong on screen. Issues #151 and #152 were both exactly that.
- **`economy.test.mjs`** — `game.js`, the most-edited file in the project.
- **`escape.test.mjs`** — the HTML escaping that closed two XSS holes.

## What is deliberately not covered

Anything visual. Whether the paddock looks right, whether the tabs wrap on a
phone, whether the copy reads well. Those need eyes, and a test that claimed to
check them would be lying.

Also skipped: `saveCode.js` and similar. It has been touched twice ever, and
testing it would need module-mocking machinery more fragile than the code it
guards. Low churn plus low blast radius does not earn a test.

## The rule these follow

**Assert relationships and bounds, never tuned numbers.**

`assert(rescueCost(6) > rescueCost(5))` survives any amount of economy tuning
and only fails when the escalation is genuinely broken. `assert(rescueCost === 25)`
would fail every time you tuned the economy and would quickly teach everyone to
ignore the suite. A test suite people ignore is worse than no test suite.

## Checking the alarms actually work

A test that can never fail is decoration. To prove one is wired up, break the
thing it guards and watch it go red:

```
# Reintroduce the bug from #152, then run the tests
perl -0pi -e 's/  return repair\(oldSave\);/  return null;/' js/state.js
npm test          # -> 1 failure: "keeps the player's progress"
git checkout -- js/state.js
```

Worth doing once for any test you are relying on.
