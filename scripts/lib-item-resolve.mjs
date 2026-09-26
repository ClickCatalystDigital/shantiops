// Shared writers for the Item Master residue passes (dry-run by default in every caller). Mirrors what the app does:
// a new items row gets item_code IM-<id>, a person's "this line = that item" decision becomes an exact item_link_memory row
// (same keys as lib/item-link.js recordItemLink), every run is audited.
import { createClient } from '@libsql/client';
import { memoryKeys } from '../lib/item-attributes.mjs';

export const ACTOR = 'script:item-residue-2026-09-26';
export const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
export const q = async (sql, args = []) => (await db.execute({ sql, args })).rows.map(r => ({ ...r }));

export async function itemByName(name) {
  const r = await q('SELECT id, item_name, bom_category, uom FROM items WHERE item_name = ? COLLATE NOCASE', [name]);
  return r[0] || null;
}

// spec: {name, group, bom_category, uom, moc, fields, mfg (0/1), detail, category?, hsn?}
export async function createItem(spec) {
  const existing = await itemByName(spec.name);
  if (existing) return { id: existing.id, created: false };
  const { lastInsertRowid } = await db.execute({
    sql: `INSERT INTO items (item_name, group_name, category, bom_category, uom, default_moc, default_category_fields_json,
                             default_requires_manufacturing, detail_desc, material_process_type, item_type, cfactor, conv_uom)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Procured', 'Purchase', '1', ?)`,
    args: [spec.name, spec.group ?? null, spec.category ?? null, spec.bom_category ?? 'other', spec.uom ?? 'Nos', spec.moc ?? null,
      spec.fields ? JSON.stringify(spec.fields) : null, spec.mfg ?? 0, spec.detail ?? null, spec.uom ?? 'Nos'],
  });
  const id = Number(lastInsertRowid);
  await db.execute({ sql: 'UPDATE items SET item_code = ? WHERE id = ?', args: [`IM-${String(id).padStart(6, '0')}`, id] });
  return { id, created: true };
}

// line: {material_description, moc, size_spec}
export async function seedExactMemory(line, itemId) {
  const k = memoryKeys(line);
  if (!k.alias) return false;
  await db.execute({
    sql: `INSERT INTO item_link_memory (kind, alias_key, moc_key, size_key, item_id, approvals, updated_by)
          VALUES ('exact', ?, ?, ?, ?, 1, ?)
          ON CONFLICT(kind, alias_key, moc_key, size_key, item_id) DO UPDATE SET approvals = approvals + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    args: [k.alias, k.moc, k.size, itemId, ACTOR],
  });
  // anything else remembered for this exact line is now contradicted
  await db.execute({
    sql: `UPDATE item_link_memory SET rejections = rejections + 1 WHERE kind = 'exact' AND alias_key = ? AND moc_key = ? AND size_key = ? AND item_id != ?`,
    args: [k.alias, k.moc, k.size, itemId],
  });
  return true;
}

export const audit = (action, detail) => db.execute({
  sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
  args: [ACTOR, action, JSON.stringify(detail)],
});
