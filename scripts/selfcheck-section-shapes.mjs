// Runnable self-check for lib/piece-weight.js + lib/section-shapes.js's geometry formulas —
// node scripts/selfcheck-section-shapes.mjs
import assert from 'node:assert/strict';
import { pieceWeight } from '../lib/piece-weight.js';
import { roundKgPerM, squareKgPerM, flatKgPerM, octagonalKgPerM, categoryWeightKg, geometrySizeLabel } from '../lib/section-shapes.js';

function close(actual, expected, tol = 0.01) { assert.ok(Math.abs(actual - expected) < tol, `${actual} !~ ${expected}`); }

// Plate: 1000 x 1000 x 10 mm mild steel = 1m x 1m x 0.01m x 7850 kg/m3 = 78.5 kg
close(pieceWeight({ kind: 'plate', length_mm: 1000, width_mm: 1000, thickness_mm: 10 }), 78.5);

// Round bar: 25mm dia, kg/m = (pi/4)*(0.025)^2*7850 ~= 3.853 kg/m
close(roundKgPerM(25), 3.853);

// Square bar: 20mm side, kg/m = 0.02^2*7850 = 3.14 kg/m
close(squareKgPerM(20), 3.14);

// Flat bar: 50x6mm, kg/m = 0.05*0.006*7850 = 2.355 kg/m
close(flatKgPerM(50, 6), 2.355);

// Octagonal: 30mm across flats, kg/m = 2*(sqrt2-1)*(0.03)^2*7850 ~= 5.853 kg/m
close(octagonalKgPerM(30), 5.853, 0.01);

// categoryWeightKg wires geometry -> pieceWeight('linear') correctly for a 2m round bar
close(categoryWeightKg('round', { diameter: 25, length: 2000 }), 3.853 * 2, 0.02);

// geometrySizeLabel produces a stable, matchable string
assert.equal(geometrySizeLabel('flat', { width: 50, thickness: 6 }), 'FLAT 50x6');
assert.equal(geometrySizeLabel('round', { diameter: 25 }), 'ROUND 25');
assert.equal(geometrySizeLabel('flat', {}), '');

console.log('OK — section-shapes formulas check out');
