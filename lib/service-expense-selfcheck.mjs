import assert from 'node:assert/strict';
import { amountInWords, cleanRows, tourSummary, normalizeRequest, eligibleAdvances, cleanCustomers, allocateAdvance, cleanAttachments } from './service-expense.mjs';

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
  { id: 1, req_no: 'CR-1', status: 'with_accounts', amount: 1000, customers: [{ name: 'Acme' }, { name: 'Beta' }], requested_by: 'a', applied: [{ req_no: 'EXP-1', amount: 400 }] },
  { id: 2, req_no: 'CR-2', status: 'with_accounts', amount: 500, customers: [{ name: 'Acme' }], requested_by: 'a', applied: [{ amount: 500 }] },
  { id: 3, req_no: 'CR-3', status: 'pending_manager', amount: 500, customers: [{ name: 'Acme' }], requested_by: 'a', applied: [] },
  { id: 4, req_no: 'CR-4', status: 'settled', amount: 300, customers: [{ name: 'Zed' }], requested_by: 'me', applied: [] },
  { id: 5, req_no: 'CR-5', status: 'settled', amount: 300, customers: [{ name: 'Zed' }], requested_by: 'other', applied: [] },
];
const adv = eligibleAdvances(cash, { customerName: 'acme', username: 'me' });
assert.deepEqual(adv.map(a => [a.req_no, a.remaining]), [['CR-1', 600], ['CR-4', 300]]); // fully used, unapproved and others' unrelated ones are out
assert.deepEqual(adv[0].shared, ['Beta']);
assert.deepEqual(allocateAdvance(700, [{ id: 1, remaining: 600 }, { id: 4, remaining: 300 }]), { links: [{ cash_id: 1, amount: 600 }, { cash_id: 4, amount: 100 }], other: 0 });
assert.deepEqual(allocateAdvance(1000, [{ id: 4, remaining: 300 }]), { links: [{ cash_id: 4, amount: 300 }], other: 700 });
assert.equal(allocateAdvance(0, [{ id: 4, remaining: 300 }]).links.length, 0);
const att = cleanAttachments({ lodging: [{ key: 'service-expenses/me/a.jpg', name: 'a.jpg', type: 'image/jpeg' }, { key: 'service-expenses/you/b.jpg', type: 'image/jpeg' }, { key: 'service-expenses/me/c.exe', type: 'x/y' }] }, 'service-expenses/me/');
assert.deepEqual(Object.keys(att), ['lodging']); assert.equal(att.lodging.length, 1);
assert.equal(normalizeRequest('travel', { ...body, attachments: { lodging: att.lodging } }, { keyPrefix: 'service-expenses/me/' }).data.attachments.lodging.length, 1);
console.log('service-expense selfcheck ok');
