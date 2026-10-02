// node scripts/cut-validate-selfcheck.mjs — test matrix for lib/cut-validate.mjs
import assert from 'node:assert/strict';
import { validateCut } from '../lib/cut-validate.mjs';
const plate = { kind: 'plate', length_mm: 1000, width_mm: 1000, thickness_mm: 12 };
const P = (l, w, t = 12) => ({ length_mm: l, width_mm: w, thickness_mm: t });
const err = (src, u, r = []) => validateCut(src, u, r).errors;

// plate / sheet
assert.deepEqual(err(plate, [P(1000, 1000)]), [], 'full consumption, no remnant');
assert.match(err(plate, [P(1000, 1000)], [P(100, 100)])[0], /consumes the entire source plate/);
assert.deepEqual(err(plate, [P(700, 1000)], [P(300, 1000)]), [], '300x1000 remnant fits');
assert.deepEqual(err(plate, [P(700, 1000)], [P(1000, 300)]), [], 'remnant fits rotated');
assert.match(err(plate, [P(700, 1000)], [P(500, 500)])[0], /does not fit within the remaining material/, '500x500 fits by area not geometry');
assert.match(err(plate, [P(1100, 500)])[0], /Used length \(1100 mm\) exceeds source length \(1000 mm\)/);
assert.match(err(plate, [P(500, 1200)])[0], /Used width \(1200 mm\) exceeds source width \(1000 mm\)/);
assert.match(err(plate, [P(500, 500)], [P(2000, 500)])[0], /extends outside the source plate/);
assert.match(err(plate, [P(500, 500, 10)])[0], /Thickness is inherited/);
assert.match(err(plate, [P(600, 1000)], [P(300, 1000), P(300, 1000)])[0], /Remnants overlap each other/);
assert.deepEqual(err(plate, [P(500, 500)], [P(500, 500), P(500, 1000)]), []);
assert.match(err(plate, [P(800, 800), P(800, 800)])[0], /Used pieces overlap/);
assert.deepEqual(err({ ...plate, length_mm: 2500, width_mm: 1250, thickness_mm: 6 }, [P(1200, 600, 6), P(1200, 600, 6)], [P(1250, 1250, 6)]), []);
assert.match(err(plate, [])[0], /at least one/);

// pipe / tube / round bar / flat bar / angle / channel / beam — all kind 'linear'
const lin = { kind: 'linear', length_mm: 6000 };
const L = l => ({ length_mm: l });
assert.deepEqual(err(lin, [L(6000)]), []);
assert.deepEqual(err(lin, [L(2500), L(2500)], [L(1000)]), []);
assert.match(err(lin, [L(6500)])[0], /Used length \(6500 mm\) exceeds source length \(6000 mm\)/);
assert.match(err(lin, [L(4000), L(1500)], [L(1000)])[0], /Total cut length \(6500 mm\) exceeds source length/);
assert.match(err(lin, [L(0)])[0], /enter a length/);
console.log('cut-validate selfcheck ok');
