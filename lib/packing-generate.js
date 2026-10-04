// Shared by POST /api/packing/from-bom and /api/packing/batch-children: turn ready BOM lines into
// draft packing lists — one list per company, each line tagged with its form (BOM root name) so the
// PDF can print Master/Annexure sections. Unassigned lines have no root → section left blank ("Other").
import { execute, queryAll, queryOne, nextNumber, withTransaction } from '@/lib/db';
import { rootOf, defaultCompany, unitLabelOf, normalizePackType } from '@/lib/packing-forms.mjs';
import { planCombinedList } from '@/lib/packing-plan.mjs';
import { parseConfig } from '@/lib/bom-config.mjs';
import { learnedChoices } from '@/lib/packing-memory';
import { maybeStartMilestone } from '@/lib/milestone-auto';
import { normalizeList } from '@/lib/packing-layout';
import { getProjectBom, getAssemblyRollupMap, getChildRoutingBoard } from '@/lib/data';
import { itemRollupQty } from '@/lib/bom-structure.mjs';
import { audit } from '@/lib/usb';

// lines: [{ b: bom_items row (needs assembly_id, material_description, moc, size_spec, make),
//           qty, unit? }]. treeProjectId: project whose bom_assemblies hold the tree (the master for
// split children). Returns [{ id, packing_no, company, items }].
export async function createPackingLists({ project, treeProjectId, customerName, lines, user, revision = null, layout = 'sections', company: companyOverride = null }) {
  if (layout === 'combined') return createCombinedPackingList({ project, treeProjectId, customerName, lines, user, revision, companyOverride });
  const asm = await queryAll('SELECT id, name, parent_id FROM bom_assemblies WHERE project_id = ?', [treeProjectId]);
  const byId = new Map(asm.map(a => [a.id, a]));
  const byCompany = new Map();
  for (const l of lines) {
    const root = l.b.assembly_id ? rootOf(l.b.assembly_id, byId) : null;
    const company = companyOverride || defaultCompany(root?.name, project.company);
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push({ ...l, section: root?.name || null });
  }
  const created = [];
  for (const [company, rows] of byCompany) {
    const packing_no = await nextNumber('packing_no', 'PL');
    // Master = the section with the most lines (the boiler itself), editable later on the list.
    const counts = {};
    for (const r of rows) counts[r.section || ''] = (counts[r.section || ''] || 0) + 1;
    const master = Object.entries(counts).filter(([k]) => k).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const pl = await execute(
      `INSERT INTO packing_lists (project_id, packing_no, customer_name, created_by, company, master_section, bom_release_revision_at_creation)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [project.id, packing_no, customerName, user?.username || null, company, master, revision]);
    const listId = Number(pl.lastId);
    const sNo = {};
    for (const r of rows) {
      const k = r.section || '';
      sNo[k] = (sNo[k] || 0) + 1; // S.No restarts per form, like the client's sheets
      await execute(
        `INSERT INTO packing_items (packing_list_id, bom_item_id, s_no, section, material_description, moc, size_spec, make, qty, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [listId, r.b.id, sNo[k], r.section, r.b.material_description, r.b.moc || null, r.b.size_spec || null, r.b.make || null, r.qty, r.unit || "No's"]);
    }
    created.push({ id: listId, packing_no, company, items: rows.length });
  }
  try { await maybeStartMilestone(project.id, 'packing', user?.username); } catch { /* best-effort */ }
  return created;
}

// Combined layout: one list per company, continuous S.No, section headings, assembly lines and pack groups
// (see lib/packing-plan.mjs). Everything is a suggestion — Dispatch edits the draft afterwards.
// Everything that decides the combined layout for a set of BOM lines (no writes): the planned rows,
// the main section, and the company. Shared by new lists and by converting an old-layout list.
async function buildCombinedPlan({ project, treeProjectId, lines, companyOverride }) {
  const asm = await queryAll('SELECT id, name, parent_id, sort_order, config_json FROM bom_assemblies WHERE project_id = ? ORDER BY sort_order, id', [treeProjectId]);
  const byId = new Map(asm.map(a => [a.id, a]));
  const ids = lines.map(l => l.b.id);
  const inl = ids.map(() => '?').join(',');
  const [receipts, catalog] = ids.length ? await Promise.all([
    queryAll(`SELECT bom_item_id, received_serial_no FROM bom_item_receipts WHERE received_serial_no IS NOT NULL AND bom_item_id IN (${inl}) ORDER BY id`, ids),
    queryAll(`SELECT b.id, b.item_id, i.ships_as, i.default_pack_type FROM bom_items b JOIN items i ON i.id = b.item_id WHERE b.id IN (${inl})`, ids),
  ]) : [[], []];
  const serials = new Map();
  for (const r of receipts) {
    const list = String(r.received_serial_no).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
    serials.set(r.bom_item_id, [...(serials.get(r.bom_item_id) || []), ...list]);
  }
  const cat = new Map(catalog.map(c => [c.id, c]));
  const learned = await learnedChoices([...new Set(catalog.map(c => c.item_id))]);
  const configByNode = new Map();
  for (const a of asm) {
    const text = parseConfig(a.config_json).slice(0, 3).map(e => `${e.label}: ${e.value}${e.unit ? ' ' + e.unit : ''}`).join('; ');
    if (text) configByNode.set(a.id, text);
  }
  const enriched = lines.map(l => ({ ...l, serials: serials.get(l.b.id), shipsAs: cat.get(l.b.id)?.ships_as || learned.get(cat.get(l.b.id)?.item_id)?.ships_as || null,
    packType: normalizePackType(cat.get(l.b.id)?.default_pack_type || learned.get(cat.get(l.b.id)?.item_id)?.pack_type) }));
  const company = companyOverride || defaultCompany(null, project.company);
  const makeName = String(company).split(/\s+/)[0].toUpperCase();
  const { rows, main_section } = planCombinedList(enriched, { byId, unitLabel: unitLabelOf(project), makeName, configByNode });
  return { rows, main_section, company };
}

// Writes planned rows into a list, parents before children so parent_item_id can point at them.
async function insertCombinedRows(tx, listId, rows) {
  const idAt = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const res = await tx.execute({
      sql: `INSERT INTO packing_items (packing_list_id, bom_item_id, s_no, section, material_description, moc, size_spec, ibr_no, make, qty, unit,
              box_no, pack_type, group_label, line_kind, sort_order, parent_item_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [listId, r.bom_ids[0]?.id ?? null, r.s_no ?? null, r.section || null, r.material_description || '', r.moc || null, r.size_spec || null,
        r.ibr_no || null, r.make || null, r.qty ?? 0, r.unit || null, r.group_label || null, r.pack_type || null, r.group_label || null,
        r.kind, r.sort_order, r.parent_index != null ? idAt[r.parent_index] : null] });
    idAt[i] = Number(res.lastInsertRowid);
    for (const bi of r.bom_ids) {
      await tx.execute({ sql: 'INSERT OR IGNORE INTO packing_item_bom_items (packing_item_id, bom_item_id, qty) VALUES (?, ?, ?)', args: [idAt[i], bi.id, bi.qty ?? null] });
    }
  }
  return idAt;
}

async function createCombinedPackingList({ project: p0, treeProjectId, customerName, lines, user, revision, companyOverride = null }) {
  const project = (await queryOne('SELECT * FROM projects WHERE id = ?', [p0.id])) || p0;
  const { rows, main_section, company } = await buildCombinedPlan({ project, treeProjectId, lines, companyOverride });
  const packing_no = await nextNumber('packing_no', 'PL');
  const listId = await withTransaction(async tx => {
    const pl = await tx.execute({
      sql: `INSERT INTO packing_lists (project_id, packing_no, customer_name, created_by, company, master_section, bom_release_revision_at_creation, layout)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'combined')`,
      args: [project.id, packing_no, customerName, user?.username || null, company, main_section, revision] });
    const listId = Number(pl.lastInsertRowid);
    await insertCombinedRows(tx, listId, rows);
    return listId;
  });
  try { await maybeStartMilestone(project.id, 'packing', user?.username); } catch { /* best-effort */ }
  return [{ id: listId, packing_no, company, items: rows.filter(r => r.kind === 'item' || r.kind === 'assembly').length }];
}

// Add newly ready BOM lines to an existing draft (combined layout) instead of starting a second list.
// The new lines are planned the same way a fresh list is, placed after the current lines, then S.No
// is renumbered. ponytail: a new group can share a label with an existing one ("PACKAGE 1"); Dispatch
// moves lines on the draft if that's wrong.
export async function appendLinesToList(listId, { project, treeProjectId, lines }) {
  const list = await queryOne('SELECT * FROM packing_lists WHERE id = ?', [listId]);
  const { rows } = await buildCombinedPlan({ project, treeProjectId, lines, companyOverride: list.company });
  const max = await queryOne('SELECT COALESCE(MAX(sort_order), 0) AS m FROM packing_items WHERE packing_list_id = ?', [listId]);
  // A subsystem handed over in several goes must stay ONE assembly line: new assembly lines (with no
  // sub-lines) whose name matches an assembly already on the list just get their BOM lines attached to it.
  const existing = await queryAll(
    "SELECT id, section, material_description FROM packing_items WHERE packing_list_id = ? AND line_kind = 'assembly'", [listId]);
  const norm = x => String(x || '').trim().toLowerCase();
  const hasChild = new Set(rows.map(r => r.parent_index).filter(i => i != null));
  const merges = []; // [existing packing item id, bom_ids]
  const keep = []; const remap = new Map();
  rows.forEach((r, i) => {
    const hit = r.kind === 'assembly' && !hasChild.has(i)
      ? existing.find(e => norm(e.material_description) === norm(r.material_description) && norm(e.section) === norm(r.section)) : null;
    if (hit) { merges.push([hit.id, r.bom_ids]); return; }
    remap.set(i, keep.length); keep.push(r);
  });
  const shifted = keep.map(r => ({ ...r, parent_index: r.parent_index != null ? remap.get(r.parent_index) : r.parent_index, sort_order: (r.sort_order ?? 0) + Number(max.m) + 1 }));
  await withTransaction(async tx => {
    for (const [pid, bomIds] of merges) {
      for (const bi of bomIds) {
        await tx.execute({ sql: 'INSERT OR IGNORE INTO packing_item_bom_items (packing_item_id, bom_item_id, qty) VALUES (?, ?, ?)', args: [pid, bi.id, bi.qty ?? null] });
      }
    }
    await insertCombinedRows(tx, listId, shifted);
    await normalizeList(tx, listId, list.master_section);
  });
  return { id: listId, packing_no: list.packing_no, items: rows.filter(r => r.kind === 'item' || r.kind === 'assembly').length };
}

// Turn an old-layout ("sections": one table per BOM section) list into the combined layout (continuous
// S.No, packing groups such as LOOSE / PACKAGE / MOUNTED, assemblies). The list keeps its number and
// every header field (invoice, freight, e-way bill, vehicle...). Lines tied to a BOM item are re-planned;
// IBR no. and item code typed on them carry over; lines typed in by hand are kept as their own lines at
// the end. Draft and ready lists only — a dispatched list is a finished record.
export async function convertListToCombined(listId, user) {
  const pl = await queryOne('SELECT * FROM packing_lists WHERE id = ?', [listId]);
  if (!pl) throw Object.assign(new Error('Not found'), { status: 404 });
  if (pl.layout === 'combined') throw Object.assign(new Error('This list already uses the new layout'), { status: 409 });
  if (pl.status === 'dispatched') throw Object.assign(new Error('A dispatched list cannot be changed'), { status: 409 });
  const items = await queryAll('SELECT * FROM packing_items WHERE packing_list_id = ? ORDER BY s_no, id', [listId]);
  const linked = items.filter(i => i.bom_item_id);
  const manual = items.filter(i => !i.bom_item_id);
  const bomRows = linked.length
    ? await queryAll(`SELECT * FROM bom_items WHERE id IN (${linked.map(() => '?').join(',')})`, linked.map(i => i.bom_item_id))
    : [];
  const bomById = new Map(bomRows.map(b => [b.id, b]));
  const lines = linked.filter(i => bomById.has(i.bom_item_id)).map(i => ({ b: bomById.get(i.bom_item_id), qty: i.qty, unit: i.unit }));
  const orphan = linked.filter(i => !bomById.has(i.bom_item_id));
  const project = pl.project_id ? await queryOne('SELECT * FROM projects WHERE id = ?', [pl.project_id]) : null;
  let plan = { rows: [], main_section: pl.master_section };
  if (lines.length) {
    if (!project) throw Object.assign(new Error('This list has no project, so its lines cannot be re-grouped'), { status: 400 });
    // A split unit's BOM (and its assembly tree) lives on the master project: use the lines' own project.
    plan = await buildCombinedPlan({ project, treeProjectId: lines[0].b.project_id, lines, companyOverride: pl.company });
  }
  const carry = new Map(linked.map(i => [i.bom_item_id, i]));
  for (const r of plan.rows) {
    if (r.bom_ids.length === 1) {
      const old = carry.get(r.bom_ids[0].id);
      if (old) { r.ibr_no = r.ibr_no || old.ibr_no; r.item_code = old.item_code; }
    }
  }
  await withTransaction(async tx => {
    await tx.execute({ sql: 'DELETE FROM packing_items WHERE packing_list_id = ?', args: [listId] });
    const idAt = await insertCombinedRows(tx, listId, plan.rows);
    for (let i = 0; i < plan.rows.length; i++) {
      if (plan.rows[i].item_code) await tx.execute({ sql: 'UPDATE packing_items SET item_code = ? WHERE id = ?', args: [plan.rows[i].item_code, idAt[i]] });
    }
    let order = Math.max(0, ...plan.rows.map(r => r.sort_order ?? 0));
    for (const m of [...manual, ...orphan]) {
      order += 1;
      await tx.execute({
        sql: `INSERT INTO packing_items (packing_list_id, bom_item_id, section, material_description, moc, size_spec, ibr_no, item_code, make, qty, unit,
                box_no, pack_type, group_label, line_kind, sort_order)
              VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'OTHER ITEMS', 'package', 'OTHER ITEMS', 'manual', ?)`,
        args: [listId, m.material_description, m.moc, m.size_spec, m.ibr_no, m.item_code, m.make, m.qty, m.unit, order] });
    }
    await normalizeList(tx, listId, plan.main_section);
    await tx.execute({ sql: "UPDATE packing_lists SET layout = 'combined', master_section = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", args: [plan.main_section, listId] });
  });
  return { id: listId, items: plan.rows.length + manual.length + orphan.length };
}

// Handover -> packing list (Shop Floor > Dispatch). Items Production has just handed over go onto the
// project's open draft packing list (combined layout), or a new draft is started when none is open.
// Only lines that are really ready to pack and not already on a list of that project are placed; the
// rest are reported back. `unitOf` set = a split-order unit: its own project's list, per-unit quantity.
// Best-effort by the caller: a failure here must never undo the handover itself.
export async function autoPackHandedOver({ projectId, bomItemIds, user, unit = null, reopenListId = null }) {
  const ids = new Set(bomItemIds.map(Number));
  const listProjectId = unit ? unit.childId : projectId;
  const project = await queryOne('SELECT * FROM projects WHERE id = ?', [listProjectId]);
  const master = unit ? await queryOne('SELECT id, customer_name, bom_release_revision FROM projects WHERE id = ?', [projectId]) : project;
  let candidates; // [{ b, qty }]
  if (unit) {
    const board = await getChildRoutingBoard(projectId);
    const cells = board.cells.filter(c => c.child_project_id === unit.childId && ids.has(c.bom_item_id) && c.ready
      && (c.routed_to === 'dispatch' || (c.routed_to === 'production' && c.handed_over >= c.per_unit_required)));
    const rows = cells.length ? await queryAll(
      `SELECT id, assembly_id, material_description, moc, size_spec, make FROM bom_items WHERE id IN (${cells.map(() => '?').join(',')})`,
      cells.map(c => c.bom_item_id)) : [];
    const byId = new Map(rows.map(r => [r.id, r]));
    candidates = cells.filter(c => byId.has(c.bom_item_id)).map(c => ({ b: byId.get(c.bom_item_id), qty: c.per_unit_required }));
  } else {
    const { readyForPacking } = await getProjectBom(projectId);
    const rollupById = await getAssemblyRollupMap(projectId);
    candidates = readyForPacking.filter(b => ids.has(b.id))
      .map(b => ({ b, qty: itemRollupQty(b.qty_text, b.assembly_id, rollupById, project.unit_count, !!b.qty_resolved) ?? 1 }));
  }
  const onLists = await queryAll(
    `SELECT DISTINCT pi.bom_item_id FROM packing_bom_links pi JOIN packing_lists pl ON pl.id = pi.packing_list_id
      WHERE pl.project_id = ? AND pi.bom_item_id IS NOT NULL`, [listProjectId]);
  const placed = new Set(onLists.map(r => r.bom_item_id));
  const lines = candidates.filter(l => !placed.has(l.b.id));
  const skipped = ids.size - lines.length;
  if (!lines.length) return { packing_no: null, added: 0, skipped };
  // Production chose to add to a list that was already packed: pull it back to draft first.
  if (reopenListId) await reopenListToDraft(reopenListId, listProjectId, user);
  const reopened = !!reopenListId;
  const draft = await queryOne(
    `SELECT id FROM packing_lists WHERE project_id = ? AND status = 'draft' AND layout = 'combined' ORDER BY id DESC LIMIT 1`, [listProjectId]);
  if (draft) {
    const r = await appendLinesToList(draft.id, { project, treeProjectId: projectId, lines });
    return { packing_no: r.packing_no, list_id: r.id, added: lines.length, skipped, created: false, reopened };
  }
  const made = await createPackingLists({
    project, treeProjectId: projectId, customerName: master.customer_name, lines, user,
    revision: unit ? (master.bom_release_revision ?? null) : null, layout: 'combined',
  });
  return { packing_no: made.map(m => m.packing_no).join(', '), list_id: made[0].id, added: lines.length, skipped, created: true };
}

// Undo of a handover: take a BOM line back off the project's DRAFT packing lists. Returns { blocked: true }
// (nothing changed) if any list carrying it has moved past draft. A packing line left with no BOM lines is
// deleted; an assembly that still carries others stays. S.No is renumbered.
export async function removeBomItemFromDraftLists(bomItemId, listProjectId) {
  const lists = await queryAll(
    `SELECT DISTINCT pl.id, pl.status, pl.master_section, pl.layout FROM packing_bom_links pb
       JOIN packing_lists pl ON pl.id = pb.packing_list_id
      WHERE pb.bom_item_id = ? AND pl.project_id = ?`, [bomItemId, listProjectId]);
  if (lists.some(l => l.status !== 'draft')) return { blocked: true };
  await withTransaction(async tx => {
    for (const l of lists) {
      const rows = (await tx.execute({
        sql: `SELECT pi.id, pi.bom_item_id FROM packing_items pi
               WHERE pi.packing_list_id = ? AND (pi.bom_item_id = ? OR pi.id IN
                     (SELECT packing_item_id FROM packing_item_bom_items WHERE bom_item_id = ?))`,
        args: [l.id, bomItemId, bomItemId] })).rows;
      for (const r of rows) {
        await tx.execute({ sql: 'DELETE FROM packing_item_bom_items WHERE packing_item_id = ? AND bom_item_id = ?', args: [r.id, bomItemId] });
        const left = (await tx.execute({ sql: 'SELECT bom_item_id FROM packing_item_bom_items WHERE packing_item_id = ?', args: [r.id] })).rows;
        if (left.length) {
          if (r.bom_item_id === bomItemId) await tx.execute({ sql: 'UPDATE packing_items SET bom_item_id = ? WHERE id = ?', args: [left[0].bom_item_id, r.id] });
        } else {
          await tx.execute({ sql: 'DELETE FROM packing_items WHERE parent_item_id = ? AND packing_list_id = ?', args: [r.id, l.id] });
          await tx.execute({ sql: 'DELETE FROM packing_items WHERE id = ?', args: [r.id] });
        }
      }
      if (l.layout === 'combined') await normalizeList(tx, l.id, l.master_section);
    }
  });
  return { blocked: false };
}


// What the project's packing lists look like right now, so Production can be asked the right question:
// an open draft (items just go on it), a packed list that could be pulled back to draft, or neither.
// A packed list can only be reopened while no e-way bill exists and no freight is posted.
export async function describeProjectLists(listProjectId) {
  const open = await queryOne(
    `SELECT id, packing_no FROM packing_lists WHERE project_id = ? AND status = 'draft' AND layout = 'combined' ORDER BY id DESC LIMIT 1`, [listProjectId]);
  if (open) return { open_draft: open.packing_no, reopenable: null, blocked: null };
  const packed = await queryOne(
    `SELECT id, packing_no, eway_bill_no FROM packing_lists WHERE project_id = ? AND status = 'packed' AND layout = 'combined' ORDER BY id DESC LIMIT 1`, [listProjectId]);
  if (!packed) return { open_draft: null, reopenable: null, blocked: null };
  const freight = await queryOne("SELECT 1 AS x FROM journal_entries WHERE source_type = 'dispatch_freight' AND source_id = ?", [packed.id]);
  if (packed.eway_bill_no || freight) {
    return { open_draft: null, reopenable: null, blocked: { packing_no: packed.packing_no, reason: packed.eway_bill_no ? 'it has an e-way bill' : 'its freight is posted' } };
  }
  const cycle = await queryOne('SELECT status FROM pre_dispatch_approvals WHERE packing_list_id = ? ORDER BY id DESC LIMIT 1', [packed.id]);
  return { open_draft: null, blocked: null,
    reopenable: { id: packed.id, packing_no: packed.packing_no, review: cycle && cycle.status !== 'withdrawn' && cycle.status !== 'rejected' ? cycle.status : null } };
}

// Pull a packed list back to draft so more items can be added. Any pre-dispatch review it was in
// (pending or approved) is withdrawn: the list has to be packed and submitted again.
export async function reopenListToDraft(listId, listProjectId, user) {
  const pl = await queryOne('SELECT id, status, project_id, packing_no, eway_bill_no FROM packing_lists WHERE id = ?', [listId]);
  if (!pl || pl.project_id !== listProjectId) throw Object.assign(new Error('Packing list not found for this project'), { status: 404 });
  if (pl.status !== 'packed') throw Object.assign(new Error(`${pl.packing_no} is no longer packed`), { status: 409 });
  if (pl.eway_bill_no) throw Object.assign(new Error(`${pl.packing_no} has an e-way bill`), { status: 409 });
  const freight = await queryOne("SELECT 1 AS x FROM journal_entries WHERE source_type = 'dispatch_freight' AND source_id = ?", [listId]);
  if (freight) throw Object.assign(new Error(`${pl.packing_no} has freight posted`), { status: 409 });
  await execute("UPDATE packing_lists SET status = 'draft' WHERE id = ?", [listId]);
  await execute("UPDATE pre_dispatch_approvals SET status = 'withdrawn' WHERE packing_list_id = ? AND status IN ('pending','approved')", [listId]);
  await audit('packing_reopened', { actor: user?.username || 'system', detail: `${pl.packing_no} pulled back to draft to add handed-over items` });
}
