// node lib/lead-stage-selfcheck.mjs — checks lib/lead-stage.mjs against the real 9-stage funnel.
import assert from 'node:assert/strict';
import { leadStateForStage, isEnquiryStage, isSlaBreached, isKnownStage, dealsFromLeads, DEFAULT_STAGE } from './lead-stage.mjs';

// Mirrors the live sales_stages rows (checked 2026-09-25).
const STAGES = [
  { name: 'Lead - Cold', sort_order: 0, is_won: 0, is_lost: 0 },
  { name: 'Lead - Hot', sort_order: 1, is_won: 0, is_lost: 0 },
  { name: 'Lead Project - Dropped', sort_order: 2, is_won: 0, is_lost: 1 },
  { name: 'Proposals', sort_order: 3, is_won: 0, is_lost: 0 },
  { name: 'Hot Offers', sort_order: 4, is_won: 0, is_lost: 0 },
  { name: 'Order Received', sort_order: 5, is_won: 1, is_lost: 0 },
  { name: 'Order Lost', sort_order: 6, is_won: 0, is_lost: 1 },
  { name: 'Follow up stage', sort_order: 7, is_won: 0, is_lost: 0 },
  { name: 'OEM Follow Ups Monthly', sort_order: 8, is_won: 0, is_lost: 0 },
];

// State follows the stage.
assert.equal(leadStateForStage(STAGES, 'Order Received'), 'won');
assert.equal(leadStateForStage(STAGES, 'Order Lost'), 'lost');
assert.equal(leadStateForStage(STAGES, 'Lead Project - Dropped'), 'lost');
assert.equal(leadStateForStage(STAGES, 'Hot Offers'), 'open');
assert.equal(leadStateForStage(STAGES, 'No Such Stage'), 'open');
assert.equal(isKnownStage(STAGES, 'Proposals'), true);
assert.equal(isKnownStage(STAGES, 'Qualified'), false); // old 5-stage name

// Enquiry tab = before Proposals, still open.
assert.equal(isEnquiryStage(STAGES, 'Lead - Cold'), true);
assert.equal(isEnquiryStage(STAGES, 'Lead - Hot'), true);
assert.equal(isEnquiryStage(STAGES, 'Lead Project - Dropped'), false); // lost, sort 2
assert.equal(isEnquiryStage(STAGES, 'Proposals'), false);
assert.equal(isEnquiryStage(STAGES, 'Follow up stage'), false);
assert.equal(isEnquiryStage(STAGES, 'Unknown'), true); // never vanishes
// Without a "Proposals" stage: first two open stages.
const renamed = STAGES.map(s => (s.name === 'Proposals' ? { ...s, name: 'Quote Stage' } : s));
assert.equal(isEnquiryStage(renamed, 'Lead - Hot'), true);
assert.equal(isEnquiryStage(renamed, 'Quote Stage'), false);

// SLA: untouched default-stage lead older than 24h.
const now = Date.parse('2026-09-25T12:00:00Z');
const old = '2026-09-23 10:00:00';
assert.equal(isSlaBreached({ sales_call_status: DEFAULT_STAGE, status: 'open', created_at: old, updated_at: old }, now), true);
assert.equal(isSlaBreached({ sales_call_status: DEFAULT_STAGE, status: 'open', created_at: old, updated_at: '2026-09-24 09:00:00' }, now), false); // touched
assert.equal(isSlaBreached({ sales_call_status: 'Lead - Hot', status: 'open', created_at: old, updated_at: old }, now), false); // moved on
assert.equal(isSlaBreached({ sales_call_status: DEFAULT_STAGE, status: 'open', created_at: old, updated_at: old, sales_call_closed_at: old }, now), false); // closed
assert.equal(isSlaBreached({ sales_call_status: DEFAULT_STAGE, status: 'open', created_at: '2026-09-25 06:00:00', updated_at: '2026-09-25 06:00:00' }, now), false); // < 24h
assert.equal(isSlaBreached({ sales_call_status: null, status: null, created_at: old, updated_at: old }, now), true); // unset = default

// Deals: Sales enquiries become deals, Marketing keeps its opportunities, Sales opportunities drop.
const deals = dealsFromLeads(
  [{ id: 1, owner_dept: 'Sales', sales_call_status: 'Hot Offers', expected_value: 500, account_manager: 'amit', assigned_to: 'x' },
   { id: 2, owner_dept: 'Sales', sales_call_status: null, expected_value: null, assigned_to: 'kalyani' },
   { id: 3, owner_dept: 'Marketing', sales_call_status: 'Lead - Hot' }],
  [{ id: 40, owner_dept: 'Marketing', stage: 'Lead - Cold', value_num: 10 }, { id: 37, owner_dept: 'Sales', stage: 'Hot Offers', value_num: 99 }],
);
assert.equal(deals.length, 3);
assert.deepEqual(deals.map(d => d.id), ['LD-1', 'LD-2', 40]);
assert.equal(deals[0].created_by, 'amit');     // A/C manager wins over assignee
assert.equal(deals[1].created_by, 'kalyani');  // falls back to assignee
assert.equal(deals[1].stage, DEFAULT_STAGE);
assert.equal(deals[1].value_num, 0);

console.log('lead-stage selfcheck: all assertions passed');
