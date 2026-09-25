// node lib/enquiry-import-selfcheck.mjs
import assert from 'node:assert/strict';
import { isoDate, splitPhones, cleanProducts, parseEnquiries, customerMatcher, isOpenEnquiry } from './enquiry-import.mjs';

assert.equal(isoDate('25/08/2026'), '2026-08-25');
assert.equal(isoDate('3/4/2026'), '2026-04-03');
assert.equal(isoDate('31/13/2026'), null);
assert.equal(isoDate('2026-08-25'), null);
assert.deepEqual(splitPhones('6304747635 | 7569309007 | NA'), ['6304747635', '7569309007']);
assert.deepEqual(splitPhones('NA'), []);
assert.equal(cleanProducts('FLUE GAS DUCTING, STRAIGHT CHIMNEY/S,  '), 'FLUE GAS DUCTING, STRAIGHT CHIMNEY/S');

const H = 'serial_no,customer,organization_short_name,address,district,state,enquiry_date,phone_numbers,email,products,source_pages\n';
const csv = '﻿' + H
  + '1,SS Engineers India,,Rajahmundry,ALL,NA,25/08/2026,6304747635 | 7569309007,Ayush@SSEngrIndia.com,"FLUE GAS DUCTING, CHIMNEY,",1\n'
  + '2,SS Engineers India,,Rajahmundry,ALL,NA,25/08/2026,6304747635 | 7569309007,ayush@ssengrindia.com,"FLUE GAS DUCTING, CHIMNEY",1\n' // same enquiry printed twice
  + '3,Granary Agro LLP,GAL,Vaishali,Vaishali,Bihar,02/06/2021,NA,NA,,1\n'
  + '4,,,x,ALL,NA,01/01/2021,,,,2\n'
  + '5,Bad Date Co,,x,ALL,NA,2021-01-01,,,,2\n';
const { rows, bad, duplicates } = parseEnquiries(csv);
assert.equal(rows.length, 2); assert.equal(duplicates.length, 1); assert.equal(bad.length, 2);
assert.equal(rows[0].phone, '6304747635'); assert.equal(rows[0].telephone, '7569309007');
assert.equal(rows[0].email, 'ayush@ssengrindia.com'); assert.equal(rows[0].district, null); assert.equal(rows[0].state, null);
assert.equal(rows[0].products, 'FLUE GAS DUCTING, CHIMNEY');
assert.equal(rows[1].short_name, 'GAL'); assert.equal(rows[1].district, 'Vaishali'); assert.equal(rows[1].phone, null); assert.equal(rows[1].email, null);

const match = customerMatcher([
  { id: 1, name: 'M/s. SS Engineers India Pvt Ltd' },
  { id: 2, name: 'Granary Agro' }, { id: 3, name: 'Granary Agro Limited' }, // shared key -> ambiguous
  { id: 4, name: 'Anil' },
  { id: 5, name: 'Konkan Sugars Industries' },
]);
assert.equal(match({ name: 'SS Engineers India' }).customer.id, 1);           // suffixes ignored
assert.equal(match({ name: 'Granary Agro LLP' }).customer, null);            // two customers share the name
assert.equal(match({ name: 'Anil' }).customer.id, 4);                         // exact, only one with the name

const m2 = customerMatcher([
  { id: 10, name: 'SS Enterprises' }, { id: 11, name: 'MR Enterprises' }, { id: 12, name: 'P K TRADING COMPANY' },
  { id: 13, name: 'Ravi' }, { id: 14, name: 'Ravi (2)' }, { id: 15, name: 'Ravi (PUNE)' }, { id: 16, name: 'Yusuf' },
]);
assert.equal(m2({ name: 'MR Enterprises' }).customer.id, 11);                 // initials kept
assert.equal(m2({ name: 'PK Trading Company' }).customer.id, 12);             // spacing ignored
assert.equal(m2({ name: 'M/s. Yusuf' }).customer.id, 16);
assert.equal(m2({ name: 'Ravi' }).customer, null);                            // "Ravi (2)"/"Ravi (PUNE)" are other Ravis
assert.equal(m2({ name: 'Ravi' }).reason, '3 customers share this name');
assert.equal(m2({ name: 'KL Enterprises' }).reason, 'similar names only');     // only the generic word matches
assert.equal(m2({ name: 'M/s. Yusuf (P) Ltd' }).customer.id, 16);
const m3 = customerMatcher([
  { id: 20, name: 'New K C Enterprises' }, { id: 21, name: 'Engineered Polymers (India) Pvt. Ltd.' }, { id: 22, name: 'SHAKTI ENGINEERING WORKS AND SERVICES' },
]);
assert.equal(m3({ name: 'New Enterprises' }).customer, null);                 // dropped initials never link
assert.equal(m3({ name: 'engineered polymers India P Ltd' }).customer.id, 21); // "P Ltd" = "Pvt. Ltd."
assert.equal(m3({ name: 'SHAKTI ENGINEERING WORKS & SERVICES' }).customer.id, 22); // "&" = "and"
assert.equal(match({ name: 'Konkan Sugars' }).customer, null);                // similar only -> review
assert.equal(match({ name: 'Konkan Sugars' }).similar[0].id, 5);
assert.equal(match({ name: 'Nobody Here Ltd' }).reason, 'no customer with this name');

assert.equal(isOpenEnquiry({ enquiry_date: '2025-09-25' }, '2025-09-25'), true);
assert.equal(isOpenEnquiry({ enquiry_date: '2025-09-24' }, '2025-09-25'), false);
console.log('enquiry-import selfcheck ok');
