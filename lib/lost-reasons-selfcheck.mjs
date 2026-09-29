import assert from 'node:assert/strict';
import { composeReason, reasonCategory } from './lost-reasons.mjs';
assert.equal(composeReason('No response', ''), 'No response');
assert.equal(composeReason('Price too high', ' 5% over '), 'Price too high — 5% over');
assert.equal(reasonCategory('Price too high — 5% over'), 'Price too high');
assert.equal(reasonCategory('customer went elsewhere'), 'Other (free text)');
assert.equal(reasonCategory(null), 'Other (free text)');
console.log('lost-reasons selfcheck ok');
