// node lib/sales-tab-data-selfcheck.mjs
import assert from 'node:assert/strict';
import { salesTabKey, keysToLoad } from './sales-tab-data.mjs';
assert.equal(salesTabKey('sale-orders'), 'sale_orders');
assert.equal(salesTabKey(undefined), 'leads');
assert.deepEqual([...keysToLoad(['invoices', 'creditNotes'], false)], ['invoices', 'creditNotes']);
assert.deepEqual([...keysToLoad(['creditNotes'], true)].sort(), ['creditNotes', 'invoices', 'leads', 'quotations', 'saleOrders']);
assert.deepEqual([...keysToLoad(['salePayments'], true)].sort(), ['leads', 'saleOrders', 'salePayments']);
console.log('sales-tab-data ok');
