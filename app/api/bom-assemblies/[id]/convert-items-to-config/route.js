import { NextResponse } from 'next/server';
import { queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { findBlockedIds } from '@/lib/bom-item-guard';
import { classifyConfigRow, isConfigLabel, parseConfig, mergeConfig, serializeConfig } from '@/lib/bom-config.mjs';
import { audit } from '@/lib/usb';

// "Convert to configuration" — moves BOM items that are really a subsystem's datasheet (TYPE / FLOW cfm /
// MOTOR RATING…, imported as items before Configuration existed) onto this node's Configuration, and deletes
// the item rows. Always human-triggered, never automatic. Only items that are pure datasheet-shaped can be
// converted (lib/bom-config.mjs: no quantity, no material, no procurement data, at most one value cell) — the
// label vocabulary is NOT required here, because a person is choosing (so PHASE / VOLTAGE… work) — and even then:
//   - a released BOM is refused (same rule as Delete Entire BOM),
//   - PR-raised lines and items with downstream activity are refused (lib/bom-item-guard.js, the same schema-derived
//     gate single-item delete and PMB Replace use),
//   - nothing is converted past the 100-row configuration cap (those items simply stay).
// Item rows are deleted (not undoable per item), so the audit entry records every converted label/value.
const ITEM_COLS = `id, material_description, moc, size_spec, make, remarks, qty_text, pr_ref, po_ref, grn_ref,
  grn_qty_text, pending_qty_text, bqtc_ref, issued_ref, received_ref, pr_item_id`;

async function gate(user) {
  // Converting edits the node AND deletes items — the caller needs both permissions.
  return (await requireEngineeringAction(user, 'engineering.assembly.add'))
    || (await requireEngineeringAction(user, 'engineering.bom.delete_item'));
}

async function loadCandidates(node) {
  const milestone = await queryOne(
    `SELECT status, actual_end FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom'`, [node.project_id]);
  const released = !!(milestone?.actual_end || milestone?.status === 'done');
  const items = await queryAll(`SELECT ${ITEM_COLS} FROM bom_items WHERE assembly_id = ? ORDER BY sort_order, id`, [node.id]);
  const blocked = await findBlockedIds(items.map(i => i.id));
  const out = [];
  for (const it of items) {
    const cls = classifyConfigRow(it, { anyLabel: true });
    if (!cls) continue; // a real item (quantity/material/procurement data) — never offered
    let reason = null;
    if (released) reason = 'This BOM has been released';
    else if (it.pr_item_id != null) reason = 'Raised through a Purchase Request';
    else if (blocked.has(it.id)) reason = 'Has quotes, orders, receipts or other activity';
    out.push({
      id: it.id, label: cls.label, value: cls.value,
      suggested: isConfigLabel(it.material_description), // matches the known datasheet vocabulary
      convertible: !reason, reason,
    });
  }
  out.sort((a, b) => Number(b.suggested) - Number(a.suggested));
  return out;
}

async function loadNode(id) {
  return queryOne('SELECT id, project_id, name, config_json FROM bom_assemblies WHERE id = ?', [id]);
}

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await gate(user);
  if (denied) return denied;
  const node = await loadNode(params.id);
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ candidates: await loadCandidates(node) });
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await gate(user);
  if (denied) return denied;
  const node = await loadNode(params.id);
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const candidates = await loadCandidates(node);
  const byId = new Map(candidates.map(c => [c.id, c]));

  // Explicit ids, or (no ids given) everything convertible that matches the datasheet vocabulary.
  const wanted = Array.isArray(b.item_ids)
    ? [...new Set(b.item_ids.map(Number).filter(Number.isInteger))]
    : candidates.filter(c => c.suggested && c.convertible).map(c => c.id);
  if (!wanted.length) return NextResponse.json({ error: 'Nothing to convert' }, { status: 400 });
  if (wanted.length > 200) return NextResponse.json({ error: 'Convert at most 200 items at a time' }, { status: 400 });

  const skipped = [];
  const eligible = [];
  for (const id of wanted) {
    const c = byId.get(id);
    if (!c) skipped.push({ id, reason: 'Not a datasheet-style item on this node (it has a quantity, material or procurement data)' });
    else if (!c.convertible) skipped.push({ id, label: c.label, reason: c.reason });
    else eligible.push(c);
  }

  // Merge first, then convert only the items whose label really landed in the list (the row cap).
  const merged = mergeConfig(parseConfig(node.config_json), eligible.map(c => ({ label: c.label, value: c.value })));
  const present = new Set(merged.list.map(e => e.label.toLowerCase()));
  const converted = [];
  for (const c of eligible) {
    if (present.has(c.label.toLowerCase())) converted.push(c);
    else skipped.push({ id: c.id, label: c.label, reason: 'Configuration is full (100 rows)' });
  }
  if (!converted.length) return NextResponse.json({ converted: 0, skipped }, { status: 200 });

  await withTransaction(async tx => {
    await tx.execute({ sql: 'UPDATE bom_assemblies SET config_json = ? WHERE id = ?', args: [serializeConfig(merged.list), node.id] });
    await tx.execute({
      sql: `DELETE FROM bom_items WHERE assembly_id = ? AND id IN (${converted.map(() => '?').join(',')})`,
      args: [node.id, ...converted.map(c => c.id)],
    });
  });

  await audit('bom_items_converted_to_config', {
    actor: user.username,
    detail: JSON.stringify({
      project_id: node.project_id, node_id: node.id, node: node.name,
      converted: converted.map(c => ({ id: c.id, label: c.label, value: c.value })),
      skipped: skipped.length,
    }),
  });
  return NextResponse.json({ converted: converted.length, skipped, config: merged.list });
}
