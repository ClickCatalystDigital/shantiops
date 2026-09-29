// One UPDATE for many enquiries at once — the A/C Manager assignment gap (docs/sales-data-health)
// left thousands of imported enquiries unowned with no practical way to fix them one at a time.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { salesScope } from '@/lib/sales-visibility';
import { leadVisible } from '@/lib/sales-visibility.mjs';
import { checkSalesPerson } from '@/lib/sales-people';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(Number).filter(Number.isFinite))] : [];
  if (!ids.length) return NextResponse.json({ error: 'No enquiries selected' }, { status: 400 });

  const chk = await checkSalesPerson(b.account_manager, { label: 'A/C Manager' });
  if (chk.error) return NextResponse.json({ error: chk.error }, { status: 400 });
  if (!chk.value) return NextResponse.json({ error: 'Pick an A/C Manager to assign' }, { status: 400 });

  // Only touch enquiries the caller can actually see/own — same two-step rule PATCH enforces
  // per-row (department access, then — for a plain Sales member, not a Head or PM — their own
  // records only, via the identical leadVisible() predicate hiddenSalesRecord uses).
  const rows = await queryAll(
    `SELECT id, owner_dept, account_manager, assigned_to, initiated_by, created_by FROM leads WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const me = salesScope(user);
  const allowedIds = rows
    .filter(r => canAccessDepartment(user, r.owner_dept))
    .filter(r => !me || leadVisible(r, me))
    .map(r => r.id);
  if (!allowedIds.length) return NextResponse.json({ error: 'None of the selected enquiries are visible to you' }, { status: 403 });

  await execute(
    `UPDATE leads SET account_manager = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${allowedIds.map(() => '?').join(',')})`,
    [chk.value, ...allowedIds]
  );
  await audit('lead_bulk_assign_owner', { actor: user.username, detail: `${allowedIds.length} enquiries -> ${chk.value}` });
  return NextResponse.json({ ok: true, updated: allowedIds.length, skipped: ids.length - allowedIds.length });
}
