// Round 9: "rope_gasket" bucket. Full catalog check found the complete ASBESTOS METALLIC ROPE
// (2075-2081) and ASBESTOS CUT GASKET METALIC/NON-METALIC (2082-2102) families by NB size — a
// gasket's stocked size only depends on its NB, not which flange rating table (T/H, T/E, T/F,
// ANSI B16.5) it's cut for. No CANVAS CLOTH item exists at all — genuinely left unresolved rather
// than fabricated.
import { PROJECTS, db, norm, findRows, createItem, resolveId, linkAll, decomposeAll, audit } from './lib/bom-resolve-helpers.mjs';

const apply = process.argv.includes('--apply');
const counters = { linked: 0, decomposed: 0, deleted: 0 };

const LINKS = [
  ['ASBESTOR ROPE + HOLDTITE|ASBESTOR|DIA 10', 2078],
  ['ASBESTOR ROPE + HOLDTITE|ASBESTOR|DIA 8', 2077],
  ['ASBESTOR ROPE|ASBESTOR|8 MM', 2077],
  ['ASBESTOR ROPE ROUND (SHELL TO CONE)||10 MM', 2078],
  ['GASKET|NON-METALIC|40 NB-T/F', 2098],
  ['GASKET|NON-METALIC|25 NB -T-H', 2097],
  ['GASKET|NON-METALIC|15 NB -T-E', 2095],
  ['GASKET|NON-METALIC|50 NB -T-E', 2099],
  ['GASKET|NON-METALIC|80 NB -T-H', 2101],
  ['METALLIC GASKET FOR NOZZLE|METALIC|ANSI B16.5 #150 (100 NB) MSSV', 2089],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 73 x ID 50 x 3MM THK. (40 NB) S.V', 2085],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 73 x ID 50 x 3MM THK. (40 NB) WLGH, BDV', 2085],
  ['METALLIC GASKET FOR NOZZLE|METALIC|ANSI B16.5 #150 (40 NB),FCV', 2085],
  ['METALLIC GASKET FOR NOZZLE|METALIC|ANSI B16.5 #150 (25 NB),AV, WLC', 2084],
  ['ASBESTOR ROPE|ASBESTOR ROPE|6 MM', 2076],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 203 x ID91 x 3MM THK. (80 NB) MSSV', 2088],
  ['GASKET|NON-METALIC|100 NB, ANSI B16.5 #150', 2102],
  ['GASKET|NON-METALIC|80 NB, ANSI B16.5 #150', 2101],
  ['GASKET|NON-METALIC|65 NB, ANSI B16.5 #150', 2100],
  ['GASKET|NON-METALIC|4", NIBR- T-E', 2102],
  ['METALIC GASKETS (ANSI B16.5 #150)||200 NB,', 2092],
  ['METALIC GASKETS (ANSI B16.5 #150)||100NB,', 2089],
  ['METALIC GASKETS (ANSI B16.5 #150)||80NB,', 2088],
  ['METALIC GASKETS (ANSI B16.5 #150)||65NB,', 2087],
  ['METALIC GASKETS (ANSI B16.5 #150)||40NB,', 2085],
  ['METALIC GASKETS (ANSI B16.5 #150)||25NB', 2084],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 157 x ID 116 x 3MM THK. (100 NB) MSSV', 2089],
];

const DECOMPOSE = [
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 127 x ID91 x 3MM THK.  (80 NB) MSSV                                                                                                 OD 51 x ID 37 x 3MM THK.  (25 NB) S.V                                      OD 73 x ID 50 x 3MM THK.  (40 NB) WLGH, BDV ,FCV                                                                                                                                        OD 51 x ID 37 x 3MM THK. (25NB)  WLC                                OD 43 x ID 30 x 3MM THK. (20NB) WLG', [
    { size: 'OD 127 x ID91 x 3MM THK. (80 NB) MSSV', qty: '1 No', itemId: 2088, category: 'standard' },
    { size: 'OD 51 x ID 37 x 3MM THK. (25 NB) S.V', qty: '2 No', itemId: 2084, category: 'standard' },
    { size: 'OD 73 x ID 50 x 3MM THK. (40 NB) WLGH, BDV ,FCV', qty: '6 No', itemId: 2085, category: 'standard' },
    { size: 'OD 51 x ID 37 x 3MM THK. (25NB) WLC', qty: '3 No', itemId: 2084, category: 'standard' },
    { size: 'OD 43 x ID 30 x 3MM THK. (20NB) WLG', qty: '4 No', itemId: 2083, category: 'standard' },
  ]],
  ['METALIC GASKETS||OD280 x ID144 x 3MM THK (125 MM)                          OD 203 x ID91 x 3MM THK (80 MM)                            OD 92 x ID 62 x 3MM THK. (50 MM)', [
    { size: 'OD280 x ID144 x 3MM THK (125 MM)', qty: '2 Nos', itemId: 2090, category: 'standard' },
    { size: 'OD 203 x ID91 x 3MM THK (80 MM)', qty: '10 Nos', itemId: 2088, category: 'standard' },
    { size: 'OD 92 x ID 62 x 3MM THK. (50 MM)', qty: '2 Nos', itemId: 2086, category: 'standard' },
  ]],
  ['GASKET|METALIC|80 MM, ANSI B16.5 #150                   65 MM, ANSI B16.5 #150                      50 MM, ANSI B16.5 #150                   25 MM, ANSI B16.5 #150', [
    { size: '80 MM, ANSI B16.5 #150', qty: '2 Nos', itemId: 2088, category: 'standard' },
    { size: '65 MM, ANSI B16.5 #150', qty: '1 Nos', itemId: 2087, category: 'standard' },
    { size: '50 MM, ANSI B16.5 #150', qty: '1 Nos', itemId: 2086, category: 'standard' },
    { size: '25 MM, ANSI B16.5 #150', qty: '1 Nos', itemId: 2084, category: 'standard' },
  ]],
];

console.log(apply ? '=== APPLYING (round 9: rope_gasket) ===\n' : '=== DRY RUN (round 9: rope_gasket, nothing written) ===\n');
for (const [key, itemId] of LINKS) await linkAll(key, itemId, apply, counters);
for (const [key, pieces] of DECOMPOSE) await decomposeAll(key, pieces, apply, counters);
console.log(`\n${counters.linked} linked, ${counters.decomposed} decomposed, ${counters.deleted} bundle(s) removed.`);
if (apply) await audit('rope_gasket', counters);
