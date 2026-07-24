// facilities.js — "Grow the rescue": big permanent facility upgrades (issue #48).
//
// A one-way ladder, bought strictly in order, that gives late-game money a real
// purpose and gently deepens the loop long after the shop is maxed out. Each
// rung mixes a cost-cut or quality-of-life effect with a modest, permanent
// donation bonus (donationBonus below): supporter and sponsor giving both rise
// a little with every facility built. The bonuses compound on purpose — the
// price ladder is steep (60k up to 5M), and without each purchase paying the
// next one forward, income plateaus while costs grow exponentially and the top
// rungs drift out of reach (the original cost-cuts-only design did exactly
// that).
//
// Data + effect helpers only; no DOM, no game rules. game.js reads the effect
// helpers at its economy hook points; render.js/main.js draw and sell them.

export const FACILITIES = [
  { id: 'vet-station', name: 'Vet station', icon: '🩺', price: 60000, donationBonus: 0.10,
    art: 'assets/events/facility-vet-station.jpg',
    blurb: "A proper on-site clinic. Vet and farrier bills cost 30% less, and a herd in glowing health earns 10% more in donations." },
  { id: 'hay-barn', name: 'Hay barn', icon: '🌾', price: 150000, donationBonus: 0.10,
    art: 'assets/events/facility-hay-barn.jpg',
    blurb: "Feed bought in bulk and stored dry. Hay bills cost 40% less, a well-fed herd holds its shine longer, and donations give 10% more." },
  { id: 'rehoming-office', name: 'Rehoming office', icon: '🏡', price: 400000, donationBonus: 0.15,
    art: 'assets/events/facility-rehoming-office.jpg',
    blurb: "Staff to match horses with the right families. Adoption fees pay 60% more, and the success stories lift donations 15%." },
  { id: 'second-horsebox', name: 'Second horsebox', icon: '🚚', price: 900000, donationBonus: 0.15,
    art: 'assets/events/facility-second-horsebox.jpg',
    blurb: "Reach more horses in need. New rescues arrive in better shape, cost 15% less, and the wider reach lifts donations 15%." },
  { id: 'visitor-centre', name: 'Visitor centre', icon: '🎪', price: 2000000, donationBonus: 0.25,
    art: 'assets/events/facility-visitor-centre.jpg',
    blurb: "A welcome barn, a little café, a gift shop. Visitors Days and new foals draw 50% more, your following can grow bigger, and donations give 25% more." },
  { id: 'sanctuary-field', name: 'Sanctuary field', icon: '✨', price: 5000000, donationBonus: 0.30,
    art: 'assets/events/facility-sanctuary-field.jpg',
    blurb: "The dream: acres of rolling pasture, a forever home. Room to build a fourth paddock, and a story that moves donors like nothing else: donations give 30% more." },
];

export function hasFacility(state, id) {
  return (state.facilities ?? []).includes(id);
}

/** The next rung the player can work toward (the ladder is bought in order), or
 *  null once the whole rescue is grown. */
export function nextFacility(state) {
  return FACILITIES.find((f) => !hasFacility(state, f.id)) ?? null;
}

export function canBuyFacility(state, id) {
  const f = FACILITIES.find((x) => x.id === id);
  if (!f || hasFacility(state, id)) return false;
  if (nextFacility(state)?.id !== id) return false; // must be the very next rung
  return state.coins >= f.price;
}

export function buyFacility(state, id) {
  const f = FACILITIES.find((x) => x.id === id);
  if (!f || !canBuyFacility(state, id)) return { ok: false, facility: null };
  state.coins -= f.price;
  (state.facilities ??= []).push(id);
  return { ok: true, facility: f };
}

// ---- effect helpers (read by game.js's economy) ----

/** Fractional discount on a bill of this kind, 0 if none applies. */
export function billDiscount(state, kind) {
  if ((kind === 'vet' || kind === 'farrier') && hasFacility(state, 'vet-station')) return 0.30;
  if (kind === 'hay' && hasFacility(state, 'hay-barn')) return 0.40;
  return 0;
}

/** Multiplier on an adoption fee (rehoming office). */
export function adoptionMultiplier(state) {
  return hasFacility(state, 'rehoming-office') ? 1.6 : 1;
}

/** Fractional discount on the next rescue's cost (second horsebox). */
export function rescueDiscount(state) {
  return hasFacility(state, 'second-horsebox') ? 0.15 : 0;
}

/** Wellbeing a rescue arrives with on top of its base (second horsebox). */
export function rescueWellbeingBonus(state) {
  return hasFacility(state, 'second-horsebox') ? 8 : 0;
}

/** Multiplier on Visitors Day / foal draw (visitor centre). */
export function eventDrawMultiplier(state) {
  return hasFacility(state, 'visitor-centre') ? 1.5 : 1;
}

/** Multiplier on the supporter carrying capacity (visitor centre). */
export function supporterCapMultiplier(state) {
  return hasFacility(state, 'visitor-centre') ? 1.15 : 1;
}

/** Multiplier on all passive donation income (supporters and sponsors alike):
 *  every owned facility's donationBonus, compounded. 1 with no facilities;
 *  ~2.6 with the whole ladder built. game.js applies it in the live tick and
 *  to offline earnings. */
export function donationMultiplier(state) {
  return FACILITIES.reduce(
    (mult, f) => (hasFacility(state, f.id) ? mult * (1 + f.donationBonus) : mult), 1);
}

/** Multiplier on the upkeep-drift grace period (hay barn). */
export function driftGraceMultiplier(state) {
  return hasFacility(state, 'hay-barn') ? 1.5 : 1;
}

/** How many regular paddocks the rescue may own: 3, or 4 with the sanctuary. */
export function maxPaddocks(state) {
  return hasFacility(state, 'sanctuary-field') ? 4 : 3;
}
