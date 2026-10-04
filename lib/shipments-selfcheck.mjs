import assert from 'node:assert/strict';
import { checkCombinable } from './shipments.mjs';
const L = (o) => ({ packing_no: 'PL-1', customer_name: 'HKM Foundation', customer_address: 'Plot 5, Kucharam', status: 'draft', shipment_id: null, company: 'A', ...o });
assert.equal(checkCombinable([L({})]).ok, false);                                              // need two
assert.equal(checkCombinable([L({}), L({ packing_no: 'PL-2' })]).ok, true);                    // same customer + address
assert.equal(checkCombinable([L({}), L({ packing_no: 'PL-2', customer_address: 'plot 5 kucharam' })]).ok, true); // address spelled loosely
assert.equal(checkCombinable([L({}), L({ packing_no: 'PL-2', customer_address: 'Elsewhere' })]).ok, false);      // different address
assert.equal(checkCombinable([L({}), L({ packing_no: 'PL-2', status: 'dispatched' })]).ok, false);              // already shipped
assert.equal(checkCombinable([L({}), L({ packing_no: 'PL-2', shipment_id: 9 })]).ok, false);                   // in another shipment
assert.equal(checkCombinable([L({}), L({ packing_no: 'PL-2', shipment_id: 9 })], 9).ok, true);                 // ...unless it is this one
const noAddr = checkCombinable([L({ customer_address: null }), L({ packing_no: 'PL-2', customer_address: '' })]);
assert.equal(noAddr.ok, true); assert.equal(noAddr.warnings.length, 1);                        // same name, no address: allowed with a warning
assert.equal(checkCombinable([L({ customer_address: null }), L({ packing_no: 'PL-2', customer_name: 'Other Ltd', customer_address: null })]).ok, false); // different names, no address
assert.equal(checkCombinable([L({}), L({ packing_no: 'PL-2', customer_name: 'HKM Group', company: 'B' })]).ok, true); // group names, same address
console.log('shipments selfcheck ok');
