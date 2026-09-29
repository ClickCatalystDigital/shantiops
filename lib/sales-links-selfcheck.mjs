// node lib/sales-links-selfcheck.mjs
import assert from 'node:assert/strict';
import { parseAddress, contactNameFromCell, contactIndex, uniqueEnquiry, canonicalState, stateFromPin, last10 } from './sales-links.mjs';

let a = parseAddress('silambinathanpettai, Cuddalore, Tamil Nadu, 607102 ALL');
assert.deepEqual([a.pin, a.state, a.city, a.derived], ['607102', 'Tamil Nadu', 'Cuddalore', false]);
a = parseAddress('Hyderabad, Telangana HYDERABAD Telangana');
assert.deepEqual([a.pin, a.state, a.city], [null, 'Telangana', 'Hyderabad']);
a = parseAddress('4-1150 Old Market , Near Saraf Bazar, Hyderabad, Telangana, 585101');
assert.deepEqual([a.pin, a.state, a.city], ['585101', 'Telangana', 'Hyderabad']);
a = parseAddress('Plot 5, Some Road 560060');            // no state text -> from pincode, marked derived, no city
assert.deepEqual([a.pin, a.state, a.city, a.derived], ['560060', 'Karnataka', null, true]);
a = parseAddress('Puri, OR ALL');                        // "OR" is not a state alias — never guessed
assert.deepEqual([a.pin, a.state, a.city], [null, null, null]);
a = parseAddress('Plot No 97 & 98, Kolar Industrial Area, Bidar ALL');
assert.equal(a.state, null);
assert.equal(parseAddress('Ward 22, Belagavi, Karnataka, 591220').city, 'Belagavi');
assert.equal(parseAddress('12 Nagar Road, Karnataka, 560001').city, null); // "Nagar Road" isn't a city
assert.equal(stateFromPin('403001'), null); assert.equal(stateFromPin('500001'), 'Telangana');
assert.equal(canonicalState('orissa'), 'Odisha'); assert.equal(canonicalState('zzz'), null);
assert.equal(canonicalState('Andra Pradesh'), 'Andhra Pradesh'); assert.equal(canonicalState('Maharastra'), 'Maharashtra'); assert.equal(canonicalState('Jammu & Kashmir'), 'Jammu and Kashmir'); assert.equal(canonicalState('Andaman Nicobar'), 'Andaman and Nicobar Islands');
assert.equal(last10('91-9876543210'), '9876543210');
assert.equal(contactNameFromCell('Kanu  Patra\n \n Mob. No. 8514887200'), 'Kanu Patra');
assert.equal(contactNameFromCell('Mob. No. 8514887200'), null);
const find = contactIndex([{ id: 1, email: 'a@x.com', phone: '9876543210' }, { id: 2, email: 'b@x.com, c@x.com', phone: '' }, { id: 3, email: 'a@x.com', phone: '' }]);
assert.equal(find('b@x.com', '').id, 2);
assert.equal(find('a@x.com', '').id, null);               // shared by two customers
assert.equal(find('', '+91 98765 43210').id, 1);
assert.equal(find('b@x.com', '9876543210').id, null);     // email and phone disagree
const L = [{ id: 1, enquiry_date: '2026-01-10' }, { id: 2, enquiry_date: '2025-12-01' }];
assert.equal(uniqueEnquiry([L[0]], '2026-03-01').lead.id, 1);
assert.equal(uniqueEnquiry(L, '2026-03-01').lead, null);   // both fit -> not unique, never picks one
assert.equal(uniqueEnquiry(L, '2027-02-15').lead, null);   // both older than a year -> none fit
assert.equal(uniqueEnquiry(L, '2027-01-05').lead.id, 1);   // only the January one is within 365 days
console.log('sales-links selfcheck: ok');
