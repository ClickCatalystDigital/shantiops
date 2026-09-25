// Round 4: "fastener" bucket. Real catalog check (not the top-4 fuzzy list, which only ever
// offered the unrelated "FOUNDATION BOLTS & MS NUTS" family) found a full BOLTS/GI BOLTS/SS
// BOLTS/MS NUTS/MS WASHERS catalog by fraction size (ids 832-963) the fuzzy matcher never
// surfaced. Convention: a combined "bolt(s) & nut(s)[& washer(s)]" PMB line maps to the single
// BOLTS-family item at the stated size/material (bolt is the defining, size-critical component;
// this matches the app's own pre-existing precedent — see apply-pmb-bucket-decisions-2.mjs's
// CHIMNEY FOUNDATION -> single "FOUNDATION BOLTS & MS NUTS" mapping — never decomposed into a
// separate nut line unless a size was ALSO independently given for the nut half of a bundle).
// "MS WITH GI"/"MS. WITH GI"/"MS/GI" -> the GI BOLTS family (galvanized is a real, distinct
// product); a real Grade-8.8 high-tensile spec never gets silently substituted with a generic
// bolt — that's a genuine strength-class fact, not decoration, so new dedicated items are created.
import { PROJECTS, db, norm, findRows, createItem, resolveId, linkAll, decomposeAll, audit } from './lib/bom-resolve-helpers.mjs';

const apply = process.argv.includes('--apply');
const counters = { linked: 0, decomposed: 0, deleted: 0 };
const newItemIds = {};

const NEW_ITEMS = [
  { item_name: 'GI BOLTS 3/4" X 4"', group_name: 'GI BOLTS' },
  { item_name: 'GI BOLTS 3/4" X 3 1/2"', group_name: 'GI BOLTS' },
  { item_name: 'BOLTS 3/4" X 3 1/2"', group_name: 'BOLTS' },
  { item_name: 'HIGH TENSILE BOLTS & NUTS GRADE 8.8 1 1/4" X 8"', group_name: 'FASTENERS', default_moc: 'GRADE 8.8' },
  { item_name: 'HIGH TENSILE BOLTS & NUTS GRADE 8.8 1" X 5"', group_name: 'FASTENERS', default_moc: 'GRADE 8.8' },
  { item_name: 'BOLTS M8 X 5/8"', group_name: 'BOLTS' },
  { item_name: 'GI BOLTS M12 X 40 MM', group_name: 'GI BOLTS' },
  { item_name: 'GI BOLTS M8 X 3/4"', group_name: 'GI BOLTS' },
];

for (const item of NEW_ITEMS) await createItem({ ...item, bom_category: 'standard', uom: 'Nos' }, apply, newItemIds);
const id = name => resolveId(name, newItemIds) ?? name;

const LINKS = [
  ['MS BOLTS & NUTS ETC.,|MS WITH GI|5/8" x 2 1/2"', 907],
  ['MS BOLTS & NUTS FOR DISK CHECK VALVE|MS WITH GI|5/8" x 4"', 909],
  ['MS BOLTS & NUTS FOR FEED LINE|MS WITH GI|5/8" x 3"', 908],
  ['MS BOLTS & NUTS FOR MAIN STEAM STOP VALVE|MS WITH GI|5/8" x 3"', 908],
  ['MS BOLTS & NUTS FOR SAFETY VALVE , MOBREY CONTROLLER, WLG, WLG HEADER ETC.,|MS WITH GI|5/8" x 2 1/2"', 907],
  ['CHIMNEY FOUNDATION (DOUBLE NUT AND BOLT WITH WASHERS)|MS|M25 x 900 LG', 2855],
  ['MS BOLTS & NUTS|MS WITH GI|3/4" x 4"', id('GI BOLTS 3/4" X 4"')],
  ['MS BOLTS & NUTS|MS WITH GI|5/8" x 2 1/2"', 907],
  ['MS BOLTS & NUTS|MS|5/8" x 2 1/2 "', 844],
  ['MS BOLTS & NUTS|MS|5/8" x 3"', 845],
  ['MS BOLTS & NUTS AND PLAIN WASHERS ETC.,|MS WITH GI|5/8" x 2 1/2"', 907],
  ['MS BOLTS & NUTS AND PLAIN WASHERS ETC.,|MS WITH GI|5/8" x 4"', 909],
  ['MS BOLTS & NUTS AND PLAIN WASHERS FOR MAIN STEAM STOP VALVE|MS WITH GI|5/8" x 4"', 909],
  ['MS BOLTS & NUTS AND PLAIN WASHERS FOR SAFETY VALVE , MOBREY CONTROLLER, WLG, WLG HEADER ETC.,|MS WITH GI|5/8" x 2 1/2"', 907],
  ['MS BOLTS & NUTS AND WASHERS ETC.,|MS WITH GI|5/8" x 2 1/2"', 907],
  ['MS BOLTS & NUTS AND WASHERS ETC.,|MS WITH GI|1/2" x 2"', 903],
  ['MS BOLTS & NUTS FOR MAN HOLE & MUD HOLE (HIGH TENSILE)|GRADE 8.8|1 1/4" x 8"', id('HIGH TENSILE BOLTS & NUTS GRADE 8.8 1 1/4" X 8"')],
  ['MS BOLTS & NUTS FOR MAN HOLE & MUD HOLE (HIGH TENSILE)|GRADE 8.8|1" x 5"', id('HIGH TENSILE BOLTS & NUTS GRADE 8.8 1" X 5"')],
  ['MS BOLTS & NUTS AND WASHERS FOR MAIN STEAM STOP VALVE|MS WITH GI|5/8" x 4"', 909],
  ['M.S FASTENERS WITH DOUBLE WASHERS|MS. WITH GI|1/2"x 2 1/2"', 904],
  ['M.S FASTENERS WITH DOUBLE WASHERS|MS. WITH GI|5/8"x 3"', 908],
  ['M.S FASTENERS WITH DOUBLE WASHERS|MS. WITH GI|3/4" x 4"', id('GI BOLTS 3/4" X 4"')],
  ['BOLT|MS|M8 x 5/8 Lg.', id('BOLTS M8 X 5/8"')],
  ['BOLT & NUTS|MS. WITH GI|M12 X 40Lg', id('GI BOLTS M12 X 40 MM')],
  ['MS BOLT WITH NUTS|MS|5/8" - 2 "', 843],
  ['MS BOLT WITH NUTS|MS|1/2" - 1 "', 838],
  ['MS BOLT WITH NUTS|MS|1/2" - 1 1/2 "', 839],
  ['MS BOLT WITH NUTS|MS WITH GI|M8 x 3/4" Lg.', id('GI BOLTS M8 X 3/4"')],
  ['MS BOLT WITH NUTS (HIGH TENSILE)|MS|3/4" - 3"', 848],
  ['BOLT & NUTS|MS. WITH GI|1/2" X 40Lg', 902],
  ['BOLT & NUTS|MS. WITH GI|1/2" X 1 1/2" Lg', 902],
  ['BOLT & NUTS|MS. WITH GI|1/2 x 1 1/2"Lg', 902],
  ['BOLT & NUTS|MS|1/2" x 2"LG', 840],
  ['BOLT & NUTS|MS|1/2" x 1 1/2"LG', 839],
  ['BOLT & NUTS (OR) SELF SCREWS|MS. WITH GI|M6 X 25Lg', 896],
  ['BOLTS|MS/GI|1/2" x 1 1/2"', 902],
  ['M.S FASTENERS|MS|1/2" x 1 1/2"', 839],
  ['NUTS|MS. WITH GI|5/8"', 887],
  ['M.S FASTENERS|MS WITH GI|5/8" x 3"', 908],
  ['M.S FASTENERS|MS|5/8" x 2"', 843],
];

const DECOMPOSE = [
  ['MS BOLTS & NUTS FOR MAN HOLE & MUD HOLE (HIGH TENSILE)|GRADE 8.8|1 1/4" x 8" 1" x 5"', [
    { size: '1 1/4" x 8"', qty: '2 Nos', itemId: id('HIGH TENSILE BOLTS & NUTS GRADE 8.8 1 1/4" X 8"'), category: 'standard' },
    { size: '1" x 5"', qty: '3 Nos', itemId: id('HIGH TENSILE BOLTS & NUTS GRADE 8.8 1" X 5"'), category: 'standard' },
  ]],
  ['BOLTS & NUTS|MS|3/4" - 3 1/2" 5/8" - 2 1/2"', [
    { size: '3/4" - 3 1/2"', qty: '16 Nos', itemId: id('BOLTS 3/4" X 3 1/2"'), category: 'standard' },
    { size: '5/8" - 2 1/2"', qty: '88 Nos', itemId: 844, category: 'standard' },
  ]],
  ['BOLTS & NUTS|MS WITH GI|3/4" - 3 1/2" 5/8" - 2 1/2"', [
    { size: '3/4" - 3 1/2"', qty: '16 Nos', itemId: id('GI BOLTS 3/4" X 3 1/2"'), category: 'standard' },
    { size: '5/8" - 2 1/2"', qty: '88 Nos', itemId: 907, category: 'standard' },
  ]],
  ['M.S FASTENERS WITH WASHERS FOR VALVES|MS|1/2" X 2"LG 5/8" X 3"LG', [
    { size: '1/2" X 2"LG', qty: '36 Nos', itemId: 840, category: 'standard' },
    { size: '5/8" X 3"LG', qty: '8 Nos', itemId: 845, category: 'standard' },
  ]],
  ['MS BOLT WITH NUTS|MS|5/8" - 2 1/2" 1/2" - 2"', [
    { size: '5/8" - 2 1/2"', qty: '100 Nos', itemId: 844, category: 'standard' },
    { size: '1/2" - 2"', qty: '25 Nos', itemId: 840, category: 'standard' },
  ]],
];

console.log(apply ? '=== APPLYING (round 4: fastener) ===\n' : '=== DRY RUN (round 4: fastener, nothing written) ===\n');
for (const [key, itemId] of LINKS) await linkAll(key, itemId, apply, counters);
for (const [key, pieces] of DECOMPOSE) await decomposeAll(key, pieces, apply, counters);
console.log(`\n${counters.linked} linked, ${counters.decomposed} decomposed piece(s), ${counters.deleted} bundle(s) removed.`);
if (apply) await audit('fastener', counters, { newItems: Object.keys(newItemIds) });
