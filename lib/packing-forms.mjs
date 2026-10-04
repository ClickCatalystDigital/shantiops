import { defaultCompany as appDefaultCompany } from './company-profiles.js';
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
  return projectCompany || appDefaultCompany();
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

// The single definition of "ready to pack" — shared by getProjectBom, getDispatchWork and
// getPendingPackingItems (they used to carry three hand-copied versions). Inputs are plain facts so the
// rule is testable without a database. routingEligible = source 'bom' and no split-order children.
export function isReadyForPacking(b, { reserved = false, pendingInward = false, routedTo = null, routingEligible = true } = {}) {
  const baseReady = b.requires_manufacturing
    ? !!b.production_done
    : (b.purchase_status === 'Received' || b.purchase_status === 'In-Stock' || reserved);
  if (!baseReady || pendingInward) return false;
  if (!routingEligible) return true;
  return routedTo === 'dispatch' || (routedTo === 'production' && !!b.production_done);
}

// ── combined-list helpers ───────────────────────────────────────────────────────────────────────
// Unit label printed on packing labels: a split child 'SB-1109-01' (unit 1) prints 'SB-1109-1'; any
// other project prints its own number.
export function unitLabelOf(project) {
  const no = String(project?.project_no || '');
  if (project?.master_project_id && project.unit_no) return no.replace(/-0*\d+$/, `-${project.unit_no}`);
  return no;
}

// 'SB-1109-1-SF-050-10.54' = unit label + series + capacity (3 digits) + pressure. Fields left blank on a
// split child fall back to the master, so a child still prints the order's model.
export function modelCodeOf(project, master = null) {
  const pick = k => project?.[k] ?? master?.[k] ?? null;
  const cap = pick('model_capacity');
  const parts = [unitLabelOf(project), pick('series'),
    cap != null && cap !== '' ? String(Math.round(Number(cap))).padStart(3, '0') : null,
    pick('model_pressure') != null && pick('model_pressure') !== '' ? String(Number(pick('model_pressure'))) : null];
  return parts.filter(Boolean).join('-');
}

export const PACK_TYPES = ['loose', 'mounted', 'package', 'bag'];
export const PACK_TYPE_LABEL = { loose: 'LOOSE', mounted: 'MOUNTED INSIDE THE BOILER', package: 'PACKAGE', bag: 'BAG' };
// 'Box' in the older data prints as PACKAGE.
export function normalizePackType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('loose')) return 'loose';
  if (s.startsWith('mount')) return 'mounted';
  if (s.startsWith('bag')) return 'bag';
  if (s.startsWith('pack') || s.startsWith('box')) return 'package';
  return null;
}
