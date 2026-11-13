import assert from 'node:assert/strict';
import { normalizeExtract, lineToCertificate, lineProblems } from './mtr-extract.mjs';

const raw = {
  doc_type: 'mtr', confidence: 1.4, certificate_no: ' MT-778 ', steel_maker: 'Nucor', certificate_date: '2026-10-02', material_spec: 'SA-516 Gr.70',
  lines: [
    { heat_no: 'H1', plate_no: 'P1', ys: '262', uts: '485', strength_unit: 'MPa' },
    { heat_no: 'H2', ys: '38', uts: '70', strength_unit: 'ksi', material_spec: 'SA-516 Gr.60' },
    { heat_no: 'H3' },
    { heat_no: 'H1', plate_no: 'P1' },            // duplicate: merged
    { heat_no: '', plate_no: 'P9' },              // no heat: dropped with an error
  ],
};
const x = normalizeExtract(raw);
assert.equal(x.lines.length, 3, 'three heats');
assert.equal(x.confidence, 1, 'confidence clamped');
assert.equal(x.errors.length, 1);
assert.equal(x.lines[2].material_spec, 'SA-516 Gr.70', 'header spec fills a line without one');
const c = lineToCertificate(x.header, x.lines[1]);
assert.equal(c.ys, '38 ksi', 'unit kept as printed');
assert.equal(c.material_spec, 'SA-516 Gr.60');
assert.equal(c.certificate_no, 'MT-778');
assert.equal(lineProblems(x.header, x.lines[0]).length, 0);
assert.deepEqual(lineProblems({ certificate_no: '' }, { heat_no: 'H' }), ['certificate no.', 'material spec', 'mill']);
assert.equal(normalizeExtract({ doc_type: 'other' }).doc_type, 'other');
assert.equal(normalizeExtract({ doc_type: 'other' }).errors.length, 0, 'a non-MTR has no "no heats" error');
assert.equal(normalizeExtract(null).errors[0], 'No heats found');
assert.equal(normalizeExtract({ certificate_date: '02/10/2026', lines: [{ heat_no: 'A' }] }).header.certificate_date, null, 'date must be ISO');
console.log('mtr-extract ok');
