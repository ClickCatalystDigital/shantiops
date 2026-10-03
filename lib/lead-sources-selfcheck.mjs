// node lib/lead-sources-selfcheck.mjs
import assert from 'node:assert';
import { mapIndiaMart, mapTradeIndia, mapJustDial, mapWebform, indiamartTime, pullWindow, last10, usable } from './lead-sources.mjs';

const im = mapIndiaMart({ UNIQUE_QUERY_ID: '2741', SENDER_NAME: 'Ravi', SENDER_COMPANY: 'Ravi Foods', SENDER_MOBILE: '+91-9876543210',
  SENDER_EMAIL: 'r@x.in', SENDER_CITY: 'Pune', QUERY_PRODUCT_NAME: 'Steam Boiler', QUERY_MESSAGE: 'Need 1 TPH', QUERY_TIME: '2026-10-03 11:05:00', SENDER_ADDRESS: 'null' });
assert.strictEqual(im.externalId, '2741');
assert.strictEqual(im.organization, 'Ravi Foods');
assert.strictEqual(im.product, 'Steam Boiler');
assert.strictEqual(im.enquiryDate, '2026-10-03');
assert.strictEqual(im.address, '', 'the literal "null" IndiaMART sends is treated as blank');

const ti = mapTradeIndia({ rfi_id: 99, sender_name: 'Asha', sender_co: 'Asha Mills', sender_mobile: '9000000001', product_name: 'IBR Boiler' });
assert.strictEqual(ti.externalId, '99');
assert.strictEqual(ti.phone, '9000000001');

const jd = mapJustDial({ leadid: 'JD1', name: 'Kiran', mobile: '9123456789', category: 'Boiler Dealers', area: 'Ameerpet', city: 'Hyderabad' });
assert.strictEqual(jd.product, 'Boiler Dealers');
assert.strictEqual(jd.address, 'Ameerpet');

const wf = mapWebform({ name: 'Meera', email: 'm@y.com', message: 'Call me' });
assert.ok(usable(wf));
assert.ok(!usable(mapWebform({ name: 'No contact' })), 'no phone and no email is not usable');

assert.strictEqual(last10('+91 98765-43210'), '9876543210');
assert.strictEqual(indiamartTime(new Date('2026-10-03T00:00:00Z')), '03-10-202605:30:00', 'IST, IndiaMART format');

const now = new Date('2026-10-20T00:00:00Z');
assert.strictEqual(now - pullWindow(null, now).from, 24 * 3600e3, 'first run: last 24 h');
assert.strictEqual(now - pullWindow('2026-09-01T00:00:00Z', now).from, 7 * 24 * 3600e3, 'never more than 7 days');
assert.strictEqual(now - pullWindow('2026-10-19T23:00:00Z', now).from, 70 * 60e3, 'last success minus 10 min overlap');
console.log('lib/lead-sources.mjs self-check: all assertions passed.');
