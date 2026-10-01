// DB side of lib/packing-layout.mjs: load a combined list, apply a diff in the caller's transaction, restore order.
import { queryAll } from './db';
import { normalizeRows } from './packing-layout.mjs';

const COLS = ['line_kind', 'section', 'pack_type', 'group_label', 'box_no', 'material_description', 'moc', 'size_spec', 'ibr_no', 'item_code',
  'qty', 'unit', 'make', 'sort_order', 's_no', 'parent_item_id', 'bom_item_id'];

export async function loadModel(listId) {
  const rows = await queryAll('SELECT * FROM packing_items WHERE packing_list_id = ? ORDER BY sort_order, id', [listId]);
  const ids = rows.map(r => r.id);
  const links = new Map();
  const bom = new Map();
  if (ids.length) {
    const inl = ids.map(() => '?').join(',');
    for (const l of await queryAll(`SELECT packing_item_id, bom_item_id, qty FROM packing_item_bom_items WHERE packing_item_id IN (${inl})`, ids)) {
      if (!links.has(l.packing_item_id)) links.set(l.packing_item_id, []);
      links.get(l.packing_item_id).push({ bom_item_id: l.bom_item_id, qty: l.qty });
    }
    const bomIds = [...new Set([...links.values()].flat().map(l => l.bom_item_id))];
    if (bomIds.length) for (const b of await queryAll(`SELECT id, material_description, moc, size_spec, make FROM bom_items WHERE id IN (${bomIds.map(() => '?').join(',')})`, bomIds)) bom.set(b.id, b);
  }
  return { rows, linksOf: id => links.get(id) || [], bomOf: id => bom.get(id) };
}

function setClause(patch) {
  const keys = Object.keys(patch).filter(k => COLS.includes(k));
  return { sql: keys.map(k => `${k} = ?`).join(', '), args: keys.map(k => patch[k] ?? null) };
}

export async function applyDiff(tx, listId, diff) {
  for (const u of diff.updates || []) {
    const { sql, args } = setClause(u.patch);
    if (sql) await tx.execute({ sql: `UPDATE packing_items SET ${sql} WHERE id = ? AND packing_list_id = ?`, args: [...args, u.id, listId] });
  }
  for (const ins of diff.inserts || []) {
    const keys = COLS.filter(k => k in ins.row);
    const r = await tx.execute({
      sql: `INSERT INTO packing_items (packing_list_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`,
      args: [listId, ...keys.map(k => ins.row[k] ?? (k === 'qty' ? 0 : k === 'material_description' ? '' : null))] });
    const newId = Number(r.lastInsertRowid);
    for (const l of ins.links || []) await tx.execute({ sql: 'INSERT OR IGNORE INTO packing_item_bom_items (packing_item_id, bom_item_id, qty) VALUES (?, ?, ?)', args: [newId, l.bom_item_id, l.qty ?? null] });
  }
  for (const id of diff.deletes || []) await tx.execute({ sql: 'DELETE FROM packing_items WHERE id = ? AND packing_list_id = ?', args: [id, listId] });
}

// Restore contiguous groups and continuous S.No after any change.
export async function normalizeList(tx, listId, masterSection) {
  const rows = (await tx.execute({ sql: 'SELECT id, parent_item_id, line_kind, section, group_label, sort_order, s_no FROM packing_items WHERE packing_list_id = ?', args: [listId] })).rows;
  for (const u of normalizeRows(rows.map(r => ({ ...r })), masterSection)) {
    await tx.execute({ sql: 'UPDATE packing_items SET sort_order = ?, s_no = ? WHERE id = ?', args: [u.patch.sort_order, u.patch.s_no, u.id] });
  }
}
