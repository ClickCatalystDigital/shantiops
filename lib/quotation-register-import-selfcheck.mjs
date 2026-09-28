// node lib/quotation-register-import-selfcheck.mjs
import assert from 'node:assert';
import { parseDate, isJunkCustomer, companyFromQno, parseTsv, classifyRows, buildQuotationGroups, matcher } from './quotation-register-import.mjs';

assert.equal(parseDate('21-Jun-2025'), '2025-06-21');
assert.equal(parseDate('not-a-date'), null);
assert.equal(isJunkCustomer('Test'), true);
assert.equal(isJunkCustomer('test for check'), true);
assert.equal(isJunkCustomer('Testing Solutions Pvt Ltd'), false); // real company name, not caught
assert.equal(isJunkCustomer('Krijan Biotech'), false);
assert.equal(companyFromQno('SB/QTN/123/26-27'), 'Shanti Boilers');
assert.equal(companyFromQno('STF/QTN/123/26-27'), 'Shanti Techno Fab');
assert.equal(companyFromQno('SFT/123/26-27'), null); // typo'd prefix, not guessed

const tsv = 'Sr.No.\tCustomer\tQuotation No.\tQuotation Date\tPrepared By\tStatus\tRemarks\n1\tAcme\tQ1\t01-Jan-2025\tAmit B\tOpen\t';
const rows = parseTsv(tsv, 'Open');
assert.equal(rows.length, 1);
assert.equal(rows[0].qno, 'Q1');
assert.equal(rows[0].dateIso, '2025-01-01');

const mixed = [
  { customer: 'Acme', qno: 'Q1', dateIso: '2025-01-01', preparedBy: 'A', status: 'Open' },
  { customer: 'Acme', qno: 'Q1', dateIso: '2025-06-01', preparedBy: 'A', status: 'Open' }, // revision
  { customer: 'Beta', qno: 'Q2', dateIso: '2025-01-01', preparedBy: 'A', status: 'Open' },
  { customer: 'Gamma', qno: 'Q2', dateIso: '2025-02-01', preparedBy: 'A', status: 'Open' }, // Q2 collides across customers
  { customer: 'Test', qno: 'Q3', dateIso: '2025-01-01', preparedBy: 'A', status: 'Open' },
  { customer: 'Delta', qno: '', dateIso: '2025-01-01', preparedBy: 'A', status: 'Open' },
];
const { excluded, candidates } = classifyRows(mixed);
assert.equal(excluded.length, 4); // Q2 x2, Q3 test, blank qno
assert.equal(candidates.length, 2); // the Acme/Q1 pair
const groups = buildQuotationGroups(candidates);
assert.equal(groups.length, 1);
assert.equal(groups[0].revisions.length, 2);
assert.equal(groups[0].revisions[0].no, 'Q1');
assert.equal(groups[0].revisions[1].no, 'Q1-R1');

const m = matcher([{ id: 1, name: 'Acme Corp' }, { id: 2, name: 'Beta Traders' }]);
assert.equal(m('Acme Corp').customer.id, 1);
assert.equal(m('Nobody').customer, null);

console.log('quotation-register-import selfcheck: ok');
