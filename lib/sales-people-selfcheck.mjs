// node lib/sales-people-selfcheck.mjs
import assert from 'node:assert/strict';
import { personKey, personLabel, salesPeopleOptions } from './sales-people.mjs';

const users = [{ username: 'kalyani', display_name: 'Kalyani R' }, { username: 'sales_head', display_name: null }];
assert.equal(personKey('kalyani', users), 'kalyani');
assert.equal(personKey('  kalyani   r ', users), 'kalyani');
assert.equal(personKey('SALES_HEAD', users), 'sales_head');
assert.equal(personKey('Amit B', users), 'Amit B');
assert.equal(personKey('', users), null);
assert.equal(personKey(null, users), null);
assert.equal(personLabel('kalyani', users), 'Kalyani R');
assert.equal(personLabel('sales_head', users), 'sales_head');
assert.equal(personLabel('Amit B', users), 'Amit B');
assert.equal(personLabel(null, users), '—');
const opts = salesPeopleOptions(users, ['Amit B', 'Kalyani R', 'Amit B', '']);
assert.deepEqual(opts.map(o => o.value), ['kalyani', 'sales_head', 'Amit B']);
assert.equal(opts[2].label, 'Amit B (not a user)');
console.log('sales-people selfcheck: all assertions passed');
