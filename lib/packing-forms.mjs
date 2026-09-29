// Packing-list form helpers (pure, no DB) — the client's real packing list is one list per company,
// with one "form" per BOM root: the main root is the Master list, every other root an Annexure.
// Everything here is a default; Dispatch can edit company/section/box on the list itself.

// Root assembly of a node: walk parent_id up. byId = Map<id, {id, parent_id, name}>.
export function rootOf(assemblyId, byId) {
  let n = byId.get(assemblyId);
  let guard = 0;
  while (n && n.parent_id != null && guard++ < 50) n = byId.get(n.parent_id);
  return n || null;
}

// Company is decided by the project (Shanti Boilers / Shanti Techno Fab / Srivaari Agencies), never
// by which BOM root a line sits under.
export function defaultCompany(_rootName, projectCompany) {
  return projectCompany || 'Shanti Boilers';
}

// Sections in PDF order: master first, then the rest by first appearance. Items with no section
// land in "Other". Returns [{ name, kind: 'master'|'annexure', items }].
export function groupForms(items, masterSection) {
  const order = [];
  const map = new Map();
  for (const it of items) {
    const k = it.section || '';
    if (!map.has(k)) { map.set(k, []); order.push(k); }
    map.get(k).push(it);
  }
  const master = order.includes(masterSection) ? masterSection : order[0];
  order.sort((a, b) => (a === master ? -1 : b === master ? 1 : 0));
  return order.map(k => ({ name: k || 'Other', raw: k, kind: k === master ? 'master' : 'annexure', items: map.get(k) }));
}

// Consecutive runs sharing the same box_no ("LOOSE 1", "BOX NO - 2") → separator rows on the sheet.
// Items are sorted by box_no first so a group is never split.
export function boxGroups(items) {
  // Sheet order: LOOSE first, then MOUNTED, then boxes/bags by number.
  const rank = v => (/^\s*loose/i.test(v) ? 0 : /^\s*mounted/i.test(v) ? 1 : 2);
  const sorted = [...items].sort((a, b) => rank(a.box_no || '') - rank(b.box_no || '')
    || String(a.box_no || '').localeCompare(String(b.box_no || ''), undefined, { numeric: true }) || (a.s_no || 0) - (b.s_no || 0));
  const groups = [];
  for (const it of sorted) {
    const k = it.box_no || '';
    if (!groups.length || groups[groups.length - 1].box !== k) groups.push({ box: k, items: [] });
    groups[groups.length - 1].items.push(it);
  }
  return groups;
}
