// node lib/item-match-selfcheck.mjs
import assert from 'node:assert';
import { keyDim, stemOf, gradeMatches, memoryKeys, memoryTrusted } from './item-attributes.mjs';
import { buildCatalogIndex, matchLine, memoryFromRows, fillUnitFromCatalog } from './item-match.mjs';

// --- shape-defining size, line side
assert.strictEqual(keyDim('plate', '2500 X 12000 X 12THK.'), 't12');
assert.strictEqual(keyDim('plate', '2500 X 10000 X 16 THK.'), 't16');
assert.strictEqual(keyDim('plate', '1250X 1250X 8 MM THICK'), 't8');
assert.strictEqual(keyDim('plate', '8 X 1500 X 6300'), null, 'no thickness marker on a line: not guessed');
assert.strictEqual(keyDim('angle', 'ISA 50X50X5T X 2000Lg'), 'a50x50x5');
assert.strictEqual(keyDim('angle', 'ISA50x50 X5thk'), 'a50x50x5');
assert.strictEqual(keyDim('angle', 'ISA 40X5T'), null, 'two numbers are not an angle size');
assert.strictEqual(keyDim('channel', 'ISMC100X50X5T X 3000Lg'), 'c100x50');
assert.strictEqual(keyDim('pipe', 'Φ63.5 x 3.66 THK - 2780 LG (2nd PASS)'), 'p63.5x3.66');
assert.strictEqual(keyDim('pipe', 'Φ48.3 x 3.68 THK (SCH-40)'), 'p48.3x3.68');
assert.strictEqual(keyDim('round', 'Φ50 -310 LG'), 'd50');
assert.strictEqual(keyDim('round', 'ø100 x 115 Lg/ 63dia 900 lg'), null, 'two diameters in one cell: not guessed');
assert.strictEqual(keyDim('channel', 'ISMC 100x50 ISA50x50'), null, 'a channel and an angle in one cell');
assert.strictEqual(keyDim('angle', 'ISMC 100x50 ISA50x50x5'), null);
assert.strictEqual(keyDim('square', 'SQ.10x10- 5000 LG.'), 's10');
// --- catalog side
assert.strictEqual(keyDim('plate', 'BQ PLATE 12 MM SA 516 GR 70, NORMALIZED, FORM IV TC', 'catalog'), 't12');
assert.strictEqual(keyDim('plate', 'BQ PLATE 10MM SA 516 GR 70, NORMALIZED, FORM IV TC', 'catalog'), 't10');
assert.strictEqual(keyDim('angle', 'MS ANGLE 50 X 50 X 5 MM', 'catalog'), 'a50x50x5');
assert.strictEqual(keyDim('channel', 'MS CHANELS ISMC 100 X 50', 'catalog'), 'c100x50');
assert.strictEqual(keyDim('pipe', 'APH TUBE BS6323 PART V OD 28.40 X 2.34 TH X 6.1 MTR', 'catalog'), 'p28.4x2.34');
assert.strictEqual(keyDim('round', 'MS EN-8 ROD 40 MM (1 MTR 10 KGS)', 'catalog'), 'd40');
assert.strictEqual(keyDim('flat', 'SS FLAT 25 MM X 5 MM', 'catalog'), 'f25x5');
// --- family stem: rows differing only by size share it
assert.strictEqual(stemOf('BQ PLATE 12 MM SA 516 GR 70, NORMALIZED, FORM IV TC'), stemOf('BQ PLATE 16 MM SA 516 GR 70, NORMALIZED, FORM IV TC'));
assert.notStrictEqual(stemOf('BQ PLATE 12 MM SA 516 GR 70, NORMALIZED, FORM IV TC'), stemOf('MS PLATE 12 MM IS 2062'));
assert.strictEqual(stemOf('MS ANGLE 50 X 50 X 5 MM'), stemOf('MS ANGLE 65 X 65 X 6 MM'));
// --- grade
assert.strictEqual(gradeMatches('SA 516 Gr.70', 'BQ PLATE 12 MM SA 516 GR 70, NORMALIZED'), true);
assert.strictEqual(gradeMatches('SA 516 Gr.60', 'BQ PLATE 12 MM SA 516 GR 70, NORMALIZED'), false);
assert.strictEqual(gradeMatches('MS', 'BQ PLATE 12 MM SA 516 GR 70'), null, 'a generic grade says nothing');
assert.strictEqual(gradeMatches('EN-8', 'ROUND TOUGHENED GLASS 100 MM'), false, 'a specific short grade still rules a row out');
assert.strictEqual(gradeMatches('EN-8', 'MS EN-8 ROD 63 MM'), true);

// --- matching against a catalog shaped like the real one
const catalog = [
  { id: 4001, item_name: 'ROUND TOUGHENED GLASS 100 MM', bom_category: 'round', uom: 'Nos' },
  { id: 4002, item_name: 'MS EN-8 ROD 63 MM (1 MTR 24.5 KGS)', bom_category: 'round', uom: 'Nos' },
  { id: 4003, item_name: 'SYHON PIPE-SCH-80 Q TYPE 3/8"', bom_category: 'pipe', uom: 'Nos' },
  { id: 191, item_name: 'BQ PLATE 10MM SA 516 GR 70, NORMALIZED, FORM IV TC', bom_category: 'plate', uom: 'Mtr' },
  { id: 192, item_name: 'BQ PLATE 12 MM SA 516 GR 70, NORMALIZED, FORM IV TC', bom_category: 'plate', uom: 'Mtr' },
  { id: 194, item_name: 'BQ PLATE 16 MM SA 516 GR 70, NORMALIZED, FORM IV TC', bom_category: 'plate', uom: 'Mtr' },
  { id: 300, item_name: 'MS PLATE 10 MM IS 2062', bom_category: 'plate', uom: 'Kgs' },
  { id: 310, item_name: 'MS PLATE 10 MM IS 2062 GALVANISED', bom_category: 'plate', uom: 'Kgs' },
  { id: 1919, item_name: 'MS ANGLE 50 X 50 X 5 MM', bom_category: 'angle', uom: 'kgs' },
  { id: 2478, item_name: 'SS FLAT 25 MM X 5 MM', bom_category: 'flat', uom: 'Nos' },
  { id: 900, item_name: 'SAFETY VALVE HIGH LIFT 25 X 50 IBR', bom_category: 'standard', uom: 'Nos' },
];
const idx = buildCatalogIndex(catalog);
const bq = (size) => ({ material_description: 'BQ PLATE MATERIAL', moc: 'SA 516 Gr.70', size_spec: size, category: 'plate' });

let m = matchLine(bq('2500 X 12000 X 12THK.'), idx);
assert.deepStrictEqual([m.level, m.itemId], ['attribute', 192], 'thickness + grade leave one row');
assert.strictEqual(matchLine(bq('2500 X 10000 X 16 THK.'), idx).itemId, 194);
assert.strictEqual(matchLine(bq('1000 X 2500 X 10 THK.'), idx).itemId, 191, 'the BQ 10 mm row, not the MS 10 mm rows: the grade decides');
m = matchLine({ material_description: 'PLATE', moc: 'MS', size_spec: '1000X 1000X 10 MM THICK', category: 'plate' }, idx);
assert.strictEqual(m.level, 'suggest', 'a generic grade leaves several 10 mm rows: suggest, never auto');
assert.ok(m.candidates.length >= 3);
m = matchLine(bq('2500 X 9000 X 14 THK.'), idx);
assert.notStrictEqual(m.level, 'attribute', 'no 14 mm row: never linked to another thickness');
assert.notStrictEqual(m.level, 'memory');
m = matchLine({ material_description: 'ANGLE', moc: 'MS', size_spec: 'ISA 50X50X5T X 6000Lg', category: 'angle' }, idx);
assert.deepStrictEqual([m.level, m.itemId], ['attribute', 1919]);
assert.strictEqual(matchLine({ material_description: 'SAFETY VALVE (HIGH LIFT TYPE)', moc: 'CS', size_spec: '25 x 50 MM, IBR T-H', category: 'standard' }, idx).candidates[0]?.id, 900, 'fuzzy suggestion for a bought-out item');
assert.strictEqual(matchLine({ material_description: 'SAFETY VALVE (HIGH LIFT TYPE)', moc: 'CS', size_spec: '25 x 50 MM', category: 'standard' }, idx).level, 'suggest', 'never auto from a name alone');

// a plain "MS" plate must not be silently upgraded to the only 12 mm row when that row is a specific SA 516 boiler-quality plate
m = matchLine({ material_description: 'PLATE', moc: 'MS', size_spec: '1250 x 2500 x 12 THK', category: 'plate' }, idx);
assert.strictEqual(m.level, 'suggest', 'a generic-grade line never auto-links to a BQ-grade row');
assert.strictEqual(m.candidates[0].id, 192);
// a SHAFT of EN-8 must not link to a glass row that happens to be a 100 mm 'round'
m = matchLine({ material_description: 'SHAFT', moc: 'EN-8', size_spec: 'ø100 x 115 Lg', category: 'round' }, idx);
assert.notStrictEqual(m.level, 'attribute');
assert.deepStrictEqual([matchLine({ material_description: 'SHAFT', moc: 'EN-8', size_spec: 'ø63 x 900 Lg', category: 'round' }, idx).level, matchLine({ material_description: 'SHAFT', moc: 'EN-8', size_spec: 'ø63 x 900 Lg', category: 'round' }, idx).itemId], ['attribute', 4002]);
assert.strictEqual(matchLine({ material_description: 'PIPE', moc: 'C.S-SMLS', size_spec: 'Φ48.3 x 3.68 THK (SCH-40)', category: 'pipe' }, idx).level, 'none', 'one generic word and size-cell noise suggest nothing');

// --- memory
const line = { material_description: 'SAFETY VALVE (HIGH LIFT TYPE)', moc: 'CS', size_spec: '25 x 50 MM, IBR T-H', category: 'standard' };
const k = memoryKeys(line);
let mem = memoryFromRows([{ kind: 'exact', alias_key: k.alias, moc_key: k.moc, size_key: k.size, item_id: 900, approvals: 1, rejections: 0 }]);
m = matchLine(line, idx, mem);
assert.deepStrictEqual([m.level, m.itemId], ['memory', 900], 'one confirmation is enough');
mem = memoryFromRows([{ kind: 'exact', alias_key: k.alias, moc_key: k.moc, size_key: k.size, item_id: 900, approvals: 1, rejections: 1 }]);
assert.strictEqual(matchLine(line, idx, mem).level, 'suggest', 'a rejection pulls it back to suggest-only');
assert.ok(memoryTrusted({ approvals: 1, rejections: 0 }) && !memoryTrusted({ approvals: 0, rejections: 0 }) && !memoryTrusted({ approvals: 1, rejections: 1 }));
// family memory breaks a tie between two rows with the same size + grade
const kp = memoryKeys({ material_description: 'PLATE', moc: 'MS', size_spec: '' });
mem = memoryFromRows([{ kind: 'family', alias_key: kp.alias, moc_key: kp.moc, size_key: '', item_id: 300, approvals: 1, rejections: 0 }]);
m = matchLine({ material_description: 'PLATE', moc: 'MS', size_spec: '1000X 1000X 10 MM THICK', category: 'plate' }, idx, mem);
assert.deepStrictEqual([m.level, m.itemId], ['family', 300], 'the remembered family (MS PLATE IS 2062) picks its own 10 mm row out of three candidates');

// --- unit fill
assert.strictEqual(fillUnitFromCatalog('50', 'Nos', 'standard'), '50 Nos');
assert.strictEqual(fillUnitFromCatalog('50', 'kgs', 'angle'), '50 Kgs');
assert.strictEqual(fillUnitFromCatalog('50', 'Mtr', 'plate'), '50', 'plates are never given the catalog metre unit');
assert.strictEqual(fillUnitFromCatalog('2 Nos', 'Mtr', 'standard'), '2 Nos', 'the sheet unit wins');
assert.strictEqual(fillUnitFromCatalog('50', 'feet', 'standard'), '50', 'unknown catalog unit is not written');
console.log('lib/item-match.mjs self-check: all assertions passed.');
