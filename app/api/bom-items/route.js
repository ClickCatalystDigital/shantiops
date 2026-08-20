import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { BOM_FIELDS } from '@/lib/bom-fields.mjs';
import { matchAndReserve } from '@/lib/remnant-match';
import { getAllocationMode, autoReserveFromStock, notifyProcurementIfShortfall } from '@/lib/procurement';

// Add a single BOM item in-app (materials get added mid-project — the BOM definition is
// Engineering's, so this is Engineering/PM-gated like upload).
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Engineering');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Engineering', 'engineering.bom.add_item');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.project_id || !b.material_description?.trim()) {
    return NextResponse.json({ error: 'project_id and material_description are required' }, { status: 400 });
  }
  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const max = await queryOne(
    'SELECT MAX(sort_order) AS m FROM bom_items WHERE project_id = ?', [b.project_id]);
  const fields = ['material_description', ...BOM_FIELDS.filter(f => f !== 'material_description')];
  // production_done is bom_items' one NOT NULL boolean field in this list (everything else here is
  // free text, where an unset value legitimately means NULL) — coercing it to NULL like the text
  // fields violated the column's own NOT NULL constraint and 500'd every single-item add that
  // didn't explicitly pass it. Found live verifying the Allocation Mode redesign, unrelated to it.
  const values = fields.map(f =>
    f === 'production_done' ? (b[f] ? 1 : 0)
    : typeof b[f] === 'string' && b[f].trim() ? b[f].trim() : null);
  values[0] = b.material_description.trim();

  // Allocation Mode gate (STORES-SALES-CHANGES.md, refined 2026-08-20) — a single item added
  // mid-project is always fresh new demand. Manual mode keeps the original always-review behavior
  // (pending_review=1); Auto mode inserts open (0) and lets the auto-match calls below decide
  // whether anything actually needs gating — see lib/procurement.js's autoReserveFromStock.
  const allocationMode = await getAllocationMode();
  const pendingReview = allocationMode === 'manual' ? 1 : 0;
  const res = await execute(
    `INSERT INTO bom_items (project_id, sort_order, pending_review, ${fields.join(', ')})
     VALUES (?, ?, ?, ${fields.map(() => '?').join(', ')})`,
    [b.project_id, (max?.m ?? -1) + 1, pendingReview, ...values]);

  await audit('bom_item_add', {
    actor: user.username,
    detail: JSON.stringify({ bom_item_id: Number(res.lastId), project_id: b.project_id, description: values[0] }),
  });
  try {
    await notifyDepartment('Stores', {
      kind: 'bom_released', title: 'New BOM item', body: values[0],
      dedupe_key: `bom_item:${Number(res.lastId)}`,
    });
  } catch (err) { /* notification is best-effort */ }

  // Cutting & Remnant Management — a line added after the project's own bulk release still deserves
  // the same automatic check; release_bom itself only runs matchProjectBom once, at that moment.
  // Auto mode's plain-stock counterpart runs right alongside it — same "check the moment real
  // demand exists" timing, just for ordinary qty stock instead of tracked stock_pieces.
  try {
    const released = await queryOne(
      `SELECT 1 FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom' AND status = 'done'`,
      [b.project_id]
    );
    if (released) {
      const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [Number(res.lastId)]);
      const dimResult = await matchAndReserve(item, user.username);
      if (allocationMode === 'auto') {
        if (dimResult.matched === 0) await autoReserveFromStock(item, user.username);
        await notifyProcurementIfShortfall(item.id);
      }
    }
  } catch (err) { /* best-effort, same stance as the release-bom hook */ }

  return NextResponse.json({ id: Number(res.lastId) });
}
