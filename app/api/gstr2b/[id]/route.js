// app/api/gstr2b/[id]/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, GST compliance
// sub-step. PATCH covers both IMS actions (ims_status: accepted/rejected) and manual field
// corrections on any line, upload-sourced or manual — IMS accept/reject is a real action a
// recipient takes on any inward invoice, not just ones typed in by hand.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

const IMS_STATUSES = ['pending', 'accepted', 'rejected', 'deemed_accepted'];
const EDITABLE_FIELDS = ['supplier_gstin', 'supplier_name', 'invoice_no', 'invoice_date', 'invoice_value',
  'taxable_value', 'igst', 'cgst', 'sgst', 'cess', 'itc_availability', 'itc_reason'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.gstr2b.write');
  if (actionDenied) return actionDenied;

  const line = await queryOne('SELECT id FROM gstr2b_lines WHERE id = ?', [params.id]);
  if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const fields = [];
  const args = [];
  if (b.ims_status !== undefined) {
    if (!IMS_STATUSES.includes(b.ims_status)) return NextResponse.json({ error: 'Invalid ims_status' }, { status: 400 });
    fields.push('ims_status = ?'); args.push(b.ims_status);
  }
  for (const key of EDITABLE_FIELDS) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE gstr2b_lines SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}

// Manual rows only — an upload-sourced line is replaced wholesale by the next upload for its
// period (app/api/gstr2b/upload), not deleted line-by-line.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.gstr2b.write');
  if (actionDenied) return actionDenied;

  const line = await queryOne('SELECT id, source FROM gstr2b_lines WHERE id = ?', [params.id]);
  if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (line.source !== 'manual') return NextResponse.json({ error: 'Only a manually-added line can be deleted — an uploaded line is replaced by re-uploading its period' }, { status: 400 });
  await execute('DELETE FROM gstr2b_lines WHERE id = ?', [params.id]);
  return NextResponse.json({ ok: true });
}
