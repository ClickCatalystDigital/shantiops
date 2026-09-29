// node lib/order-spec-selfcheck.mjs
import assert from 'node:assert/strict';
import { mainLine, learnedValue, orderSpecDefaults as d } from './order-spec.mjs';

const L = (name, type, amount, id) => ({ product_id: id ?? null, product_name: name, product_type: type, item_description: name, amount });
const boiler = L('BOILER-SF-350-WB', 'SOLID-FLAME', 5000000, 7);
const chimney = L('STRAIGHT CHIMNEY-250 DIA X 6 M', 'STRAIGHT CHIMNEY/STACK', 300000, 8);
const prs = L('PRS-100', 'PRS', 900000, 9);

// boiler + chimney + PRS: the boiler decides, even though PRS is a "series" too
assert.deepEqual(d([chimney, prs, boiler]), { series: 'SF', model_design: 'WB', model_capacity: 350, model_pressure: null, product_id: 7 });
// PRS only -> PRS is the main equipment
assert.equal(d([chimney, prs]).series, 'PRS');
// no boiler, no PRS (spares / services) -> nothing
assert.deepEqual(d([chimney, L('SITE VISIT CHARGES', null, 1000)]), { series: null, model_design: null, model_capacity: null, model_pressure: null, product_id: null });
// two boiler lines that disagree: the larger one wins
assert.equal(d([L('BOILER-CF-200', 'COMBI-FLAME', 100), L('BOILER-SF-300', 'SOLID-FLAME', 900)]).series, 'SF');
// a contradicting product (type vs code) contributes nothing
assert.equal(d([L('BOILER-CF-350', 'SOLID-FLAME', 100)]).series, null);
// an unlinked line is read from its description
assert.equal(mainLine([{ product_id: null, item_description: 'BOILER-OF-100-2S', amount: 5 }]).spec.series, 'OF');

// memory: needs 2 uses AND >= 60% (smoothed)
assert.equal(learnedValue([{ value: 10.54, uses: 1 }]), null);
assert.equal(learnedValue([{ value: 10.54, uses: 2 }]), 10.54);                              // (2+1)/(2+2)=0.75
assert.equal(learnedValue([{ value: 10.54, uses: 2 }, { value: 17.5, uses: 2 }]), null);      // 0.5 — contested
assert.equal(learnedValue([{ value: 10.54, uses: 3 }, { value: 17.5, uses: 1 }]), 10.54);      // 4/6
assert.equal(learnedValue([{ value: 10.54, uses: 2 }, { value: 17.5, uses: 1 }]), 10.54);      // 3/5 = 0.6 is exactly the bar
assert.equal(learnedValue([{ value: 10.54, uses: 1 }, { value: 17.5, uses: 1 }, { value: 7, uses: 1 }]), null);
// memory overrides the name for that product only, and fills what the name lacks
const mem = { model_pressure: [{ value: 10.54, uses: 3 }], model_design: [{ value: 'SWB', uses: 2 }] };
const r = d([boiler, chimney], mem);
assert.deepEqual([r.series, r.model_capacity, r.model_pressure, r.model_design], ['SF', 350, 10.54, 'SWB']);
assert.equal(d([{ ...boiler, product_id: null }], mem).model_pressure, null);   // no product id -> no memory
console.log('order-spec selfcheck: ok');
