import assert from 'node:assert/strict';
import { amountInWords, cleanRows, tourSummary, normalizeRequest, eligibleAdvances, cleanCustomers } from './service-expense.mjs';

assert.equal(amountInWords(0), '');
assert.equal(amountInWords(125000), 'Rupees One Lakh Twenty Five Thousand Only');
assert.equal(amountInWords(5405), 'Rupees Five Thousand Four Hundred Five Only');
assert.equal(amountInWords(12345678.5), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only');

assert.equal(cleanRows([{ amount: '' }, { amount: '10.555' }, { date: '2026-10-01' }], ['date', 'amount']).length, 2);

const body = { date: '2026-10-01', purpose: 'Commissioning', place: { type: 'db', id: 5, name: 'Acme' },
  travel: [{ amount: 500 }, {}], lodging: [{ amount: 1000 }], boarding: [{ place: 'X', amount: 200 }], conveyance: [], other: [{ amount: 50 }] };
const r = normalizeRequest('travel', body);
assert.equal(r.amount, 1750);
assert.equal(r.data.travel.length, 1);
assert.equal(tourSummary(r.data, 600).balance, 1150);
assert.ok(normalizeRequest('travel', { ...body, lodging: [], travel: [], boarding: [], other: [] }).error);
assert.ok(normalizeRequest('cash', { date: '2026-10-01', amount: 10, purpose: 'x', customers: [] }).error);
assert.deepEqual(cleanCustomers([{ type: 'other', name: ' A ' }, { type: 'other', name: 'a' }]).length, 1);

const cash = [
  { id: 1, req_no: 'CR-1', status: 'with_accounts', amount: 1000, customers: [{ name: 'Acme' }, { name: 'Beta' }], used_by: null },
  { id: 2, req_no: 'CR-2', status: 'with_accounts', amount: 500, customers: [{ name: 'Acme' }], used_by: 9 },
  { id: 3, req_no: 'CR-3', status: 'pending_manager', amount: 500, customers: [{ name: 'Acme' }], used_by: null },
];
const adv = eligibleAdvances(cash, 'acme');
assert.equal(adv.length, 1);
assert.deepEqual(adv[0].shared, ['Beta']);
console.log('service-expense selfcheck ok');
