import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { syncPackingMilestone } from '@/lib/milestone-auto';

const EDITABLE = ['customer_name', 'customer_address', 'invoice_no', 'invoice_date', 'package_type',
  'dc_no', 'dc_date', 'vehicle_no', 'dispatch_through', 'contact_person', 'status',
  'sales_invoice_id', 'freight_amount', 'freight_paid_by', 'eway_bill_no', 'eway_bill_date'];
// Same idiom as bom-items PATCH's PURCHASE_STATUSES check / qc-records' pass|fail|pending check.
const PACKING_STATUSES = ['draft', 'packed', 'dispatched'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const b = await req.json();
  if ('status' in b && !PACKING_STATUSES.includes(b.status)) {
    return NextResponse.json({ error: `Unknown status: ${b.status}` }, { status: 400 });
  }
  if ('status' in b) {
    const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.status');
    if (actionDenied) return actionDenied;
  }
  if (Object.keys(b).some(k => k !== 'status')) {
    const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
    if (actionDenied) return actionDenied;
  }

  const pl = await queryOne('SELECT project_id, dispatched_at FROM packing_lists WHERE id = ?', [params.id]);
  if (!pl) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Guard against a silent post-posting correction: once the freight expense is actually in the
  // ledger, editing the amount here would never re-post (postJournalEntry dedupes by source
  // document), so the ledger would silently keep the old, now-wrong figure forever. Route the fix
  // through Accounts' existing manual Journal Entry correction flow instead.
  if ('freight_amount' in b) {
    const posted = await queryOne(
      "SELECT 1 FROM journal_entries WHERE source_type = 'dispatch_freight' AND source_id = ?", [params.id]
    );
    if (posted) {
      return NextResponse.json({ error: 'Freight already posted to the ledger — correct it with a manual Journal Entry in Accounts, not by editing this figure.' }, { status: 409 });
    }
  }

  const sets = [];
  const args = [];
  for (const f of EDITABLE) {
    if (f in b) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  // Stamp the actual dispatch moment once, on the first draft/packed -> dispatched transition —
  // updated_at changes on every edit and can't answer "when did this actually ship" (needed for the
  // Dispatch Register report).
  if (b.status === 'dispatched' && !pl.dispatched_at) {
    sets.push('dispatched_at = CURRENT_TIMESTAMP');
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE packing_lists SET ${sets.join(', ')} WHERE id = ?`, args);
  // Status is the meaningful transition (Pending → Ready → Dispatched) — worth its own audit action.
  if ('status' in b) {
    await audit('packing_status_change', { actor: user.username, detail: `list ${params.id} -> ${b.status}` });
    if (b.status === 'packed' || b.status === 'dispatched') {
      if (pl.project_id) await syncPackingMilestone(pl.project_id, user.username);
    }
  }
  return NextResponse.json({ ok: true });
}

// Discard a whole draft — the gap the per-line DELETE on /items never covered: removing every item
// one at a time still leaves an empty list behind, never actually removes it. Draft-only, same
// "correct/discard before it's real, never after" boundary as everywhere else in this app (a
// packed/dispatched list is a real committed action, corrected forward, not deleted). Reuses the
// per-item route's own `dispatch.packing.edit` action — same authority level, not a new key.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;

  const pl = await queryOne('SELECT status, packing_no FROM packing_lists WHERE id = ?', [params.id]);
  if (!pl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (pl.status !== 'draft') {
    return NextResponse.json({ error: 'Only a draft list can be deleted — a packed/dispatched list is a real record.' }, { status: 409 });
  }
  const posted = await queryOne(
    "SELECT 1 FROM journal_entries WHERE source_type = 'dispatch_freight' AND source_id = ?", [params.id]
  );
  if (posted) {
    return NextResponse.json({ error: 'Freight for this list is already posted to the ledger — reverse it in Accounts first.' }, { status: 409 });
  }

  // FKs aren't enforced (PRAGMA foreign_keys is never turned on in this app) — packing_items'
  // ON DELETE CASCADE never actually fires, so its rows are removed explicitly here.
  await execute('DELETE FROM packing_items WHERE packing_list_id = ?', [params.id]);
  await execute('DELETE FROM packing_lists WHERE id = ?', [params.id]);
  await audit('packing_deleted', { actor: user.username, detail: `list ${params.id} (${pl.packing_no})` });
  return NextResponse.json({ ok: true });
}
