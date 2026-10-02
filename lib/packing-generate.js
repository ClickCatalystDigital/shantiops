// Shared by POST /api/packing/from-bom and /api/packing/batch-children: turn ready BOM lines into
// draft packing lists — one list per company, each line tagged with its form (BOM root name) so the
// PDF can print Master/Annexure sections. Unassigned lines have no root → section left blank ("Other").
import { execute, queryAll, queryOne, nextNumber, withTransaction } from '@/lib/db';
import { rootOf, defaultCompany, unitLabelOf, normalizePackType } from '@/lib/packing-forms.mjs';
import { planCombinedList } from '@/lib/packing-plan.mjs';
import { parseConfig } from '@/lib/bom-config.mjs';
import { learnedChoices } from '@/lib/packing-memory';
import { maybeStartMilestone } from '@/lib/milestone-auto';

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
async function createCombinedPackingList({ project: p0, treeProjectId, customerName, lines, user, revision, companyOverride = null }) {
  const project = (await queryOne('SELECT * FROM projects WHERE id = ?', [p0.id])) || p0;
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
  const packing_no = await nextNumber('packing_no', 'PL');
  const listId = await withTransaction(async tx => {
    const pl = await tx.execute({
      sql: `INSERT INTO packing_lists (project_id, packing_no, customer_name, created_by, company, master_section, bom_release_revision_at_creation, layout)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'combined')`,
      args: [project.id, packing_no, customerName, user?.username || null, company, main_section, revision] });
    const listId = Number(pl.lastInsertRowid);
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
    return listId;
  });
  try { await maybeStartMilestone(project.id, 'packing', user?.username); } catch { /* best-effort */ }
  return [{ id: listId, packing_no, company, items: rows.filter(r => r.kind === 'item' || r.kind === 'assembly').length }];
}
