// app/api/quotations/[id]/approve/route.js — Sales CRM plan 4. A Sales Head (or PM) approves a
// quotation whose discount is above the threshold, so it can be sent. Head-only action key
// sales.quotation.approve_discount (seeded requires_head = 1).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { notifyUser } from '@/lib/notify';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Only a Sales Head can approve a discount' }, { status: 403 });
  const denied = await requireAction(user, 'Sales', 'sales.quotation.approve_discount');
  if (denied) return denied;
  const q = await queryOne('SELECT id, quotation_no, approval_status, max_discount_pct, created_by FROM quotations WHERE id = ?', [params.id]);
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (q.approval_status !== 'pending') return NextResponse.json({ error: 'Nothing to approve on this quotation' }, { status: 409 });
  await execute(`UPDATE quotations SET approval_status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [user.username, q.id]);
  await audit('quotation_discount_approved', { actor: user.username, detail: `${q.quotation_no}: ${q.max_discount_pct}%` });
  const owner = await queryOne('SELECT id FROM users WHERE active = 1 AND username = ?', [q.created_by]);
  if (owner && owner.id !== user.id) {
    await notifyUser(owner.id, { kind: 'quotation_approved', title: `Discount approved — ${q.quotation_no}`, body: `Approved by ${user.display_name || user.username}; it can be sent now.`, dedupe_key: `quotation_approved:${q.id}` }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
