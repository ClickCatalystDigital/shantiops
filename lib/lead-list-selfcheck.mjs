// node lib/lead-list-selfcheck.mjs
import assert from 'node:assert/strict';
import { filterLeads, leadsPage, leadBoard, relatedLeads, enquiryFormHints } from './lead-list.mjs';

const stages = [
  { name: 'Lead - Cold', sort_order: 1 }, { name: 'Proposals', sort_order: 2 },
  { name: 'Order Received', sort_order: 3, is_won: 1 }, { name: 'Order Lost', sort_order: 4, is_lost: 1 },
];
const L = (id, o) => ({ id, lead_name: `L${id}`, company_name: null, source: null, account_manager: 'amit', sales_call_status: 'Lead - Cold', ...o });
const leads = [
  L(1, { company_name: 'Acme Pvt Ltd', source: 'Web', expected_value: 100, enquiry_date: '2026-01-03' }),
  L(2, { company_name: 'ACME', sales_call_status: 'Proposals', expected_value: 50, enquiry_date: '2026-01-02' }),
  L(3, { company_name: 'Beta', account_manager: null, enquiry_type: 'amc' }),
  L(4, { company_name: 'Acme Private Limited', sales_call_status: 'Order Received', expected_value: 70, enquiry_date: '2026-01-01' }),
  L(5, { company_name: 'Gamma', sales_call_closed_at: '2026-01-01' }), // closed call at an open stage
  L(6, { company_name: 'Beta', sales_call_status: 'Order Lost', branch_id: 2 }),
];

assert.deepEqual(filterLeads(leads, { stage: 'Proposals' }).map(l => l.id), [2]);
assert.deepEqual(filterLeads(leads, { unassigned: true }).map(l => l.id), [3]);
assert.deepEqual(filterLeads(leads, { amc: true }).map(l => l.id), [3]);
assert.deepEqual(filterLeads(leads, { branch: '2' }).map(l => l.id), [6]);
assert.deepEqual(filterLeads(leads, { search: 'acme' }).map(l => l.id), [1, 2, 4]);
// group by customer: Acme (1,2,4) together, then Beta (3,6), then Gamma
assert.deepEqual(filterLeads(leads, { group: true }).map(l => l.id), [1, 2, 4, 3, 6, 5]);

const p = leadsPage(leads, { stage: 'all' }, 1, 2);
assert.equal(p.total, 6);
assert.deepEqual(p.rows.map(r => r.id), [2, 3]);
assert.equal(p.rows[0].group_count, 3); // three Acme enquiries
assert.deepEqual(p.sources, ['Web']);
assert.equal(p.unassignedCount, 1);
assert.equal(p.amcCount, 1);

const b = leadBoard(leads, {}, stages, 1);
const col = n => b.columns.find(c => c.name === n);
assert.equal(col('Lead - Cold').count, 2); // 5 is a closed call, left out
assert.equal(col('Lead - Cold').cards.length, 1); // perStage = 1
assert.equal(col('Lead - Cold').cards[0].id, 1); // newest enquiry date first
assert.equal(b.wonCount, 1); assert.equal(b.lostCount, 1);
assert.equal(b.openValue, 150);
assert.deepEqual(leadBoard(leads, {}, stages, 1, { stage: 'Lead - Cold', offset: 1 }).cards.map(c => c.id), [3]);

assert.deepEqual(relatedLeads(leads, leads[0]).map(l => l.id), [2, 4]);
const h = enquiryFormHints(leads, 'acme pvt. ltd.');
assert.deepEqual(h.sameOrg.map(x => x.id), [1, 2, 4]);
console.log('lead-list ok');
