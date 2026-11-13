import assert from 'node:assert/strict';
import { evaluate, pickRule, verdict } from './acceptance.mjs';

const R = (id, extra) => ({ id, rule_key: 'hard', version: 1, characteristic: 'Hardness', min: null, max: 200, min_inclusive: 1, max_inclusive: 1, unit: 'HBW', scope: 'global', ...extra });
// Boundaries both ways.
assert.equal(verdict(200, R(1)), 'pass');
assert.equal(verdict(201, R(1)), 'fail');
assert.equal(verdict(200, R(1, { max_inclusive: 0 })), 'fail');
assert.equal(verdict(3, R(1, { min: 3, max: 9 })), 'pass');
assert.equal(verdict(3, R(1, { min: 3, max: 9, min_inclusive: 0 })), 'fail');
assert.equal(verdict('x', R(1)), 'fail');
// Most specific scope, then highest version; retired rules ignored.
const rules = [R(1), R(2, { version: 2 }), R(3, { scope: 'customer', scope_value: 'Acme', max: 180 }), R(4, { scope: 'project', scope_value: 'AB-1', max: 220, retired_at: '2026-01-01' })];
assert.equal(pickRule(rules, 'hardness', {}).id, 2);
assert.equal(pickRule(rules, 'Hardness', { customer: 'acme' }).id, 3);
assert.equal(pickRule(rules, 'Hardness', { project: 'AB-1' }).id, 2, 'retired project rule ignored');
// Evaluate: verdict and rule id stored; unit mismatch is an error, not a guess; no rule = no verdict.
let e = evaluate([{ characteristic: 'Hardness', value: 201, unit: 'hbw' }], rules);
assert.equal(e.anyFail, true); assert.equal(e.rows[0].rule_id, 2);
e = evaluate([{ characteristic: 'Hardness', value: 150, unit: 'HV' }], rules);
assert.equal(e.errors.length, 1); assert.equal(e.rows[0].verdict, null);
e = evaluate([{ characteristic: 'Ferrite', value: 5, unit: 'FN' }], rules);
assert.equal(e.rows[0].verdict, null); assert.equal(e.errors.length, 0);
// An old verdict keeps its rule: a new version does not change rows already evaluated with rule 2.
const old = evaluate([{ characteristic: 'Hardness', value: 195, unit: 'HBW' }], rules).rows[0];
assert.equal(old.rule_id, 2);
assert.equal(evaluate([{ characteristic: 'Hardness', value: 195, unit: 'HBW' }], [...rules, R(5, { version: 3, max: 190 })]).rows[0].verdict, 'fail');
assert.equal(old.verdict, 'pass');
console.log('acceptance ok');
