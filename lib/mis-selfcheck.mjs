import assert from 'node:assert/strict';
import { ordersBy, winLoss, leadGeneration, callLog, dailyWork, lastContact, funnelAgeing, orderTimeCycle } from './mis.mjs';

const users = [{ username: 'amit', display_name: 'Amit B' }];
const stages = [{ name: 'Cold', sort_order: 0 }, { name: 'Won', is_won: 1, sort_order: 7 }, { name: 'Lost', is_lost: 1, sort_order: 8 }];
const leads = [
  { id: 1, account_manager: 'amit', source: 'Web', reference: 'Ravi', branch_id: 1, enquiry_date: '2026-09-02', sales_call_status: 'Won', expected_value: 100 },
  { id: 2, account_manager: 'amit', source: 'Web', enquiry_date: '2026-09-03', sales_call_status: 'Lost', expected_value: 50 },
  { id: 3, account_manager: 'amit', source: 'Fair', enquiry_date: '2026-08-03', sales_call_status: 'Cold', updated_at: '2026-08-10' },
];
const saleOrders = [
  { id: 1, lead_id: 1, quotation_id: 9, order_date: '2026-09-08', total: 900, so_no: 'SO-1' },
  { id: 2, order_date: '2026-09-09', total: 100, sales_person: 'Amit B' },
  { id: 3, lead_id: 1, order_date: '2026-09-09', total: 5, status: 'cancelled' },
];
const quotations = [{ id: 9, lead_id: 1, status: 'accepted', quotation_date: '2026-09-04' }, { id: 10, lead_id: 2, status: 'draft', quotation_date: '2026-09-04' }];
const data = { leads, saleOrders, quotations, users, stages, branches: [{ id: 1, name: 'Hyd' }] };

const src = ordersBy('source', data, '2026-09-01', '2026-09-30');
assert.equal(src.find(r => r.key === 'Web').orders, 1);
assert.equal(src.find(r => r.key === 'Web').enquiries, 2);
assert.equal(src.find(r => r.key === '(not recorded)').orders, 1);          // direct order, no enquiry
assert.equal(src.reduce((t, r) => t + r.value, 0), 1000);                    // cancelled excluded
assert.equal(ordersBy('branch', data, '2026-09-01', '2026-09-30').find(r => r.key === 'Hyd').orders, 1);
assert.equal(ordersBy('employee', data, '2026-09-01', '2026-09-30')[0].label, 'Amit B');

const wl = winLoss(data, '2026-09-01', '2026-09-30')[0];
assert.deepEqual([wl.won, wl.lost, wl.winRate, wl.quotes, wl.accepted], [1, 1, 50, 1, 1]); // draft quote ignored

assert.equal(leadGeneration(data, '2026-08-01', '2026-09-30', 'month').length, 2);
assert.equal(leadGeneration(data, '', '', 'source')[0].key, 'Web');

const notes = [
  { id: 1, created_by: 'amit', note_type: 'call', visit_date: '2026-09-05', company_name: 'A', in_time: '10:00', out_time: '10:30', location: 'Pune', customer_id: 5 },
  { id: 2, created_by: 'amit', note_type: 'meeting', visit_date: '2026-09-05', company_name: 'B', in_time: '09:00', location: 'Pune', customer_id: 5 },
  { id: 3, created_by: 'amit', note_type: 'note', created_at: '2026-09-01 10:00:00', lead_id: 2 },
];
assert.equal(callLog(notes, '', '', 'call').length, 1);
assert.equal(callLog(notes, '', '', 'all').length, 3);
const dw = dailyWork(notes, '', '', users).find(r => r.date === '2026-09-05');
assert.deepEqual([dw.entries, dw.first, dw.last, dw.places.length], [2, '09:00', '10:30', 1]);
const lc = lastContact(notes, '2026-09-10');
assert.equal(lc.find(r => r.key === 'c5').daysAgo, 5);
assert.equal(lc[0].key, 'l2');                                              // oldest contact first

const fa = funnelAgeing(leads, stages, [{ lead_id: 1, changed_at: '2026-09-02 10:00:00' }], '2026-09-12');
assert.equal(fa.rows.length, 1);                                            // only the open (Cold) enquiry
assert.equal(fa.rows[0].days, 33);                                          // since updated_at 2026-08-10
assert.equal(fa.byStage[0].buckets[2], 1);                                  // 31-90 days

const tc = orderTimeCycle(data, '2026-09-01', '2026-09-30');
assert.equal(tc.rows.find(r => r.id === 1).fromEnquiry, 6);
assert.equal(tc.rows.find(r => r.id === 1).fromQuote, 4);
assert.equal(tc.rows.length, 1);                                            // order 2 has no enquiry/quote; 3 cancelled
console.log('mis selfcheck ok');
