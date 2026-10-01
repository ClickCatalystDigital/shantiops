// Pure editing rules for a combined packing list (no DB). Every function takes the list's rows (plain objects
// from packing_items) and returns a diff — { updates:[{id,patch}], inserts:[{temp,row,links}], deletes:[id] } —
// that the route applies in one transaction, then calls normalizeRows() to restore contiguous groups and S.No.
import { PACK_TYPE_LABEL, normalizePackType } from './packing-forms.mjs';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isTop = r => r.parent_item_id == null;
const numbered = r => isTop(r) && ['item', 'assembly', 'manual'].includes(r.line_kind || 'item');

export function nextGroupLabel(rows, unitLabel, type) {
  if (type === 'mounted') return PACK_TYPE_LABEL.mounted;
  const word = PACK_TYPE_LABEL[type];
  const re = new RegExp(`${esc(word)}\\s*-?\\s*(\\d+)\\b`, 'i');
  let max = 0;
  for (const r of rows) { const m = String(r.group_label || '').match(re); if (m) max = Math.max(max, Number(m[1])); }
  return `${unitLabel ? unitLabel + '-' : ''}${word}-${max + 1}`;
}

function childrenMap(rows) {
  const m = new Map();
  for (const r of rows) if (r.parent_item_id != null) { if (!m.has(r.parent_item_id)) m.set(r.parent_item_id, []); m.get(r.parent_item_id).push(r); }
  return m;
}
// Ids given may be sub/serial rows; always work on their top-level row.
function topIds(rows, ids) {
  const byId = new Map(rows.map(r => [r.id, r]));
  return [...new Set(ids.map(id => byId.get(id)).filter(Boolean).map(r => r.parent_item_id ?? r.id))];
}
const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;

// Order rows: sections (main first), groups in first-appearance order, rows by sort_order; sub/serial rows stay
// under their parent. Returns the updates that make sort_order / s_no match.
export function normalizeRows(rows, masterSection = null) {
  const kids = childrenMap(rows);
  const tops = rows.filter(isTop).sort(bySort);
  const sections = [];
  for (const r of tops) if (!sections.includes(r.section || null)) sections.push(r.section || null);
  sections.sort((a, b) => (a === masterSection && masterSection ? -1 : b === masterSection && masterSection ? 1 : 0));
  const ordered = [];
  for (const sec of sections) {
    const inSec = tops.filter(r => (r.section || null) === sec);
    const labels = [];
    for (const r of inSec) if (!labels.includes(r.group_label || null)) labels.push(r.group_label || null);
    for (const lab of labels) for (const r of inSec.filter(x => (x.group_label || null) === lab)) ordered.push(r, ...(kids.get(r.id) || []).sort(bySort));
  }
  const updates = [];
  let order = 0, sNo = 0;
  for (const r of ordered) {
    const patch = { sort_order: ++order };
    patch.s_no = numbered(r) ? ++sNo : null;
    if (r.sort_order !== patch.sort_order || (r.s_no ?? null) !== patch.s_no) updates.push({ id: r.id, patch });
  }
  return updates;
}

const fail = error => ({ error });

// Move whole items (with their size/serial rows) into an existing group or a new one.
export function moveItems(rows, { ids, group_label, new_group, unitLabel }) {
  const tops = topIds(rows, ids);
  if (!tops.length) return fail('Pick at least one line');
  let label, type, section;
  if (group_label) {
    const sample = rows.find(r => r.group_label === group_label);
    if (!sample) return fail('That group no longer exists');
    ({ pack_type: type, section } = sample); label = group_label;
  } else {
    type = normalizePackType(new_group);
    if (!type) return fail('Choose LOOSE, MOUNTED, PACKAGE or BAG');
    label = nextGroupLabel(rows, unitLabel, type);
    section = rows.find(r => tops.includes(r.id))?.section ?? null;
  }
  const kids = childrenMap(rows);
  const maxOrder = Math.max(0, ...rows.filter(r => r.group_label === label).map(r => r.sort_order ?? 0));
  const updates = [];
  tops.forEach((id, i) => {
    const patch = { group_label: label, box_no: label, pack_type: type, section, sort_order: maxOrder + 1 + i * 0.01 };
    updates.push({ id, patch });
    for (const k of kids.get(id) || []) updates.push({ id: k.id, patch: { group_label: label, box_no: label, pack_type: type, section, sort_order: patch.sort_order + 0.001 } });
  });
  return { updates, inserts: [], deletes: [], label };
}

// Rename a group, merge it into another label, or retype it (a retype without a new label renumbers it).
export function editGroup(rows, { group_label, new_label, pack_type, unitLabel }) {
  const members = rows.filter(r => r.group_label === group_label);
  if (!members.length) return fail('That group no longer exists');
  let type = pack_type ? normalizePackType(pack_type) : members[0].pack_type;
  if (pack_type && !type) return fail('Choose LOOSE, MOUNTED, PACKAGE or BAG');
  let label = String(new_label || '').trim();
  if (!label) label = type !== members[0].pack_type ? nextGroupLabel(rows, unitLabel, type) : group_label;
  return { updates: members.map(r => ({ id: r.id, patch: { group_label: label, box_no: label, pack_type: type } })), inserts: [], deletes: [], label };
}

// Show several same-named lines as sizes of one item (first becomes the item, the rest its size rows).
export function makeSizes(rows, { ids, parent_id }) {
  const tops = topIds(rows, ids);
  const parent = rows.find(r => r.id === (parent_id ?? tops[0]));
  if (!parent || parent.parent_item_id != null) return fail('Pick the line the sizes belong to');
  const kids = childrenMap(rows);
  const moving = tops.filter(id => id !== parent.id).map(id => rows.find(r => r.id === id));
  if (!moving.length) return fail('Pick at least two lines');
  for (const r of moving) {
    if (r.line_kind === 'assembly' || (kids.get(r.id) || []).some(k => k.line_kind === 'sub')) return fail('Lines that already have sizes or are assemblies cannot be combined');
    if (norm(r.material_description) !== norm(parent.material_description) || norm(r.moc) !== norm(parent.moc) || norm(r.make) !== norm(parent.make))
      return fail('Only lines with the same description, material and make can be shown as sizes of one item');
  }
  return { updates: moving.flatMap(r => [
    { id: r.id, patch: { line_kind: 'sub', parent_item_id: parent.id, material_description: '', moc: null, make: null, s_no: null, group_label: parent.group_label, box_no: parent.group_label, pack_type: parent.pack_type, section: parent.section, sort_order: (parent.sort_order ?? 0) + 0.5 } },
    ...(kids.get(r.id) || []).map(k => ({ id: k.id, patch: { parent_item_id: parent.id, group_label: parent.group_label, box_no: parent.group_label, pack_type: parent.pack_type, section: parent.section } })),
  ]), inserts: [], deletes: [] };
}

// A size row becomes an item of its own again.
export function promoteSize(rows, { id }) {
  const r = rows.find(x => x.id === id);
  if (!r || r.line_kind !== 'sub') return fail('That line is not a size row');
  const p = rows.find(x => x.id === r.parent_item_id);
  return { updates: [{ id, patch: { line_kind: 'item', parent_item_id: null, material_description: p?.material_description || '', moc: p?.moc || null, make: p?.make || null } }], inserts: [], deletes: [] };
}

// Selected lines become ONE assembly line (name + piece count typed by Dispatch). linksOf(id) -> [{bom_item_id, qty}].
export function makeAssembly(rows, { ids, name, pieces, size_spec, makeName }, linksOf) {
  const tops = topIds(rows, ids).map(id => rows.find(r => r.id === id)).sort(bySort);
  if (!tops.length) return fail('Pick at least one line');
  if (!String(name || '').trim()) return fail('Name the assembly');
  const qty = Number(pieces ?? 1);
  if (!(qty > 0)) return fail('Pieces must be more than zero');
  const kids = childrenMap(rows);
  const first = tops[0];
  const seen = new Set();
  const links = [];
  const claim = (bom_item_id, q) => { if (bom_item_id != null && !seen.has(bom_item_id)) { seen.add(bom_item_id); links.push({ bom_item_id, qty: q ?? null }); } };
  for (const t of tops) for (const x of [t, ...(kids.get(t.id) || [])]) {
    const l = linksOf(x.id);
    if (l.length) l.forEach(k => claim(k.bom_item_id, k.qty)); else claim(x.bom_item_id, x.qty);
  }
  const mocs = tops.map(t => t.moc).filter(Boolean);
  const moc = mocs.sort((a, b) => mocs.filter(v => v === b).length - mocs.filter(v => v === a).length)[0] || null;
  return {
    updates: [],
    inserts: [{ temp: 'asm', row: {
      line_kind: 'assembly', section: first.section, pack_type: first.pack_type, group_label: first.group_label, box_no: first.group_label,
      material_description: String(name).trim().toUpperCase(), moc, size_spec: String(size_spec || '').trim() || 'AS PER DRAWING',
      qty, unit: "No's", make: makeName || null, sort_order: first.sort_order ?? 0, bom_item_id: links[0]?.bom_item_id ?? null }, links }],
    deletes: tops.flatMap(t => [t.id, ...(kids.get(t.id) || []).map(k => k.id)]), links,
  };
}

// An assembly line is replaced by one item line per BOM line it covers. bomOf(bom_item_id) -> bom row.
export function expandAssembly(rows, { id }, linksOf, bomOf) {
  const a = rows.find(r => r.id === id);
  if (!a || a.line_kind !== 'assembly') return fail('That line is not an assembly');
  const links = linksOf(id);
  if (!links.length) return fail('This assembly is not linked to any BOM line, so it cannot be expanded');
  const inserts = links.map((l, i) => {
    const b = bomOf(l.bom_item_id) || {};
    return { temp: `x${i}`, row: {
      line_kind: 'item', section: a.section, pack_type: a.pack_type, group_label: a.group_label, box_no: a.group_label,
      material_description: b.material_description || '', moc: b.moc || null, size_spec: b.size_spec || null, make: b.make || null,
      qty: l.qty ?? 1, unit: "No's", sort_order: (a.sort_order ?? 0) + i * 0.01, bom_item_id: l.bom_item_id }, links: [l] };
  });
  return { updates: [], inserts, deletes: [id] };
}

// Swap a whole item (with its sub rows) with its neighbour inside the same group.
export function reorderItem(rows, { id, dir }) {
  const [topId] = topIds(rows, [id]);
  const me = rows.find(r => r.id === topId);
  if (!me) return fail('Line not found');
  const peers = rows.filter(r => isTop(r) && (r.group_label || null) === (me.group_label || null) && (r.section || null) === (me.section || null)).sort(bySort);
  const i = peers.findIndex(r => r.id === me.id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= peers.length) return { updates: [], inserts: [], deletes: [] };
  const other = peers[j];
  const kids = childrenMap(rows);
  const swap = (r, o) => [{ id: r.id, patch: { sort_order: o.sort_order } },
    ...(kids.get(r.id) || []).map(k => ({ id: k.id, patch: { sort_order: o.sort_order + 0.001 } }))];
  return { updates: [...swap(me, other), ...swap(other, me)], inserts: [], deletes: [] };
}

// Valve-to-flange checklist rows for the valves on the list, skipping ones already present.
export function deriveChecklist(rows, existing = []) {
  const have = new Set(existing.map(e => norm(e.description)));
  const out = [];
  for (const r of rows) {
    if (!isTop(r) || !/valve/i.test(r.material_description || '')) continue;
    const d = `VALVE TO FLANGE (${String(r.material_description).replace(/\s+/g, ' ').trim().toUpperCase()})`;
    if (!have.has(norm(d))) { have.add(norm(d)); out.push(d); }
  }
  return out;
}
