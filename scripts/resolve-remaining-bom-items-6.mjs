// Round 6: "valve" bucket. Full catalog check (Globe/Ball/Disc-Disk Check/Piston/Safety/Swing/Feed
// Check valve families, 1401-1915 + 2404-2407 + 2781-2782) found real matches for nearly
// everything the fuzzy top-4 list never surfaced (e.g. a full FORGED/CI/SGI/CAST STEEL/BRONZE
// Globe Valve range by F/E-vs-S/E, class, and NB, and an exact "40 NB X 80" IBR Safety Valve
// match). "ISO VALVE FOR ...GAUGE-S/E"/"...FOR MOBERY-F/E" are isolation valves FOR a device, not
// the device itself — mapped to the real generic Globe Valve family at the stated F/E-or-S/E,
// material and NB. The Mobrey level-control valve ITSELF, a Needle Valve, and a Solenoid Valve all
// have zero catalog entries under any name — genuine gaps, left unresolved (a branded/specialized
// device, never guessed at). "SWING CHECK VALVE (NIBR) 65 MM, C.I" — the catalog's real swing-type
// equivalent (NRV, Bronze, S/E) only goes to 50mm and is Bronze, not CI — two real mismatches, left
// unresolved rather than silently substituting the wrong material or missing size.
import { PROJECTS, db, norm, findRows, createItem, resolveId, linkAll, decomposeAll, audit } from './lib/bom-resolve-helpers.mjs';

const apply = process.argv.includes('--apply');
const counters = { linked: 0, decomposed: 0, deleted: 0 };

const LINKS = [
  ['DISK CHECK VALVE (NON SLAM CHECK)|SS 304|40 MM, 150# mm', 1433],
  ['DISK CHECK VALVE (NON SLAM CHECK)|SS 304|40 MM, 150#', 1433],
  ['GLOBE VALVE FOR - F/E (Pr.Gauge/Pr.switch)|FORGED|15MM #600', 1900],
  ['ISO VALVE FOR FEED LINE PR. GAUGE-S/E|FORGED|15MM, #600', 1900],
  ['GLOBE VALVE FOR - S/E (Pr.Gauge/Pr.switch)|FORGED|15MM, #800', 1900],
  ['ISO VALVE FOR FEED LINE PR. GAUGE-S/E|FORGED|15MM, #800', 1900],
  ['ISO VALVE FOR FEED LINE PR. GAUGE-S/E|FORGED|15MM', 1900],
  ['BALL VALVE : 50 MM (OUTLET)|C.I|50MM, ANSI B16.5 #150', 1496],
  ['BALL VALVE : 65 MM (INLET)|C.I|65MM, ANSI B16.5 #150', 1497],
  ['GLOBE  VALVE - F/E|SGI / CS|40MM, BS-10 TABLE-H', 1800],
  ['GLOBE  VALVE - F/E|CI / SGI|40MM, BS-10 TABLE-H', 1800],
  ['GLOBE VALVE (AIR VENT) - F/E|SGI / CS|25 MM, BS-10 TABLE-H', 1799],
  ['GLOBE VALVE (AIR VENT) - F/E|CS|25 MM, BS-10, TABLE-H', 1799],
  ['GLOBE VALVE( MSSV ) - F/E|SGI / CS|80 MM, BS-10 TABLE-H', 1803],
  ['GLOBE VALVE( MSSV ) - F/E|CI / SGI|100 MM, BS-10 TABLE-H', 1804],
  ['SAFETY VALVE -NIBR (VESSEL TYPE)|BRONZE/ GUN METAL|1/2 " BSPT -SCREWED END', 1630],
  ['PISTON VALVE( MSSV ) - F/E|CS|100 MM, ANSI B16.5 #150', 1858],
  ['SAFETY VALVE|CS|40 x 80 MM, IBR T-H', 1611],
  ['SAFETY VALVE (HIGH LIFT TYPE)|CS|40 x 80 MM, IBR T-H', 1611],
  ['GLOBE VALVE|SGI /CI|100 NB, ANSI B16.5 #150', 1804],
  ['GLOBE VALVE|SGI /CI|80 NB,ANSI B16.5 #150', 1803],
  ['GLOBE VALVE|SGI /CI|65 NB, ANSI B16.5 #150', 1802],
  ['GLOBE VALVE|SGI /CI|65 NB,ANSI B16.5 #150', 1802],
  ['ISO VALVE FOR MOBERY-F/E|SGI / CI|25MM, BS-10 TABLE \'H\'', 1799],
  ['ISO VALVE FOR MOBERY-F/E|CS|25MM, BS-10 TABLE \'H\'', 1799],
  ['ISO VALVE FOR MOBERY-F/E|SGI / CS|25MM, BS-10 TABLE \'H\'', 1799],
  ['ISO VALVE FOR MOBERY-F/E|CS|25 MM, BS-10, TABLE-H', 1799],
  ['ISO VALVE FOR MOBERY-F/E|CI / SGI|25MM, BS-10 TABLE \'H\'', 1799],
  ['INLET VALVE - F/E|C.S|80MM, BS -10 TABLE -H', 1790],
  ['INLET VALVE - F/E|SGI/C.S|80MM, BS -10 TABLE -H', 1790],
  ['OUTLET VALVE - F/E|C.S|125MM, BS-10 TABLE-H', 1792],
  ['OUTLET VALVE - F/E|SGI/C.S|125MM, BS-10 TABLE-H', 1792],
  ['PISTON VALVE (AIR VENT) - F/E|CS|25 MM, ASNI B16.5 #150', 1853],
  ['PIPE ( SAFETY VALVE)|MS|80 MM , MS \'B\' CL', 1985],
];

console.log(apply ? '=== APPLYING (round 6: valve) ===\n' : '=== DRY RUN (round 6: valve, nothing written) ===\n');
for (const [key, itemId] of LINKS) await linkAll(key, itemId, apply, counters);
console.log(`\n${counters.linked} linked.`);
if (apply) await audit('valve', counters);
