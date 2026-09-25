import assert from 'node:assert/strict';
import { employeeMetrics, monthlySeries, weeklyActivity, monthsBetween, addMonths, weekOf } from './sales-insights.mjs';

assert.deepEqual(monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
assert.equal(addMonths('2026-01', -2), '2025-11');
assert.equal(weekOf('2026-09-25'), '2026-09-21'); // Friday → Monday

const users = [{ username: 'amit', display_name: 'Amit B' }, { username: 'kalyani', display_name: 'Kalyani' }];
const stages = [{ name: 'Cold', sort_order: 0 }, { name: 'Won', is_won: 1, sort_order: 7 }, { name: 'Lost', is_lost: 1, sort_order: 8 }];
const data = {
  users, stages,
  leads: [
    { id: 1, account_manager: 'amit', enquiry_date: '2026-09-02', sales_call_status: 'Won' },
    { id: 2, assigned_to: 'Amit B', enquiry_date: '2026-09-10', sales_call_status: 'Lost' },
    { id: 3, account_manager: 'kalyani', enquiry_date: '2026-08-10', sales_call_status: 'Cold' },
  ],
  diaryNotes: [
    { id: 1, lead_id: 1, created_by: 'amit', visit_date: '2026-09-03', next_plan_date: '2026-09-05' },
    { id: 2, lead_id: 1, created_by: 'amit', visit_date: '2026-09-06' },
    { id: 3, lead_id: 3, created_by: 'kalyani', visit_date: '2026-09-04', next_plan_date: '2026-09-20', plan_for: 'amit' },
  ],
  quotations: [
    { id: 1, lead_id: 1, status: 'sent', quotation_date: '2026-09-04', total: 1000 },
    { id: 2, lead_id: 2, status: 'draft', quotation_date: '2026-09-04', total: 500 },
    { id: 3, created_by: 'kalyani', status: 'accepted', quotation_date: '2026-09-04', total: 300 },
  ],
  saleOrders: [
    { id: 1, lead_id: 1, order_date: '2026-09-08', total: 900 },
    { id: 2, sales_person: 'Amit B', order_date: '2026-09-09', total: 100 },
    { id: 3, sales_person_override: 'kalyani', lead_id: 1, order_date: '2026-09-09', total: 50, status: 'cancelled' },
    { id: 4, sales_person: 'Sales Desk', order_date: '2026-09-09', total: 70 },
  ],
  salesTargets: [{ account_manager: 'amit', period: '2026-09', target_amount: 2000 }],
  expenseClaims: [{ employee_name: 'Amit B', claim_date: '2026-09-15', total_amount: 400 }],
  stageHistory: [
    { lead_id: 1, to_stage: 'Cold', changed_at: '2026-09-02 00:00:00' },
    { lead_id: 1, to_stage: 'Won', changed_at: '2026-09-06 00:00:00' },
  ],
};
const m = employeeMetrics(data, '2026-09', '2026-09');
const a = m.get('amit');
assert.equal(a.enquiries, 2);
assert.equal(a.won, 1); assert.equal(a.lost, 1); assert.equal(a.winRate, 50);
assert.equal(a.salesCalls, 2);
assert.equal(a.plannedFollowups, 2);   // own plan + kalyani planned one for amit
assert.equal(a.actualFollowups, 1);    // note 2 (09-06) fulfils the 09-05 plan; the 09-20 plan has no later note
assert.equal(a.quotations, 1); assert.equal(a.quotationValue, 1000); // draft excluded
assert.equal(a.orders, 2); assert.equal(a.orderValue, 1000);         // lead owner + legacy "Amit B"
assert.equal(a.target, 2000); assert.equal(a.achievement, 50);
assert.equal(a.expenses, 400); assert.equal(a.costPerOrder, 200);
assert.equal(a.avgDaysPerStage, 4);
const k = m.get('kalyani');
assert.equal(k.enquiries, 0);          // her enquiry is in August
assert.equal(k.quotations, 1); assert.equal(k.orders, 0); // cancelled order excluded
assert.equal(m.get('Sales Desk').orders, 1); // legacy name kept as its own row

const series = monthlySeries(data, '2026-08', '2026-09', 'amit');
assert.deepEqual(series.map(s => [s.month, s.enquiries, s.orders, s.orderValue, s.target]), [['2026-08', 0, 0, 0, 0], ['2026-09', 2, 2, 1000, 2000]]);
assert.equal(monthlySeries(data, '2026-09', '2026-09')[0].orders, 3); // everyone, cancelled excluded
assert.deepEqual(weeklyActivity(data, '2026-09', '2026-09', 'amit'), [{ week: '2026-08-31', value: 2 }]);
console.log('sales-insights selfcheck ok');
