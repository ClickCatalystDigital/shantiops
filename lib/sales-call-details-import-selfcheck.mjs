// node lib/sales-call-details-import-selfcheck.mjs
import assert from 'node:assert/strict';
import { normPhone, parseContactCell, splitProducts, parseSalesCallDetails, dedupeRows } from './sales-call-details-import.mjs';

assert.equal(normPhone('91-9876543210'), '9876543210');
assert.equal(normPhone('+91 98765 43210'), '9876543210');
assert.equal(normPhone('09876543210'), '9876543210');
assert.equal(normPhone('040-2345678'), '0402345678'); // landline keeps its digits
assert.equal(normPhone('12'), '');

const c = parseContactCell('Mob. No.  91-8591983735\n \n Tel. No. 8591983735\n \n Email Id A@B.com');
assert.deepEqual(c, { mobiles: ['8591983735'], tels: ['8591983735'], emails: ['a@b.com'] });
assert.deepEqual(parseContactCell('').mobiles, []);

assert.deepEqual(splitProducts('84021000-BOILER-A, 84021000-BOILER-B,'), ['BOILER-A', 'BOILER-B']);
assert.deepEqual(splitProducts('MS TANK, CHIMNEY'), ['MS TANK', 'CHIMNEY']);

const H = 'S.N,Customer,Organization Short Name,Address,Enquiry Date,Location,State,Contact Person,Last Conatct Name,Last Contact Mobile No.,Last Contact Telephone,Last Contact Email,Email Id,Product Type,Products,ENQ Status,Quote Price,Expected Date,A/c Manager,Last Followup,Followup Date,Action Taken,Plan Of Action,Next Followup Date';
const good = '1,ACME PVT LTD,,"Plot 1, Pune ALL",16/09/2026,ALL,,"Mob. No. 91-7099092845",,,,,"a@x.com ,  B@x.com",,84021000-BOILER,HOT OFFERS,"5,00,000",,Amit B,"Date  2026-09-29",29/09/2026,No response,Follow up,30/09/2026';
const split = '2,BETA,,Line 1,Line 2, India ALL,09/05/2026,ALL,,,,,,,,,,LEAD - COLD,00.00,,Sales Desk,,,,,';   // 2 extra address commas -> 26 columns
const cut = '3,GAMMA,,addr,11/06/2026,ALL,,,,,,,,,,FOLLOW UP STAGE,00.00,,BDM-NE,"Date 2026"';
const r = parseSalesCallDetails([`T\nR\nS\n${H}\n${good}\n${split}\n${cut}\n`]);
assert.equal(r.rows.length, 2);
assert.equal(r.bad.length, 1);
assert.equal(r.bad[0].serial, 3);
const a = r.rows[0];
assert.equal(a.phone, '7099092845'); assert.equal(a.email, 'a@x.com'); assert.deepEqual(a.extraEmails, ['b@x.com']);
assert.equal(a.stage, 'Hot Offers'); assert.equal(a.manager, 'Amit B'); assert.equal(a.nextDate, '2026-09-30');
assert.equal(a.address, 'Plot 1, Pune'); assert.deepEqual(a.products, ['BOILER']); assert.equal(a.value, 500000);
assert.equal(r.rows[1].address, 'Line 1,Line 2, India'); assert.equal(r.rows[1].value, null);
const d = dedupeRows([a, { ...a, serial: 9 }, { ...a, value: 1 }], n => n.toLowerCase());
assert.equal(d.rows.length, 2); assert.equal(d.dups.length, 1);
console.log('sales-call-details-import selfcheck: ok');
