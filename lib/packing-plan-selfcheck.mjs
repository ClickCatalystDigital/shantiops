import assert from 'node:assert/strict';
import { planCombinedList } from './packing-plan.mjs';
import { unitLabelOf, modelCodeOf, normalizePackType } from './packing-forms.mjs';

const A = (id, name, parent_id = null) => [id, { id, name, parent_id }];
const byId = new Map([A(1, 'Boiler'), A(2, 'Boiler Shell', 1), A(3, 'Mounting', 1), A(4, 'Feed Line', 1), A(5, 'Chimney'), A(6, 'Top'), A(7, 'Duct')]);
let id = 0;
const L = (assembly_id, desc, o = {}) => ({ b: { id: ++id, assembly_id, material_description: desc, moc: o.moc || 'MS', size_spec: o.size || null, make: o.make || null, requires_manufacturing: o.mfg ? 1 : 0 }, qty: o.qty ?? 1, unit: o.unit, serials: o.serials, shipsAs: o.shipsAs, packType: o.packType });
const lines = [
  L(2, 'SHELL PLATE', { mfg: 1 }), L(2, 'SHELL RING', { mfg: 1 }), L(2, 'TUBE', { mfg: 1 }),
  L(3, 'GATE VALVE', { size: '25NB', qty: 2, serials: ['A1', 'A2'], make: 'UTAM' }),
  L(4, 'GATE VALVE', { size: '25NB', qty: 1, make: 'UTAM' }),   // same size, merges (qty 3)
  L(4, 'GATE VALVE', { size: '40NB', qty: 1, make: 'UTAM' }),   // other size, sub-row
  L(3, 'PRESSURE GAUGE', { qty: 1, serials: ['G1', 'G2'] }),    // serial count != qty, no serial rows
  L(5, 'TOP HOOD', { mfg: 1 }), L(5, 'CHIMNEY BASE', { mfg: 1 }), L(5, 'CHIMNEY BOLT SET'),
  L(6, 'ASBESTOS ROPE', { qty: 12, unit: 'Mtrs' }),
  L(null, 'LOOSE BOLT', { qty: 4 }),
];
const { rows, main_section } = planCombinedList(lines, { byId, unitLabel: 'SB-1109-1', makeName: 'SHANTI' });
assert.equal(main_section, 'Boiler');
const sNos = rows.filter(r => r.s_no).map(r => r.s_no);
assert.deepEqual(sNos, sNos.map((_, i) => i + 1), 'S.No continuous');
const shell = rows.find(r => r.material_description === 'BOILER SHELL');
assert.equal(shell.kind, 'assembly'); assert.equal(shell.bom_ids.length, 3); assert.equal(shell.make, 'SHANTI');
const valve = rows.find(r => r.material_description === 'GATE VALVE');
assert.equal(valve.qty, 3, 'same size adds up'); assert.equal(valve.bom_ids.length, 2);
const sub = rows.find(r => r.kind === 'sub'); assert.equal(sub.size_spec, '40NB'); assert.equal(sub.parent_index, rows.indexOf(valve));
assert.equal(rows.filter(r => r.kind === 'serial').length, 0, 'merged group gets no serial rows');
assert.ok(!rows.some(r => r.ibr_no === 'G1'), 'serial count must equal qty');
assert.equal(rows.filter(r => r.kind === 'assembly').length, 2, 'boiler shell + chimney');
// assemblies: own loose group each, numbered per type
const labels = rows.filter(r => r.kind === 'assembly').map(r => r.group_label);
assert.deepEqual(labels, ['SB-1109-1-LOOSE-1', 'SB-1109-1-LOOSE-2']);
assert.ok(rows.every(r => r.group_label), 'every row has a group');
// the Chimney root has 2 slots (assembly + bolt set) so it gets its own heading
assert.equal(rows.find(r => r.material_description === 'CHIMNEY').section, 'Chimney');
assert.equal(rows.find(r => r.material_description === 'ASBESTOS ROPE').section, 'Boiler', 'one-line root folds into main');
// serials: qty 2 with 2 serials, single line
const one = planCombinedList([L(3, 'PUMP', { qty: 2, serials: ['P1', 'P2'] })], { byId, unitLabel: 'U' }).rows;
assert.deepEqual(one.map(r => [r.kind, r.ibr_no]), [['item', 'P1'], ['serial', 'P2']]);
// explicit overrides
const forced = planCombinedList([L(2, 'FIRE DOOR', { mfg: 1, shipsAs: 'item' }), L(3, 'PANEL', { shipsAs: 'assembly' })], { byId, unitLabel: 'U' }).rows;
assert.deepEqual(forced.map(r => r.kind), ['item', 'assembly']);
const mounted = planCombinedList([L(2, 'A', { packType: 'mounted' }), L(2, 'B', { packType: 'mounted' })], { byId, unitLabel: 'U' }).rows;
assert.equal(new Set(mounted.map(r => r.group_label)).size, 1); assert.equal(mounted[0].group_label, 'MOUNTED INSIDE THE BOILER');
// a run of direct lines splits when the subsystem changes or after 8 lines
const many = planCombinedList(Array.from({ length: 10 }, (_, i) => L(3, 'PART ' + i)), { byId, unitLabel: 'U' }).rows;
assert.deepEqual([...new Set(many.map(r => r.group_label))], ['U-PACKAGE-1', 'U-PACKAGE-2']);
const two = planCombinedList([L(3, 'X'), L(4, 'Y')], { byId, unitLabel: 'U' }).rows;
assert.equal(new Set(two.map(r => r.group_label)).size, 2, 'subsystem change starts a new group');
// helpers
assert.equal(unitLabelOf({ project_no: 'SB-1109-01', master_project_id: 61, unit_no: 1 }), 'SB-1109-1');
assert.equal(unitLabelOf({ project_no: 'SB-1052' }), 'SB-1052');
assert.equal(modelCodeOf({ project_no: 'SB-1109-01', master_project_id: 61, unit_no: 1, series: 'SF', model_capacity: 50, model_pressure: 10.54 }), 'SB-1109-1-SF-050-10.54');
assert.equal(modelCodeOf({ project_no: 'SB-1109-02', master_project_id: 61, unit_no: 2 }, { series: 'SF', model_capacity: 350, model_pressure: 10.54 }), 'SB-1109-2-SF-350-10.54');
assert.equal(normalizePackType('Box No - 2'), 'package'); assert.equal(normalizePackType('LOOSE 1'), 'loose');
console.log('packing-plan selfcheck ok');
