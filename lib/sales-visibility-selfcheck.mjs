// node lib/sales-visibility-selfcheck.mjs
import assert from 'node:assert/strict';
import { leadVisible, scopeSalesLists } from './sales-visibility.mjs';
assert.equal(leadVisible({ owner_dept: 'Sales', account_manager: 'amit' }, 'amit'), true);
assert.equal(leadVisible({ owner_dept: 'Sales', assigned_to: 'x', created_by: 'y' }, 'amit'), false);
assert.equal(leadVisible({ owner_dept: 'Marketing', assigned_to: 'x' }, 'amit'), true);
const r = scopeSalesLists('amit', {
  leads: [{ id: 1, owner_dept: 'Sales', assigned_to: 'amit' }, { id: 2, owner_dept: 'Sales', assigned_to: 'bob' }],
  quotations: [{ id: 10, lead_id: 1 }, { id: 11, lead_id: 2 }, { id: 12, created_by: 'amit' }],
  saleOrders: [{ id: 20, lead_id: 1 }, { id: 21, sales_person_override: 'Amit B' }, { id: 22, sales_person_override: 'amit' }],
  invoices: [{ id: 30, sale_order_id: 20 }, { id: 31, sale_order_id: 21 }, { id: 32, quotation_id: 12 }],
  creditNotes: [{ id: 40, sales_invoice_id: 30 }, { id: 41, sales_invoice_id: 31 }],
  salePayments: [{ id: 50, sale_order_id: 22 }, { id: 51, sale_order_id: 21 }],
  diaryNotes: [{ id: 60, lead_id: 1 }, { id: 61, lead_id: 2 }],
});
assert.deepEqual(r.leads.map(x => x.id), [1]);
assert.deepEqual(r.quotations.map(x => x.id), [10, 12]);
assert.deepEqual(r.saleOrders.map(x => x.id), [20, 22]);          // legacy "Amit B" text isn't this user
assert.deepEqual(r.invoices.map(x => x.id), [30, 32]);
assert.deepEqual(r.creditNotes.map(x => x.id), [40]);
assert.deepEqual(r.salePayments.map(x => x.id), [50]);
assert.deepEqual(r.diaryNotes.map(x => x.id), [60]);
console.log('sales-visibility selfcheck: all assertions passed');
