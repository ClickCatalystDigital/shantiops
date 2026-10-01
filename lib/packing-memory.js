// What Dispatch chose for a catalog item (ships as assembly or loose item; packed loose/mounted/package/bag).
// Written ONLY from explicit moves on a list, never from the generator's own suggestions. Same Laplace rule as
// item_link_memory: trusted at >= 1 approval and confidence >= 0.6; a contrary choice counts against the old one.
import { execute, queryAll } from './db';

export async function recordChoice(bomItemIds, field, value, username) {
  if (!bomItemIds.length) return;
  const inl = bomItemIds.map(() => '?').join(',');
  const items = await queryAll(`SELECT DISTINCT item_id FROM bom_items WHERE item_id IS NOT NULL AND id IN (${inl})`, bomItemIds);
  for (const { item_id } of items) {
    await execute(`INSERT INTO packing_choice_memory (item_id, field, value, approvals, updated_by) VALUES (?, ?, ?, 1, ?)
                   ON CONFLICT(item_id, field, value) DO UPDATE SET approvals = approvals + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`, [item_id, field, value, username]);
    await execute('UPDATE packing_choice_memory SET rejections = rejections + 1 WHERE item_id = ? AND field = ? AND value != ?', [item_id, field, value]);
  }
}

// -> Map(item_id -> { ships_as, pack_type }) with only the trusted answers.
export async function learnedChoices(itemIds) {
  const out = new Map();
  if (!itemIds.length) return out;
  const rows = await queryAll(`SELECT item_id, field, value, approvals, rejections FROM packing_choice_memory WHERE item_id IN (${itemIds.map(() => '?').join(',')})`, itemIds);
  const best = new Map();
  for (const r of rows) {
    const conf = (r.approvals + 1) / (r.approvals + r.rejections + 2);
    if (r.approvals < 1 || conf < 0.6) continue;
    const k = `${r.item_id}|${r.field}`;
    if (!best.has(k) || conf > best.get(k).conf) best.set(k, { conf, value: r.value, item_id: r.item_id, field: r.field });
  }
  for (const b of best.values()) out.set(b.item_id, { ...(out.get(b.item_id) || {}), [b.field]: b.value });
  return out;
}
