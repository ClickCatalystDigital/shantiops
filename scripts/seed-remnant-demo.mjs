// scripts/seed-remnant-demo.mjs — Cutting & Remnant Management demo data. Creates one dedicated
// demo project (its own release_bom milestone left pending, so the real "Release BOM" button in
// the UI is what triggers matching — not something this script fakes) plus one piece-tracked
// inventory line with a single matching remnant, so the BOM line's required qty (2) shows the real
// partial-match behavior: 1 reserved automatically, 1 shortfall still visible to Stores/Procurement.
//
// Idempotent: deletes its own previously-seeded rows (matched by project_no/description) before
// reinserting, same "safe to rerun" precedent as scripts/seed-procurement-demo.mjs. Writes to
// whatever DB .env.local points at — the shared dev Turso DB by default (see memory:
// dev-server-uses-remote-turso). Demo rows are clearly named; delete the project when done if you
// want to clean up.
//
// Run: node --env-file=.env.local scripts/seed-remnant-demo.mjs
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: 'number',
});
async function run(sql, args = []) { return db.execute({ sql, args }); }
async function one(sql, args = []) { return (await run(sql, args)).rows[0] || null; }

const PROJECT_NO = 'RM-DEMO-1';
const INVENTORY_DESC = 'MS Plate 10mm (remnant demo)';

async function main() {
  // Clean up any previous run.
  const existingProject = await one('SELECT id FROM projects WHERE project_no = ?', [PROJECT_NO]);
  if (existingProject) {
    await run('DELETE FROM stock_pieces WHERE bom_item_id IN (SELECT id FROM bom_items WHERE project_id = ?)', [existingProject.id]);
    await run('DELETE FROM bom_items WHERE project_id = ?', [existingProject.id]);
    await run('DELETE FROM milestones WHERE project_id = ?', [existingProject.id]);
    await run('DELETE FROM projects WHERE id = ?', [existingProject.id]);
  }
  const existingInv = await one('SELECT id FROM inventory_items WHERE description = ?', [INVENTORY_DESC]);
  if (existingInv) {
    await run('DELETE FROM stock_pieces WHERE inventory_item_id = ?', [existingInv.id]);
    await run('DELETE FROM inventory_items WHERE id = ?', [existingInv.id]);
  }

  const proj = await run(
    `INSERT INTO projects (project_no, customer_name, description, status) VALUES (?, ?, ?, 'active')`,
    [PROJECT_NO, 'Remnant Demo Co.', 'Cutting & Remnant Management verification project']
  );
  const projectId = Number(proj.lastInsertRowid);
  await run(
    `INSERT INTO milestones (project_id, milestone_key, milestone_label, department, status)
     VALUES (?, 'release_bom', 'Release BOM / PR', 'Design', 'pending')`,
    [projectId]
  );

  const inv = await run(
    `INSERT INTO inventory_items (description, spec, moc, category, track_pieces, on_hand) VALUES (?, NULL, ?, 'plate', 1, 0)`,
    [INVENTORY_DESC, 'IS 2062 E250']
  );
  const inventoryItemId = Number(inv.lastInsertRowid);
  const weight = (2000 / 1000) * (1000 / 1000) * (10 / 1000) * 7850; // 157 kg
  const piece = await run(
    `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status, source)
     VALUES (?, 'plate', 2000, 1000, 10, 7850, ?, 'available', 'purchase')`,
    [inventoryItemId, weight]
  );
  await run('UPDATE stock_pieces SET code = ? WHERE id = ?', [`PL-${String(piece.lastInsertRowid).padStart(4, '0')}`, piece.lastInsertRowid]);

  const dims = JSON.stringify({ material: 'MS', length: '1800', width: '900', thickness: '10' });
  const bomItem = await run(
    `INSERT INTO bom_items (project_id, material_description, moc, size_spec, qty_text, category, category_fields_json, sort_order)
     VALUES (?, 'MS Plate (demo)', 'IS 2062 E250', '1800x900x10', '2 Nos', 'plate', ?, 0)`,
    [projectId, dims]
  );

  console.log(`Seeded project ${PROJECT_NO} (id ${projectId}) with 1 BOM line (id ${Number(bomItem.lastInsertRowid)}, qty 2 Nos, 1800x900x10 MS/IS 2062 E250).`);
  console.log(`Seeded inventory line "${INVENTORY_DESC}" (id ${inventoryItemId}) with 1 available piece: 2000x1000x10, ${Math.round(weight * 100) / 100} kg.`);
  console.log(`\nNext: sign in as Design/Engineering, open project ${PROJECT_NO}, click "Release BOM" — the single piece should auto-reserve 1 of the 2 required, leaving 1 as a normal shortfall.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
