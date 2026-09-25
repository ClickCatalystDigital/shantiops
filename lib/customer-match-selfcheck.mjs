// node lib/customer-match-selfcheck.mjs
import assert from 'node:assert/strict';
import { customerMatchReasons, similarCustomers } from './customer-match.mjs';

const list = [
  { id: 1, name: 'Shanti Boilers & Pressure Vessels Pvt Ltd', gst_no: '36AAACS1234A1Z5', phone: '+91 98480 12345' },
  { id: 2, name: 'Konkan Sugars Limited', gst_no: null, phone: null },
  { id: 3, name: 'Sri Venkateswara Rice Mills', gst_no: null, phone: '040-23456789' },
];
assert.deepEqual(customerMatchReasons({ name: 'Shanti Boilers' }, list[0]), ['similar name']);
assert.deepEqual(customerMatchReasons({ name: 'KONKAN SUGARS PVT LTD' }, list[1]), ['similar name']);
assert.deepEqual(customerMatchReasons({ name: 'Other', gst_no: ' 36aaacs1234a1z5 ' }, list[0]), ['same GST No']);
assert.deepEqual(customerMatchReasons({ name: 'X', phone: '9848012345' }, list[0]), ['same phone']);
assert.deepEqual(customerMatchReasons({ name: 'Sugar Industries' }, list[1]), []);          // one shared word only
assert.deepEqual(customerMatchReasons({ name: 'Pvt Ltd' }, list[1]), []);                    // suffixes alone never match
assert.deepEqual(customerMatchReasons({ name: 'Rice' }, list[2]), []);                       // single word is not enough
const hits = similarCustomers({ name: 'Shanti Boilers', phone: '9848012345' }, list);
assert.equal(hits.length, 1); assert.equal(hits[0].id, 1); assert.deepEqual(hits[0].reasons, ['same phone', 'similar name']);
assert.equal(similarCustomers({ name: 'Konkan Sugars' }, list, { excludeId: 2 }).length, 0);
console.log('customer-match selfcheck: all assertions passed');
