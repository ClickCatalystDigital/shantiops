// node lib/company-filter-selfcheck.mjs
import assert from 'node:assert/strict';
import { parseCompany, filterByCompany, rowCompany } from './company-filter.mjs';
assert.equal(parseCompany('Shanti%20Techno%20Fab'), 'Shanti Techno Fab');
assert.equal(parseCompany(''), null); assert.equal(parseCompany('Nope'), null); assert.equal(parseCompany(undefined), null);
const rows = [{ id: 1, company: 'Shanti Boilers' }, { id: 2, company: 'Shanti Techno Fab' }, { id: 3, company: null }];
assert.equal(rowCompany(rows[2]), 'Shanti Boilers');
assert.deepEqual(filterByCompany(rows, 'Shanti Boilers').map(r => r.id), [1, 3]);
assert.deepEqual(filterByCompany(rows, 'Shanti Techno Fab').map(r => r.id), [2]);
assert.equal(filterByCompany(rows, null).length, 3);
console.log('company-filter selfcheck: all assertions passed');
