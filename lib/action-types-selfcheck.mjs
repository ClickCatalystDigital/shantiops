// node lib/action-types-selfcheck.mjs
import assert from 'node:assert/strict';
import { classifyActionType as c, ACTION_TYPE_VALUES } from './action-types.mjs';
assert.equal(c('Spoke with him, he will send mail'), 'call');
assert.equal(c('Offer sent today'), 'offer');
assert.equal(c('send offer'), 'offer');
assert.equal(c('msged on whatsapp'), 'message');
assert.equal(c('Dear Sir, Your salescall has been created'), 'message');
assert.equal(c('emailed the specs'), 'email');
assert.equal(c('call not recieved'), 'call');
assert.equal(c('visited the plant'), 'meeting');
assert.equal(c('follow up'), 'status');
assert.equal(c('not lifting the phone'), 'call');
assert.equal(c('No requirement is there'), 'status');
assert.equal(c('xyz'), null); assert.equal(c(''), null); assert.equal(c(null), null);
assert.ok(['call', 'email', 'meeting', 'note'].every(v => ACTION_TYPE_VALUES.includes(v)));
console.log('action-types selfcheck: ok');
