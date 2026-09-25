// node lib/order-book-selfcheck.mjs
import assert from 'node:assert/strict';
import { orderBook, financialYears } from './order-book.mjs';

const saleOrders = [
  { id: 1, total: 1000, order_date: '2026-05-10', company: 'Shanti Boilers', track_status: 'WIP', sales_person: 'Amit B', customer_name: 'A' },
  { id: 2, total: 500, order_date: '2025-06-01', company: 'Shanti Techno Fab', track_status: 'Dispatched', sales_person: 'BDM', customer_name: 'B' },
  { id: 3, total: 200, order_date: null, created_at: null, track_status: 'Pending', customer_name: 'A' },
  { id: 4, total: 9999, order_date: '2026-05-11', status: 'cancelled' },
];
const payments = [
  { sale_order_id: 1, amount: 400, received_on: '2026-06-01' },
  { sale_order_id: 2, amount: 500, received_on: '2026-04-15' }, // older order, paid this FY
  { sale_order_id: 4, amount: 50, received_on: '2026-05-12' },  // cancelled order — ignored
];
const today = '2026-09-25';

const all = orderBook({ saleOrders, payments, fy: 'all', today });
assert.equal(all.kpis.orders, 3);
assert.equal(all.kpis.value, 1700);
assert.equal(all.kpis.receivedOnBooked, 900);
assert.equal(all.kpis.outstanding, 800);                       // 600 + 0 + 200
assert.equal(all.aging['91–180 days'], 600);                   // order 1: 138 days
assert.equal(all.aging['No order date'], 200);
assert.equal(all.byCompany.find(g => g.key === 'Shanti Boilers').value, 1200); // blank company = SB

const fy = orderBook({ saleOrders, payments, fy: '2026-27', today });
assert.equal(fy.kpis.orders, 1);
assert.equal(fy.kpis.value, 1000);
assert.equal(fy.kpis.collectedInPeriod, 900);                   // both payments fall in FY 2026-27
assert.deepEqual(fy.monthly.map(m => [m.month, m.booked['Shanti Boilers'] || 0, m.collected]),
  [['2026-04', 0, 500], ['2026-05', 1000, 0], ['2026-06', 0, 400]]);

assert.deepEqual(financialYears(saleOrders), ['2026-27', '2025-26']);
console.log('order-book selfcheck passed');
