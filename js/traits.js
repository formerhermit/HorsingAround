// traits.js — the personality system's data (issue #46). No game logic here.
//
// Every trait is either a quirk or a fear, and the tag is mechanical:
//  - Quirks colour care: a tap sometimes lands as that horse's own delighted
//    "trait moment" (crit-sized), and their little wants lean toward the thing
//    they're known for.
//  - Fears run the breakthrough arc: visible from the day the horse arrives,
//    trust-building care copy while it's still nervous, and one rewarded
//    breakthrough beat once it recovers far enough. A fear NEVER slows a
//    horse down — it's a story, not a debuff.
//
// horse.trait stores the plain text (save-compatible with older builds);
// TRAIT_INFO keys off that same text for everything mechanical.

// Wellbeing at which a fear horse's breakthrough lands. Lives here (not
// game.js) so state.js can backfill old saves without an import cycle.
export const FEAR_OVERCOME_AT = 70;

// Quirks. `moment` is the delighted care-tap pop (crit-sized) once the
// personality has shown; `want` biases the little-needs bubble toward that
// need id (see NEEDS in game.js). Both optional — some quirks are just talk.
const QUIRKS = [
  { text: 'dramatic about puddles' },
  { text: 'prone to falling asleep on your foot', moment: '😴 asleep on your foot again' },
  { text: 'obsessed with the hose', moment: '🧽 hose-down time: pure joy', want: 'play' },
  { text: 'a dedicated shoelace-nibbler', moment: '🥾 nibbled your shoelaces, delighted' },
  { text: 'very protective of the hay' },
  { text: 'a secret carrot hoarder', moment: '🥕 a carrot, straight into the hoard', want: 'carrot' },
  { text: 'convinced apples grow specifically for them', moment: '🍎 an apple, grown just for them (obviously)', want: 'apple' },
  { text: 'unreasonably picky about hay quality' },
  { text: 'willing to trade dignity for a mint', moment: '🍬 a mint: dignity traded instantly', want: 'mint' },
  { text: 'the self-appointed paddock lookout' },
  { text: 'a shameless attention hog', moment: '💛 your full attention, at last', want: 'photo' },
  { text: 'oddly formal with new arrivals' },
  { text: 'fiercely loyal to whoever groomed them first', moment: '🪮 a brush from their favourite person', want: 'brush' },
  { text: 'the gossip, always leaning over the fence', want: 'lonely' },
  { text: 'vain about their mane', moment: '✨ mane detangled: simply stunning', want: 'brush' },
  { text: 'ticklish behind the ears', moment: '🫶 an ear scratch: wiggly with delight', want: 'scratch' },
  { text: 'an enthusiastic napper', moment: '😴 settled in for a contented nap' },
  { text: 'stubborn about literally everything' },
  { text: 'convinced every fence post is new' },
  { text: 'allergic to being told what to do' },
  { text: 'nosy about anything in your pockets', moment: '🧥 found the treat in your pocket', want: 'mint' },
];

// Fears. `arrival` finishes the sentence "<name> arrives: thin, wary, and ...";
// `breakthrough` finishes "<name> ..." in the one-time breakthrough toast.
const FEARS = [
  { text: 'afraid of buckets',
    arrival: 'keeping well clear of the water buckets',
    breakthrough: 'walked straight past the bucket today' },
  { text: 'suspicious of butterflies',
    arrival: 'keeping a wary eye on the butterflies',
    breakthrough: 'let a butterfly land right on their nose' },
  { text: 'convinced the wheelbarrow is a rival',
    arrival: 'glaring at the wheelbarrow from a safe distance',
    breakthrough: 'made peace with the wheelbarrow at last' },
  { text: 'terrified of plastic bags',
    arrival: 'flinching at every rustle',
    breakthrough: 'watched a plastic bag tumble past without a flinch' },
  { text: 'deeply suspicious of umbrellas',
    arrival: 'giving the umbrella by the gate a very wide berth',
    breakthrough: 'stood calm while an umbrella opened right beside them' },
  { text: 'nervous around anything shiny',
    arrival: 'shying away from anything that glints',
    breakthrough: 'calmly sniffed the shiny new gate latch' },
  { text: 'unsettled by their own shadow at dusk',
    arrival: 'jumping at their own shadow',
    breakthrough: 'stood nose to nose with their shadow at sunset' },
  { text: 'wary of the sound of velcro',
    arrival: 'startling at every rip of velcro',
    breakthrough: 'did not even blink at the velcro today' },
];

/** Every trait text, quirks and fears together — the rescue assignment pool. */
export const TRAITS = [...QUIRKS, ...FEARS].map((t) => t.text);

/** Quirk texts only — Biscuit's reveal-time pool (the onboarding stays as it
 *  was: fears belong to rescues, whose arrival introduces them properly). */
export const QUIRK_TRAITS = QUIRKS.map((t) => t.text);

/** Trait text -> { kind, moment?, want?, arrival?, breakthrough? }. */
export const TRAIT_INFO = Object.fromEntries([
  ...QUIRKS.map((t) => [t.text, { kind: 'quirk', ...t }]),
  ...FEARS.map((t) => [t.text, { kind: 'fear', ...t }]),
]);

export function isFearTrait(trait) {
  return TRAIT_INFO[trait]?.kind === 'fear';
}

// Care copy for a still-nervous fear horse (below the personality-reveal
// threshold): building trust, not brushing manes. Same wellbeing gain as any
// other care tap — the texture changes, never the speed.
export const FEAR_CARE_MESSAGES = [
  '🤍 sat quietly nearby',
  '💛 let them come to you',
  '🍃 soft words, from a distance',
  '🕊️ slow, calm, patient',
  '💛 a slow blink of trust',
];

// The gentler crits of the trust-building phase.
export const FEAR_CRIT_MESSAGES = [
  '💛 they stepped a little closer',
  '✨ a nose reached out to you',
  '🤍 they let you stand beside them',
];
