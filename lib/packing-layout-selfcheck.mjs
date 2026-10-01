import assert from 'node:assert/strict';
import * as L from './packing-layout.mjs';

let id = 0;
const R = (o) => ({ id: ++id, line_kind: 'item', section: 'Boiler', pack_type: 'package', group_label: 'U-PACKAGE-1', material_description: 'X', moc: 'MS', make: 'M', qty: 1, parent_item_id: null, sort_order: id, s_no: null, bom_item_id: null, ...o });
const apply = (rows, d) => {
  let out = rows.filter(r => !d.deletes.includes(r.id)).map(r => { const u = d.updates.find(x => x.id === r.id); return u ? { ...r, ...u.patch } : r; });
  d.inserts.forEach(i => out.push({ id: ++id, parent_item_id: null, ...i.row }));
  const n = L.normalizeRows(out); out = out.map(r => { const u = n.find(x => x.id === r.id); return u ? { ...r, ...u.patch } : r; });
  return out.sort((a, b) => a.sort_order - b.sort_order);
};

// numbering / grouping
assert.equal(L.nextGroupLabel([R({ group_label: 'U-LOOSE-2' }), R({ group_label: 'U-LOOSE-7' })], 'U', 'loose'), 'U-LOOSE-8');
assert.equal(L.nextGroupLabel([], 'U', 'bag'), 'U-BAG-1');
assert.equal(L.nextGroupLabel([], 'U', 'mounted'), 'MOUNTED INSIDE THE BOILER');

// normalize: keeps groups contiguous, numbers items only
let rows = [R({ group_label: 'G1' }), R({ group_label: 'G2' }), R({ group_label: 'G1' })];
let n = L.normalizeRows(rows); rows = rows.map(r => ({ ...r, ...(n.find(u => u.id === r.id)?.patch || {}) })).sort((a, b) => a.sort_order - b.sort_order);
assert.deepEqual(rows.map(r => r.group_label), ['G1', 'G1', 'G2']);
assert.deepEqual(rows.map(r => r.s_no), [1, 2, 3]);

// move into new group, carries children
const parent = R({ group_label: 'G1', material_description: 'VALVE' });
const kid = R({ group_label: 'G1', line_kind: 'sub', parent_item_id: parent.id, material_description: '', s_no: null });
const other = R({ group_label: 'G2', pack_type: 'loose' });
let m = apply([parent, kid, other], L.moveItems([parent, kid, other], { ids: [kid.id], new_group: 'bag', unitLabel: 'U' }));
assert.equal(m.find(r => r.id === parent.id).group_label, 'U-BAG-1'); assert.equal(m.find(r => r.id === kid.id).group_label, 'U-BAG-1');
assert.equal(L.moveItems([other], { ids: [other.id], group_label: 'nope' }).error, 'That group no longer exists');

// group edit: rename, merge, retype renumbers
const g = [R({ group_label: 'A' }), R({ group_label: 'B', pack_type: 'loose' })];
assert.equal(L.editGroup(g, { group_label: 'A', new_label: 'Z' }).label, 'Z');
assert.equal(L.editGroup(g, { group_label: 'A', pack_type: 'bag', unitLabel: 'U' }).label, 'U-BAG-1');

// sizes: same description/moc/make only
const a1 = R({ material_description: 'GASKET' }), a2 = R({ material_description: 'Gasket', size_spec: '25' }), a3 = R({ material_description: 'OTHER' });
assert.ok(L.makeSizes([a1, a2, a3], { ids: [a1.id, a3.id] }).error);
const s = apply([a1, a2], L.makeSizes([a1, a2], { ids: [a1.id, a2.id] }));
assert.equal(s.find(r => r.id === a2.id).line_kind, 'sub'); assert.equal(s.find(r => r.id === a2.id).material_description, '');
assert.equal(s.filter(r => r.s_no).length, 1);
const back = apply(s, L.promoteSize(s, { id: a2.id }));
assert.equal(back.find(r => r.id === a2.id).material_description, 'GASKET'); assert.equal(back.filter(r => r.s_no).length, 2);

// assembly: selected lines collapse into one, links gathered, children removed
const b1 = R({ bom_item_id: 11, moc: 'CS' }), b2 = R({ bom_item_id: 12, moc: 'CS' });
const links = { [b1.id]: [], [b2.id]: [{ bom_item_id: 12, qty: 2 }, { bom_item_id: 13, qty: 1 }] };
const d = L.makeAssembly([b1, b2], { ids: [b1.id, b2.id], name: 'feed line', pieces: 3, makeName: 'SHANTI' }, id => links[id] || []);
assert.deepEqual(d.links.map(l => l.bom_item_id), [11, 12, 13]);
const asm = apply([b1, b2], d);
assert.equal(asm.length, 1); assert.equal(asm[0].material_description, 'FEED LINE'); assert.equal(asm[0].qty, 3); assert.equal(asm[0].moc, 'CS');
assert.ok(L.makeAssembly([b1], { ids: [b1.id], name: ' ' }, () => []).error);
// expand
const exp = L.expandAssembly([{ ...asm[0], id: 900 }], { id: 900 }, () => [{ bom_item_id: 11, qty: 2 }, { bom_item_id: 12, qty: 1 }], x => ({ material_description: 'P' + x, moc: 'MS' }));
assert.equal(exp.inserts.length, 2); assert.deepEqual(exp.deletes, [900]);
assert.ok(L.expandAssembly([R({})], { id: id }, () => [], () => ({})).error);

// reorder swaps neighbours only inside the group
const o1 = R({}), o2 = R({}), o3 = R({ group_label: 'G9' });
let ro = apply([o1, o2, o3], L.reorderItem([o1, o2, o3], { id: o2.id, dir: 'up' }));
assert.equal(ro[0].id, o2.id);
assert.deepEqual(L.reorderItem([o1, o2, o3], { id: o3.id, dir: 'down' }).updates, []);

// checklist
const c = L.deriveChecklist([R({ material_description: 'safety valve' }), R({ material_description: 'Safety  Valve' }), R({ material_description: 'PUMP' })], [{ description: 'VALVE TO FLANGE (MAIN)' }]);
assert.deepEqual(c, ['VALVE TO FLANGE (SAFETY VALVE)']);
console.log('packing-layout selfcheck ok');
