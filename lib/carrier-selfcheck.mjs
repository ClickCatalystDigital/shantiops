import assert from 'node:assert/strict';
import { carrierDocLabel, carrierDocShort, cleanTrackingUrl, carrierSummary } from './carrier.mjs';
assert.equal(carrierDocLabel('ship'), 'Bill of lading no.');
assert.equal(carrierDocLabel(undefined), 'LR no.');                       // no mode chosen = road
assert.equal(carrierDocShort('air'), 'AWB');
assert.deepEqual(cleanTrackingUrl(''), { value: null });
assert.equal(cleanTrackingUrl('https://x.com/t?id=1').value, 'https://x.com/t?id=1');
assert.ok(cleanTrackingUrl('javascript:alert(1)').error);
assert.ok(cleanTrackingUrl('ftp://x').error);
assert.equal(carrierSummary({ transport_mode: 'road', carrier_doc_no: '4451', dispatch_through: 'ABC', vehicle_no: 'TS09' }), 'LR 4451 · ABC · TS09');
assert.equal(carrierSummary({}), '');
console.log('carrier selfcheck ok');
