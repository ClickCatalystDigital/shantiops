// Shared by POST /api/packing/from-bom and /api/packing/batch-children: turn ready BOM lines into
// draft packing lists — one list per company, each line tagged with its form (BOM root name) so the
// PDF can print Master/Annexure sections. Unassigned lines have no root → section left blank ("Other").
import { execute, queryAll, nextNumber } from '@/lib/db';
import { rootOf, defaultCompany } from '@/lib/packing-forms.mjs';
import { maybeStartMilestone } from '@/lib/milestone-auto';

// lines: [{ b: bom_items row (needs assembly_id, material_description, moc, size_spec, make),
//           qty, unit? }]. treeProjectId: project whose bom_assemblies hold the tree (the master for
// split children). Returns [{ id, packing_no, company, items }].
export async function createPackingLists({ project, treeProjectId, customerName, lines, user, revision = null }) {
  const asm = await queryAll('SELECT id, name, parent_id FROM bom_assemblies WHERE project_id = ?', [treeProjectId]);
  const byId = new Map(asm.map(a => [a.id, a]));
  const byCompany = new Map();
  for (const l of lines) {
    const root = l.b.assembly_id ? rootOf(l.b.assembly_id, byId) : null;
    const company = defaultCompany(root?.name, project.company);
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
