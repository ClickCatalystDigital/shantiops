// Shared helpers for the 2026-09-24 full-rigor manual BOM-item audit resolution scripts
// (scripts/resolve-remaining-bom-items-*.mjs). Every query is scoped to the exact 6 real STF-IBR
// projects this audit covers (248,249,250,281,282,283) — round 3's own find/fix: an unscoped query
// silently touched 3 other real live projects (SB-1040/SB-1109-01-50/SB-1114) in rounds 1-2, before
// this scoping was added. Matching is always on NORMALIZED text (collapsed whitespace), never raw
// byte-equality — real PMB cells carry irregular internal padding that varies row to row even for
// the identical stated spec (round 3's second real find).
import { createClient } from '@libsql/client';

export const PROJECTS = [248, 249, 250, 281, 282, 283];
export const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
export const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// key: "description|moc|size_spec" (moc/size may be '' for null) -> every still-unlinked row across
// the 6 target projects whose normalized text matches.
export async function findRows(key) {
  const [desc, moc, size] = key.split('|');
  const rows = (await db.execute({
    sql: `SELECT id, project_id, section, group_label, assembly_id, material_description, moc, size_spec,
          make, qty_text, purchase_status, source, import_id, pending_review, category
          FROM bom_items WHERE source='bom' AND item_id IS NULL
          AND material_description = ? AND project_id IN (${PROJECTS.join(',')})`,
    args: [desc],
  })).rows;
  return rows.filter(r => norm(r.moc) === norm(moc) && norm(r.size_spec) === norm(size));
}

export async function createItem(item, apply, newItemIds) {
  const existing = (await db.execute({ sql: 'SELECT id FROM items WHERE item_name = ?', args: [item.item_name] })).rows;
  if (existing.length) { console.log(`  SKIP "${item.item_name}" — already exists (id ${existing[0].id})`); newItemIds[item.item_name] = existing[0].id; return; }
  console.log(`  CREATE "${item.item_name}" (${item.bom_category})`);
  if (!apply) return;
  const { lastInsertRowid } = await db.execute({
    sql: `INSERT INTO items (item_name, group_name, category, bom_category, uom, default_moc, default_category_fields_json)
          VALUES (?, ?, 'RAW MATERIALS', ?, ?, ?, ?)`,
    args: [item.item_name, item.group_name || null, item.bom_category, item.uom || 'Nos', item.default_moc || null, item.fields ? JSON.stringify(item.fields) : null],
  });
  const id = Number(lastInsertRowid);
  newItemIds[item.item_name] = id;
  await db.execute({ sql: 'UPDATE items SET item_code = ? WHERE id = ?', args: [`IM-${String(id).padStart(6, '0')}`, id] });
}

export function resolveId(x, newItemIds) { return typeof x === 'string' ? newItemIds[x] : x; }

export async function linkAll(key, itemId, apply, counters) {
  const rows = await findRows(key);
  if (!rows.length) { console.log(`  [MISS] no live row for "${key}"`); return; }
  for (const r of rows) {
    console.log(`  #${r.id} (project ${r.project_id}) "${r.material_description}" -> item_id ${itemId}`);
    counters.linked++;
    if (apply) await db.execute({ sql: 'UPDATE bom_items SET item_id = ? WHERE id = ?', args: [itemId, r.id] });
  }
}

// pieces: [{size, qty, itemId, category?}] — decomposes every row matching `key` into these pieces,
// then deletes the original bundle row. category defaults to the bundle row's own stored category.
export async function decomposeAll(key, pieces, apply, counters) {
  const rows = await findRows(key);
  if (!rows.length) { console.log(`  [MISS] no live row for decompose "${key}"`); return; }
  for (const row of rows) {
    console.log(`  decompose #${row.id} (project ${row.project_id}) "${row.material_description}" into ${pieces.length} piece(s):`);
    for (const p of pieces) {
      console.log(`      insert: ${p.size} qty="${p.qty}" -> item_id ${p.itemId}`);
      counters.decomposed++;
      if (apply) {
        await db.execute({
          sql: `INSERT INTO bom_items (project_id, section, group_label, assembly_id, material_description, category, moc,
                size_spec, make, qty_text, purchase_status, source, import_id, item_id, pending_review)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [row.project_id, row.section, row.group_label, row.assembly_id, row.material_description,
                 p.category || row.category, row.moc, p.size, row.make, p.qty, row.purchase_status, row.source,
                 row.import_id, p.itemId, row.pending_review],
        });
      }
    }
    console.log(`  delete original bundle row #${row.id}`);
    counters.deleted++;
    if (apply) await db.execute({ sql: 'DELETE FROM bom_items WHERE id = ?', args: [row.id] });
  }
}

export async function audit(bucket, counters, extra = {}) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: ['script:item-master-standardize', 'bom_item_manual_audit_resolved', JSON.stringify({ bucket, ...counters, ...extra })],
  });
  console.log('Applied and audited.');
}
