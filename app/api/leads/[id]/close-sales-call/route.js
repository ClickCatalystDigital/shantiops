// app/api/leads/[id]/close-sales-call/route.js — Phase 3.1's "Close Sales Call" action. A terminal
// action distinct from Order Lost (which also sets a reason) — closing this way just stops the
// SLA/neglected-report clock without saying the order was lost. Never disables the other 4
// actions (Gap #30) — any of them succeeding later implicitly reopens it (app/api/leads/[id]/route.js).
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'lead', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  const lead = await queryOne('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessDepartment(user, lead.owner_dept)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await execute(
    "UPDATE leads SET sales_call_closed_at = CURRENT_TIMESTAMP, sales_call_closed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [user.username, params.id]
  );
  await audit('lead_sales_call_closed', { actor: user.username, detail: `lead #${params.id}` });
  return NextResponse.json({ ok: true });
}
