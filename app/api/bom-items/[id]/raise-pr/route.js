// Stores raises a real Purchase Requisition for a demand line that stock can't cover. Replaces the old
// "Send to Procurement" (procure) for Demand: the PR shows in PR History and Procurement's Enquiry.
// It links the EXISTING bom_item (pr_item_id) instead of inserting a second one, so nothing is
// double-counted. The line's own qty_text is what Procurement sources — Reserve first (the split leaves
// the remainder row = the shortfall), then raise on that row.
import { NextResponse } from 'next/server';
import { queryOne, withTransaction, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { isClosedStatus } from '@/lib/bom-fields.mjs';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.procure');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (item.source !== 'bom') return NextResponse.json({ error: 'Only a project BOM line can be sent this way' }, { status: 400 });
  if (item.pr_item_id) return NextResponse.json({ error: 'A Purchase Requisition already exists for this line' }, { status: 409 });
  if (isClosedStatus(item.purchase_status)) return NextResponse.json({ error: 'This line is already received or cancelled' }, { status: 409 });
  if (!String(item.qty_text || '').trim()) return NextResponse.json({ error: 'The line has no quantity' }, { status: 400 });
  const covered = await queryOne(
    `SELECT (SELECT COUNT(*) FROM inventory_reservations WHERE bom_item_id = ? AND status = 'active')
          + (SELECT COUNT(*) FROM stock_pieces WHERE bom_item_id = ? AND status = 'reserved')
          + (SELECT COUNT(*) FROM po_items WHERE bom_item_id = ?) AS n`, [item.id, item.id, item.id]);
  if (Number(covered?.n) > 0) {
    return NextResponse.json({ error: 'This line already has stock reserved or a purchase order — reserve the rest or let Procurement handle it' }, { status: 409 });
  }

  const seq = await nextCounterValue('pr_no', 0);
  const prNo = `PR-${seq}`;
  await withTransaction(async tx => {
    const pr = await tx.execute({
      sql: 'INSERT INTO purchase_requisitions (pr_no, raised_by_dept, created_by) VALUES (?, ?, ?)',
      args: [prNo, 'Stores', user.username] });
    const prItem = await tx.execute({
      sql: `INSERT INTO pr_items (pr_id, material_description, moc, size_spec, sort_order, category, category_fields_json, named_parts_json, origin)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      args: [Number(pr.lastInsertRowid), item.material_description, item.moc, item.size_spec, item.category,
        item.category_fields_json, item.named_parts_json, item.origin || 'manual'] });
    const prItemId = Number(prItem.lastInsertRowid);
    await tx.execute({
      sql: 'INSERT INTO pr_item_projects (pr_item_id, project_id, qty_text) VALUES (?, ?, ?)',
      args: [prItemId, item.project_id, String(item.qty_text).trim()] });
    await tx.execute({ sql: 'UPDATE bom_items SET pr_item_id = ?, pending_review = 0 WHERE id = ?', args: [prItemId, item.id] });
  });
  await audit('bom_item_raise_pr', { actor: user.username, detail: `bom_item ${item.id} (${item.material_description}) -> ${prNo}` });
  try {
    await notifyDepartment('Procurement', {
      kind: 'request', title: `${prNo} raised by Stores`, body: item.material_description,
      dedupe_key: `bom_procured:${item.id}`,
    });
  } catch { /* notification is best-effort */ }
  return NextResponse.json({ ok: true, pr_no: prNo });
}
