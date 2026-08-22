// scripts/depreciation-selfcheck.mjs — node scripts/depreciation-selfcheck.mjs
import assert from 'node:assert';
import { monthlyDepreciation } from '../lib/depreciation.mjs';

// SLM: cost 120000, salvage 12000, life 9y -> (120000-12000)/(9*12) = 1000.00/mo
assert.equal(monthlyDepreciation({ cost: 120000, salvageValue: 12000, usefulLifeYears: 9, method: 'SLM' }), 1000);

// SLM caps at remaining depreciable value, never goes negative or past salvage.
assert.equal(monthlyDepreciation({ cost: 120000, salvageValue: 12000, usefulLifeYears: 9, method: 'SLM', accumulatedDepreciation: 107500 }), 500);
assert.equal(monthlyDepreciation({ cost: 120000, salvageValue: 12000, usefulLifeYears: 9, method: 'SLM', accumulatedDepreciation: 108000 }), 0);

// WDV: book value shrinks each period, so monthly depreciation shrinks too (not flat like SLM).
const wdvMonth1 = monthlyDepreciation({ cost: 100000, salvageValue: 10000, usefulLifeYears: 5, method: 'WDV' });
const wdvMonth2 = monthlyDepreciation({ cost: 100000, salvageValue: 10000, usefulLifeYears: 5, method: 'WDV', accumulatedDepreciation: wdvMonth1 });
assert.ok(wdvMonth1 > 0 && wdvMonth2 > 0 && wdvMonth2 < wdvMonth1, `expected shrinking WDV instalments, got ${wdvMonth1} then ${wdvMonth2}`);

// Fully depreciated asset (accumulated already at cost-salvage) depreciates no further.
assert.equal(monthlyDepreciation({ cost: 50000, salvageValue: 5000, usefulLifeYears: 3, method: 'SLM', accumulatedDepreciation: 45000 }), 0);

// Degenerate inputs don't throw or go negative.
assert.equal(monthlyDepreciation({ cost: 1000, salvageValue: 1000, usefulLifeYears: 5, method: 'SLM' }), 0);
assert.equal(monthlyDepreciation({ cost: 1000, salvageValue: 0, usefulLifeYears: 0, method: 'SLM' }), 0);

console.log('depreciation-selfcheck OK');
