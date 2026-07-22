# Cross-device persistence & leaderboard — design options (issues #25, #15)

## Where we are today

The game is local-first with an optional Supabase cloud-save layer already wired up:

- Every player silently becomes an **anonymous Supabase auth user** on first load
  (`signInAnonymously()` in `js/cloud.js`).
- Their whole save blob lives in one `saves` row keyed by that user's UUID, locked
  down by Row Level Security (`supabase/schema.sql`).
- Sync is last-write-wins by timestamp, in the background, never blocking first paint.

The gap: an anonymous identity is **tied to the browser's stored session**. Clear
storage, open a different browser, or pick up a phone, and you get a *fresh* anonymous
user with an empty save. So today we have cloud backup, not true cross-device play.

The fix in all cases below is the same primitive: let a player **attach a durable
credential** to their existing anonymous user, so the same `user_id` (and its save row)
can be reached from a second device. Supabase supports upgrading an anonymous user in
place via `linkIdentity()` / `updateUser()`, so **no save is lost** in the upgrade.

---

## Option A — Magic link / email OTP (recommended)

Player taps "Save across devices", enters an email, gets a one-time link or 6-digit
code. Confirming links the email to their anonymous user. On device 2 they enter the
same email, and Supabase signs them into the same account, loading the same save.

- **Pros:** no password for us to handle (prohibited territory anyway), lowest-friction,
  built into Supabase Auth, one identifier that's also a natural channel for the charity.
- **Cons:** we now process an email address (see GDPR below); deliverability depends on
  configuring an SMTP sender; players must have inbox access at link time.
- **Effort:** small. One button, one input, one `signInWithOtp()` / `verifyOtp()` pair,
  plus the link step.

## Option B — OAuth provider (Google / Apple / Facebook)

"Continue with Google" links a social identity to the anonymous user.

- **Pros:** zero typing, no email deliverability to manage, very familiar.
- **Cons:** each provider needs app registration + consent screens; Apple/Google have
  their own review and branding rules; sends more third-party data flows into scope;
  heavier for a small charity to maintain. Facebook in particular is a data-sharing
  liability worth avoiding.
- **Effort:** medium, mostly provider setup and review, not code.

## Option C — Portable "save code" / recovery phrase (no personal data)

Generate a random code (or passphrase) that *is* the credential. Player copies it,
enters it on device 2 to claim the same save. Under the hood this is still an anonymous
user; the code maps to it.

- **Pros:** collects **no personal data at all**, which sidesteps most of the GDPR
  surface below. No email, no third parties. Nicely on-theme (a "stable pass").
- **Cons:** if the player loses the code, the save is unrecoverable (no reset path);
  weaker against typos; not a channel the charity can ever reach the player through.
  Needs a small custom mapping table + care around code entropy and rate limiting.
- **Effort:** small-to-medium, but it's bespoke rather than off-the-shelf auth.

## Option D — Do nothing / QR hand-off

A "move to another device" QR that carries a short-lived token from device 1 to device 2
in the same session. Solves *migration* but not *durable recovery* — lose device 1 and
the save is gone. Useful as a complement, not a replacement.

---

### Recommendation

Start with **Option A (email magic link)**, optionally offering **Option C (save code)**
as a no-personal-data alternative for privacy-conscious players. Keep it strictly
opt-in: the anonymous local-first experience stays the default, and linking is a choice
a player makes when they want to.

---

## Privacy / GDPR implications

Right now the game arguably processes **no personal data**: an anonymous UUID plus game
progress isn't obviously identifying, and there's no contact channel. The moment we let
players attach an **email or social identity**, that changes — we become a data
controller processing personal data, and a set of obligations kicks in. This matters more
than usual because it's a **charity in Spain**, so both UK-GDPR and EU-GDPR are in play.

Things to have in place before shipping Option A or B:

- **Lawful basis + clear notice.** Explain, at the point of linking, exactly what we
  collect (email), why (to sync your save across devices), where it's stored (Supabase),
  and for how long. Consent should be specific and freely given — the game must remain
  fully playable without it.
- **Data minimisation.** Store only the email needed for sign-in. Don't repurpose it for
  marketing/newsletters unless the player separately and explicitly opts in — bundling
  "sync my game" with "email me about the charity" is exactly the kind of conditioned
  consent GDPR disallows.
- **Privacy policy.** A public policy naming Supabase as processor, the storage region,
  retention, and the player's rights (access, rectification, erasure, portability).
- **Processor + transfers.** Confirm the Supabase project's region and that a Data
  Processing Agreement is in place; note any transfer mechanism if data leaves the EEA/UK.
- **Children.** If under-13s (UK) / under-16s (varies by EU state, Spain included) are a
  realistic audience, age-appropriate design and consent rules apply — a strong reason to
  prefer the no-personal-data save code, or to keep email linking clearly adult-facing.
- **Security.** RLS already isolates rows well; keep the anon/publishable key public (fine)
  and never expose the service-role key client-side.

**Option C (save code) is the privacy shortcut:** with no email or third party, most of
the controller obligations above shrink dramatically, since there's little to no personal
data to process. Worth weighing that against its lost-code fragility.

---

## Unsubscribe / unlink / delete ("the right to leave")

Whatever we add, players need a clean way out. Three distinct actions, don't conflate them:

1. **Unlink this device / sign out.** Drops the local session so the browser reverts to a
   fresh anonymous player. Local, reversible, no data deleted. Easy.
2. **Unlink the email/identity.** Detach the credential but keep playing anonymously.
   Removes the cross-device link without wiping progress.
3. **Delete my account and data (GDPR erasure).** *Partially shipped:* the privacy
   popup's "Delete my save and cloud data" button self-serves deletion of the `saves`
   row (via an RLS delete policy) plus the local save, then signs out so a fresh
   anonymous identity is minted on next visit. The orphaned `auth.users` row remains —
   it holds no personal data, just a UUID, so this is acceptable **while identities are
   anonymous**. Once email linking (Option A) ships, the email lives in `auth.users`,
   and full deletion then needs a tiny **Supabase Edge Function** holding the
   service-role key that authenticates the caller and deletes *their own* user (the
   `on delete cascade` takes the save with it). That function must ship with Option A.

Also worth offering, and cheap given the save is already one JSON blob:

- **Export my data (portability).** A "download my save" button that hands back the
  `game_state` JSON. Satisfies the access/portability right and is genuinely useful.

None of erasure/unlink exists yet — it's net-new work that should ship **together with**
whatever linking option we pick, not after. Offering sign-in without offering a way to
leave is the part that turns a nice feature into a compliance gap.

---

## Leaderboard (issue #15)

### Identity model

A leaderboard needs a *stable identifier*, and every player already has one: the
anonymous Supabase auth UUID. So #15 does **not** depend on #25 shipping first — a
leaderboard row can key on `auth.uid()` today. The two features interact, though:

- **Durability rides on #25.** An anonymous identity dies with the browser. Linking an
  email (or save code) later is what makes a leaderboard standing survive a lost phone.
  Because linking upgrades the anonymous user *in place* (same UUID), leaderboard rows
  carry over automatically — no migration if #15 ships first.
- **A username is never a credential.** Identity comes only from the auth session.
  Typing the same name on another device must not claim the old entry — names collide
  and invite impersonation. The name is a display label hanging off the real identifier.

### Schema sketch

One new table, RLS flipped the other way from `saves`:

- `leaderboard`: `user_id` (PK, references `auth.users` **on delete cascade**),
  `display_name` (unique, length-limited), score fields (e.g. `horses_rescued`,
  `horses_rehomed`), `updated_at`.
- RLS: **public select** (that's the point), insert/update only where
  `auth.uid() = user_id`.
- `saves` stays exactly as private as it is now. Only fields meant to be public ever
  go in the leaderboard table — never the `game_state` blob.

The `on delete cascade` means the account-erasure flow from #25 automatically removes a
player's leaderboard entry too: one delete path serves both features.

### Privacy posture

- **Opt-in only.** Nobody appears until they pick a name and join.
- A chosen handle tied to a persistent UUID is still *personal data* under GDPR
  (pseudonymous ≠ anonymous), but it's about the lightest processing there is: no
  contact channel, no email, no third parties. Obligations: mention it in the privacy
  policy, warn that the name is public, offer rename / leave / delete.
- **Point-of-naming warning** (also most of our children's-data diligence — see below):

  > "Your stable name will be visible to everyone who plays. Please don't use your
  > real name or email address."

- **Exit paths:** rename any time; "leave the leaderboard" deletes the row; full
  account deletion cascades to it.

### Integrity (a non-privacy flag)

Saves are client-authoritative (`window.HorsingAround.state` is one console command
away), so scores are trivially forgeable. Don't build anti-cheat for a charity
awareness game; frame the leaderboard so forgery matters less: "top rescuers this week"
with a periodic reset invites less grief than an all-time ranking where one prankster
sits at 999 million forever.

---

## Children playing the game

Honest assessment: a bright, cute horse game **looks child-friendly**, and the relevant
tests don't only ask who you *aim* at:

- **EU/Spain (GDPR + LOPDGDD):** parental consent is needed to process a child's data on
  a consent basis below age **14** in Spain (varies 13–16 across the EU; UK is 13).
- **UK Children's Code:** applies to services "**likely to be accessed** by children",
  not just those aimed at them. A horse-clicker plausibly qualifies.
- **US COPPA:** hinges on being "directed to children" or actual knowledge. Animated
  animals and bright colours are literally listed factors for "directed to children".

So a "this game is not aimed at children" line is worth having — it helps the COPPA
analysis and signals intent — but it is a **weak shield on its own** for a game that
looks like this. The stronger position, and the one we're nearly in already, is:
**collect so little that a child playing creates no meaningful risk.**

- Core game: anonymous UUID + game progress, no contact channel, no ads, no tracking,
  no chat, no free-text anything. A child can play with essentially zero data exposure.
- Leaderboard: the risk is a child typing their real name; the curated-name approach
  below closes that off entirely.
- Email linking (Option A) is the only step that truly collects personal data. Gate
  *just that step* with age language:

  > "Linking an email is for players 14 and over. Younger players: ask a parent or
  > guardian to use their email, or use a save code instead."

  ...and keep the save-code path (Option C) as the no-data alternative. That's a
  proportionate answer for a volunteer-run charity, without pretending kids don't play.

**Recommendation:** do both. Put the "not directed at children under 14" line in the
privacy policy *and* design the features so it barely matters. Don't rely on the line
alone.

---

## Privacy popup

A "Game privacy" link in the footer (next to the ARCH credit) opening a popup fits the
game's existing patterns — the album/collection modals or the `dialog-overlay` card in
`index.html` are ready-made homes for it. Layered approach:

- **The popup is the short, human version** (the layer people actually read):
  - Your progress is saved in your browser, plus an anonymous cloud copy so it isn't
    lost. No account needed.
  - No ads, no tracking, no selling anything. The only analytics is the game itself.
  - If you join the leaderboard, your chosen stable name and rescue counts are public.
  - If you link an email, it's used only to load your save on another device. Never
    for marketing. (Ships with #25, not before.)
  - You can download your save, leave the leaderboard, or delete everything:
    [buttons live here or link to where they live].
  - Data lives with Supabase in [region]. Questions: [contact].
  - This game is made for grown-up horse lovers; it isn't directed at children under 14.
- A fuller written policy (static page or README section) for the formal version the
  popup links to.

Suggested footer copy (keeping the existing sentence intact):

> Inspired by ARCH ... near Málaga, Spain. · <a>Game privacy</a>

The popup should exist **before** the leaderboard or email linking ship, and can ship
now describing only what's true today (local save + anonymous cloud copy). Each feature
then adds its bullet when it lands.

---

## Stopping inappropriate names

Ranked by how well they fit a volunteer-run project:

1. **Curated name generator (recommended default).** Player rolls a horse-themed name
   from adjective + noun word lists ("Velvet Canter", "Biscuit Whisperer") with a
   reroll button. Nothing to moderate, nothing to translate-check, impossible to type a
   real name or a slur — it solves the moderation problem *and* the children's-data
   problem in one move, and it's on-theme. Uniqueness via a numeric suffix if taken.
2. **Free text with guardrails** (if custom names feel important):
   - Client side: length limit (~20 chars), restricted charset (letters, digits,
     spaces), collapse leetspeak/diacritics before checking against a blocklist
     covering **English and Spanish** at minimum.
   - Server side, because the client is trivially bypassed: a check constraint for
     length/charset, and blocklist enforcement in a trigger or in the Edge Function
     that becomes the only write path for `display_name`.
   - Reserved words either way: "ARCH", "Admin", "Moderator", staff/volunteer names.
3. **Reactive moderation as the backstop:** with a small playerbase, a way for you to
   rename an offensive entry from the Supabase dashboard (plus a low-key report route,
   even just an email link) covers the tail. Required regardless of 1 or 2.

A good hybrid: generator by default, with custom names as a later unlock if players ask
for them — you only take on the blocklist work if there's real demand.

---

## Suggested phasing

1. **Privacy popup first** — describing today's truth (local save + anonymous cloud
   copy, no tracking). Small, standalone, and everything else assumes it exists.
2. Email magic-link linking (Option A), opt-in, behind a "Save across devices" button,
   with the 14+ gate on the email step.
3. Ship alongside: consent copy in the popup, an erasure Edge Function, unlink, and
   save export. (Non-negotiable pairing — see above.)
4. **Leaderboard (#15)**: *shipped* — opt-in, generated stable names (unique per month,
   enforced by the database with client-side reroll on collision), public-read
   `leaderboard` table keyed (user_id, month), monthly board following Europe/Madrid
   time, third tab in the collection book. Leaving the board deletes the rows, and the
   privacy popup's delete button removes them too.
5. Optional later: save-code path (Option C), custom leaderboard names with a
   blocklist, QR hand-off (D), OAuth (B) only with clear demand.
