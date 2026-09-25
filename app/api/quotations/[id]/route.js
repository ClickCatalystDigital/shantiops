import { NextResponse } from 'next/server';
import { blockedByApproval } from '@/lib/quotation-approval.mjs';
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { getQuotationDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'revised'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'quotation', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const detail = await getQuotationDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'quotation', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.quotation.status');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (b.status !== undefined) {
    const cur = await queryOne('SELECT approval_status FROM quotations WHERE id = ?', [params.id]);
    if (blockedByApproval(cur, b.status)) return NextResponse.json({ error: 'This quotation\'s discount needs a Sales Head\'s approval first' }, { status: 409 });
  }
  const fields = [];
  const args = [];
  for (const key of ['status', 'valid_until', 'terms', 'notes']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  // Plan 2d — marking a quotation 'sent' by hand records when (the follow-up reminder counts from it).
  if (b.status === 'sent') fields.push('sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP)');
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE quotations SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('quotation_updated', { actor: user.username, detail: `#${params.id}${b.status ? `: ${b.status}` : ''}` });
  return NextResponse.json({ ok: true });
}
