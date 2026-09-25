// Round 7: "gauge_fitting" bucket. Full catalog check found the earlier auto-match's SYPHON->
// HEXNIPPLE suggestion was a fuzzy word-overlap false positive (no syphon-specific item exists at
// all) — a Q'/U' type syphon (a coiled pigtail tube protecting a gauge from direct steam contact)
// is a physically and functionally different product from a hex nipple; two new items are created
// instead of substituting the wrong shape. A genuine "IBR REDUCER HEXNIPPLE FOR Pr.Gauge" (2852)
// already exists distinct from the plain "HEXNIPPLE FOR Pr.Gauge" (2851) — reducing (different
// diameters each end) vs straight nipples are matched to the correct one of the two, never
// conflated. A full PIPE NIPPLE family by NB+schedule+IBR (2156-2207, all fixed at 150mm/6" length)
// and a full PRESSURE GAUGE family by dial size + range + BSP (2208-2259) covered the rest exactly.
import { PROJECTS, db, norm, findRows, createItem, resolveId, linkAll, decomposeAll, audit } from './lib/bom-resolve-helpers.mjs';

const apply = process.argv.includes('--apply');
const counters = { linked: 0, decomposed: 0, deleted: 0 };
const newItemIds = {};

const NEW_ITEMS = [
  { item_name: "Q' TYPE SYPHON, SA 106 GR.B, 15 MM SCH-40 (SEAMLESS)", group_name: 'SYPHON', default_moc: 'SA 106 GR.B', bom_category: 'pipe' },
  { item_name: "U' TYPE SYPHON, SA 106 GR.B, 15 MM SCH-40 (SEAMLESS)", group_name: 'SYPHON', default_moc: 'SA 106 GR.B', bom_category: 'pipe' },
];
for (const item of NEW_ITEMS) await createItem({ ...item, uom: 'Nos' }, apply, newItemIds);
const id = name => resolveId(name, newItemIds) ?? name;

const LINKS = [
  ["Q' TYPE SYPHONE FOR Pr.Gauge/Pr.Switch|SA 106 GR.B|15 MM SCH-40 (STD)", id("Q' TYPE SYPHON, SA 106 GR.B, 15 MM SCH-40 (SEAMLESS)")],
  ["U' TYPE SYPHONE FOR Pr.Gauge|SA 106 GR.B|15 MM SCH-40 (STD)", id("U' TYPE SYPHON, SA 106 GR.B, 15 MM SCH-40 (SEAMLESS)")],
  ["Q' TYPE SYPHON|C.S, SMLS|C.S. SEAMLESS, SCH-40 -15 MM", id("Q' TYPE SYPHON, SA 106 GR.B, 15 MM SCH-40 (SEAMLESS)")],
  ['COUPLING FOR Pr.Gauge||1/2" # 600', 2853],
  ['COUPLING FOR Pr.Gauge||1/2" # 800', 2853],
  ['COUPLING FOR Pr.Gauge/Pr.Switch||1/2" # 3000', 2853],
  ['PRESSURE GAUGE|BIMETAL|D-6\'\', 1/2" BSP 0-21 KG/CM2(G)', 2225],
  ['HEX NIPPLE FOR TEMP. GAUGE|MS|1/2" x 3/8"', 2852],
  ['HEX NIPPLE FOR PG|MS|1/2" x 3/8"', 2852],
  ['1 /2 " COUPLING FOR MANOMETER|IS 1079|1/2 "(15NB) BSP', 2853],
  ['HEX NIPPLE|MS \'B\' CL|1 /2"', 1170],
  ['MS HEX NIPPLE|MS|3/8" BSP', 1169],
  ['MS HEX NIPPLE|MS|3/8"x1/2" BSP', 2852],
  ['PRESSURE GAUGE (STEAM)||D-8\'\', 1/2" BSP 0-21KG/CM2(G)', 2226],
  ['PRESSURE GAUGE (STEAM)||D-8\'\', 1/2" BSP 0-30KG/CM2(G)', 2221],
  ['HEXNIPPLE FOR Pr.Gauge/Pr.Switch||1/2" X 1/2" -#3000', 2851],
  ['Pipe Nipple (ST)|SMLS|1"x 6" Lg.', 2160],
  ['PRESSURE GAUGE (FEED LINE)||D-4\'\', 3/8" BSP 0-21KG/CM2(G)', 2224],
  ['PRESSURE GAUGE (FEED LINE)|CASING MS BLACK PAINTED|D-4\'\', THREAD 3/8" BSP (BRASS) 0-21KG/CM2(G)', 2224],
  ['PRESSURE GAUGE (FEED LINE)||D-4\'\', 3/8" BSP 0-30KG/CM2(G)', 2219],
  ['1 /2 " COUPLING FOR MANOMETER|IS 1079|1/2 "(15NB) BSP', 2853],
  ['MANOMETER CONNECTING PIPE|B "CLASS|15 NB - 18.0M LONG', 1980],
  ['PIPE NIPPLES|MS|1/2" x 6" Lg', 2158],
  ['HEXNIPPLE||1/2" X 1/2"', 1170],
];

console.log(apply ? '=== APPLYING (round 7: gauge_fitting) ===\n' : '=== DRY RUN (round 7: gauge_fitting, nothing written) ===\n');
for (const [key, itemId] of LINKS) await linkAll(key, itemId, apply, counters);
console.log(`\n${counters.linked} linked.`);
if (apply) await audit('gauge_fitting', counters, { newItems: Object.keys(newItemIds) });
