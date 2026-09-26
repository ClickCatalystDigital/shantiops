// lib/item-link.js — server side of the Item Master matcher (lib/item-match.mjs): the cached catalog index, the remembered
// links, and the ONE function every human link goes through (linkBomItem) so the memory can only learn from deliberate acts.
import { queryAll, queryOne, execute } from './db';
import { buildCatalogIndex, matchLine, memoryFromRows, fillUnitFromCatalog } from './item-match.mjs';
import { memoryKeys, DIMENSIONAL } from './item-attributes.mjs';
import { audit } from './usb';

let cache = null; // {at, index} — the catalog changes rarely; a minute of staleness is harmless and saves a 2,800-row read per call
export async function getCatalogIndex() {
  if (cache && Date.now() - cache.at < 60_000) return cache.index;
  const rows = await queryAll('SELECT id, item_name, bom_category, uom FROM items');
  cache = { at: Date.now(), index: buildCatalogIndex(rows.map(r => ({ ...r }))) };
  return cache.index;
}

export async function getMemory() {
  return memoryFromRows(await queryAll('SELECT kind, alias_key, moc_key, size_key, item_id, approvals, rejections FROM item_link_memory'));
}

// lines: [{material_description, moc, size_spec, category}] -> a match result per line (lib/item-match.mjs matchLine)
export async function matchLines(lines) {
  const [index, memory] = await Promise.all([getCatalogIndex(), getMemory()]);
  return lines.map(l => matchLine(l, index, memory));
}

// A person linked `line` to `itemId`: approve that exact link, approve the family (when the catalog really has one), and
// count it against whatever memory said something else for the same line.
export async function recordItemLink(line, itemId, username) {
  const keys = memoryKeys(line);
  if (!keys.alias) return;
  const index = await getCatalogIndex();
  const row = index.byId.get(Number(itemId));
  await execute(
    `INSERT INTO item_link_memory (kind, alias_key, moc_key, size_key, item_id, approvals, updated_by)
     VALUES ('exact', ?, ?, ?, ?, 1, ?)
     ON CONFLICT(kind, alias_key, moc_key, size_key, item_id) DO UPDATE SET approvals = approvals + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [keys.alias, keys.moc, keys.size, itemId, username]);
  await execute(
    `UPDATE item_link_memory SET rejections = rejections + 1, updated_at = CURRENT_TIMESTAMP
     WHERE kind = 'exact' AND alias_key = ? AND moc_key = ? AND size_key = ? AND item_id != ?`,
    [keys.alias, keys.moc, keys.size, itemId]);
  if (row && DIMENSIONAL.includes(row.bom_category)) {
    const familyIds = [...index.byId.values()].filter(r => r.bom_category === row.bom_category && r._stem === row._stem).map(r => r.id);
    if (familyIds.length >= 2) { // a real family: several catalog rows differing only by size
      await execute(
        `INSERT INTO item_link_memory (kind, alias_key, moc_key, size_key, item_id, approvals, updated_by)
         VALUES ('family', ?, ?, '', ?, 1, ?)
         ON CONFLICT(kind, alias_key, moc_key, size_key, item_id) DO UPDATE SET approvals = approvals + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [keys.alias, keys.moc, itemId, username]);
      await execute(
        `UPDATE item_link_memory SET rejections = rejections + 1, updated_at = CURRENT_TIMESTAMP
         WHERE kind = 'family' AND alias_key = ? AND moc_key = ? AND item_id NOT IN (${familyIds.map(() => '?').join(',')})`,
        [keys.alias, keys.moc, ...familyIds]);
    }
  }
}

// Import preview: the person changed an auto-filled link to another row — the remembered answer was wrong.
export async function recordItemRejection(line, itemId) {
  const keys = memoryKeys(line);
  if (!keys.alias) return;
  await execute(
    `UPDATE item_link_memory SET rejections = rejections + 1, updated_at = CURRENT_TIMESTAMP
     WHERE kind = 'exact' AND alias_key = ? AND moc_key = ? AND size_key = ? AND item_id = ?`,
    [keys.alias, keys.moc, keys.size, itemId]);
}

// The single write path for "this BOM line IS that catalog row" (link-item route, the review queue). Same history guard the
// route always had: a line with receipt/issue history keeps its (un)link, or historical reports would be rewritten.
// -> {ok:true, unitFilled} | {error, status}
export async function linkBomItem(bomItemId, itemId, username, { learn = true } = {}) {
  const bomItem = await queryOne(
    'SELECT id, item_id, material_description, moc, size_spec, category, qty_text FROM bom_items WHERE id = ?', [bomItemId]);
  if (!bomItem) return { error: 'Not found', status: 404 };
  const newItemId = itemId == null ? null : Number(itemId);
  let catalogRow = null;
  if (newItemId != null) {
    catalogRow = await queryOne('SELECT id, item_name, uom, bom_category FROM items WHERE id = ?', [newItemId]);
    if (!catalogRow) return { error: 'Catalog item not found', status: 404 };
  }
  if (bomItem.item_id !== newItemId) {
    const hasBill = await queryOne('SELECT 1 FROM vendor_bill_items WHERE bom_item_id = ?', [bomItemId]);
    const hasIssue = await queryOne('SELECT 1 FROM material_issues WHERE bom_item_id = ?', [bomItemId]);
    if (hasBill || hasIssue) {
      return { error: 'This line has receipt/issue history — changing its catalog link would rewrite historical reports', status: 409 };
    }
  }
  const filled = catalogRow ? fillUnitFromCatalog(bomItem.qty_text, catalogRow.uom, bomItem.category) : bomItem.qty_text;
  const unitFilled = filled !== bomItem.qty_text;
  await execute(// a line with no category takes the catalog item's (same rule the import applies); an existing category is never overwritten
    "UPDATE bom_items SET item_id = ?, needs_spec = NULL, qty_text = ?, category = CASE WHEN category IS NULL OR category = '' THEN ? ELSE category END WHERE id = ?", [newItemId, unitFilled ? filled : bomItem.qty_text, catalogRow?.bom_category || null, bomItemId]);
  await audit('bom_item_link_item', {
    actor: username,
    detail: JSON.stringify({ bom_item_id: Number(bomItemId), old_item_id: bomItem.item_id, new_item_id: newItemId, unit_filled: unitFilled }),
  });
  if (newItemId == null && bomItem.item_id != null && learn) {
    // Unlinking a line: whatever was remembered for it was wrong, so it must stop auto-linking.
    try { await recordItemRejection(bomItem, bomItem.item_id); } catch { /* best-effort */ }
  }
  if (newItemId != null && learn) {
    try { await recordItemLink(bomItem, newItemId, username); } catch { /* learning is best-effort — the link itself already succeeded */ }
  }
  return { ok: true, unitFilled };
}
