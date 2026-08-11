// app/api/campaigns/route.js — V3_CHANGES.md §12 Phase 1c. Marketing's own real surface.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function GET() {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll('SELECT * FROM campaigns ORDER BY created_at DESC'));
}

export async function POST(req) {
  const user = getSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const ownerDept = CRM_DEPARTMENTS.includes(b.owner_dept) ? b.owner_dept : 'Marketing';

  const { lastId } = await execute(
    `INSERT INTO campaigns (name, campaign_type, start_date, end_date, budget, owner_dept, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, b.campaign_type || null, b.start_date || null, b.end_date || null, b.budget || null, ownerDept, b.notes || null, user.username]
  );
  await audit('campaign_created', { actor: user.username, detail: name });
  return NextResponse.json({ id: Number(lastId) });
}
