// Pure planner for the combined packing list (no DB). Turns ready BOM lines into ordered rows:
//   item     one directly-received line (a merge of identical lines across subsystems)
//   assembly one line standing for a manufactured subsystem (name + piece count are edited by Dispatch)
//   sub      an extra size of the item above it (same description, no S.No of its own)
//   serial   an extra IBR number row under an item (one row per piece)
// Everything here is a suggestion; Dispatch edits the list afterwards.
import { PACK_TYPE_LABEL } from './packing-forms.mjs';

const MAX_PER_GROUP = 8;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });

function chainOf(id, byId) {
  const out = [];
  let n = byId.get(id), g = 0;
  while (n && g++ < 50) { out.unshift(n); n = n.parent_id != null ? byId.get(n.parent_id) : null; }
  return out;
}

function mostCommon(vals) {
  const c = new Map();
  for (const v of vals) if (v) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// lines: [{ b, qty, unit, serials?, shipsAs?, packType?, configText? }]  (b needs id, assembly_id,
// material_description, moc, size_spec, make, requires_manufacturing)
// opts: { byId: Map<id,{id,parent_id,name,sort_order}>, unitLabel, makeName }
export function planCombinedList(lines, { byId, unitLabel = '', makeName = 'SHANTI', configByNode = new Map() }) {
  const slots = []; // in first-seen order
  const direct = new Map(); // merge key -> slot
  const asm = new Map(); // subsystem node id -> slot

  for (const l of lines) {
    const chain = l.b.assembly_id ? chainOf(l.b.assembly_id, byId) : [];
    const root = chain[0] || null;
    const isAsm = l.shipsAs === 'assembly' || (l.shipsAs !== 'item' && l.b.requires_manufacturing && chain.length);
    if (isAsm) {
      const node = chain[1] || chain[0];
      let s = asm.get(node.id);
      if (!s) { s = { kind: 'assembly', root, node, lines: [] }; asm.set(node.id, s); slots.push(s); }
      s.lines.push(l);
      continue;
    }
    const key = [norm(l.b.material_description), norm(l.b.moc), norm(l.b.make), root?.id || 0, l.packType || ''].join('|');
    let s = direct.get(key);
    if (!s) { s = { kind: 'item', root, subsystem: (chain[1] || chain[0])?.id || 0, lines: [] }; direct.set(key, s); slots.push(s); }
    s.lines.push(l);
  }

  // Sections: the root with the most slots is the main one; a smaller root gets its own heading only
  // when it has 2+ lines, otherwise it sits in the main section.
  const rootSlots = new Map();
  for (const s of slots) { const k = s.root?.id || 0; rootSlots.set(k, (rootSlots.get(k) || 0) + 1); }
  const mainId = [...rootSlots.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  const mainName = mainId ? byId.get(mainId).name : null;
  for (const s of slots) {
    const k = s.root?.id || 0;
    s.section = k && k !== mainId && rootSlots.get(k) >= 2 ? s.root.name : mainName;
  }
  const sectionOrder = [];
  for (const s of slots) if (!sectionOrder.includes(s.section)) sectionOrder.push(s.section);
  sectionOrder.sort((a, b) => (a === mainName ? -1 : b === mainName ? 1 : 0));
  slots.sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section)); // stable

  // Pack groups: an assembly is its own loose group; direct lines in a run share one group of their type.
  const counters = {};
  let prev = null;
  const groupOf = (s, type) => {
    // A run of direct lines shares one group, but a new group starts when the subsystem changes or the
    // run reaches MAX_PER_GROUP lines (a suggestion — Dispatch merges and splits groups on the list).
    const joinable = s.kind === 'item' && prev && prev.kind === 'item' && prev.packType === type && prev.section === s.section
      && prev.subsystem === s.subsystem && prev.runLen < MAX_PER_GROUP;
    if (joinable) { s.runLen = prev.runLen + 1; return prev.group; }
    s.runLen = 1;
    if (type === 'mounted') return { type, label: PACK_TYPE_LABEL.mounted };
    counters[type] = (counters[type] || 0) + 1;
    return { type, label: `${unitLabel ? unitLabel + '-' : ''}${PACK_TYPE_LABEL[type]}-${counters[type]}` };
  };
  for (const s of slots) {
    s.packType = s.kind === 'assembly' ? 'loose' : (s.lines[0].packType || 'package');
    s.group = groupOf(s, s.packType);
    prev = s;
  }

  // Rows
  const rows = [];
  let sNo = 0, order = 0;
  const push = r => rows.push({ ...r, sort_order: ++order });
  for (const s of slots) {
    const base = { section: s.section, pack_type: s.packType, group_label: s.group.label };
    if (s.kind === 'assembly') {
      sNo++;
      push({ ...base, kind: 'assembly', s_no: sNo, material_description: String(s.node.name).toUpperCase(),
        moc: mostCommon(s.lines.map(l => l.b.moc)), size_spec: configByNode.get(s.node.id) || 'AS PER DRAWING',
        qty: 1, unit: "No's", make: makeName, bom_ids: s.lines.map(l => ({ id: l.b.id, qty: l.qty })) });
      continue;
    }
    // Direct slot: identical description+moc+make. Same size adds up; a different size becomes a sub-row.
    const bySize = new Map();
    for (const l of s.lines) {
      const k = norm(l.b.size_spec);
      if (!bySize.has(k)) bySize.set(k, []);
      bySize.get(k).push(l);
    }
    const sizes = [...bySize.values()].sort((a, b) => num(a[0].b.size_spec, b[0].b.size_spec));
    sNo++;
    let itemIdx = null;
    sizes.forEach((group, i) => {
      const myIdx = rows.length;
      if (i === 0) itemIdx = myIdx;
      const first = group[0];
      const qty = group.reduce((t, l) => t + (Number(l.qty) || 0), 0);
      const serials = group.length === 1 ? (first.serials || []) : [];
      const useSerials = serials.length > 0 && serials.length === Math.round(qty);
      push({ ...base, kind: i === 0 ? 'item' : 'sub', s_no: i === 0 ? sNo : null,
        material_description: i === 0 ? first.b.material_description : '', moc: i === 0 ? first.b.moc || null : null,
        size_spec: first.b.size_spec || null, ibr_no: useSerials ? serials[0] : null, qty, unit: first.unit || "No's",
        make: i === 0 ? first.b.make || null : null, bom_ids: group.map(l => ({ id: l.b.id, qty: l.qty })),
        parent_index: i === 0 ? null : itemIdx });
      if (useSerials) for (const sn of serials.slice(1)) push({ ...base, kind: 'serial', ibr_no: sn, bom_ids: [], parent_index: myIdx });
    });
  }
  return { rows, main_section: mainName };
}
