// app/api/leads/route.js — V3_CHANGES.md §12 Phase 1. Same shape as app/api/opportunities/route.js:
// two-department gate (Sales|Marketing), GET open to any internal user, POST department-scoped.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const search = new URL(req.url).searchParams.get('search');
  if (search) {
    const rows = await queryAll(
      "SELECT * FROM leads WHERE lead_name LIKE ? OR company_name LIKE ? ORDER BY created_at DESC LIMIT 20",
      [`%${search}%`, `%${search}%`]
    );
    return NextResponse.json(rows);
  }
  return NextResponse.json(await queryAll('SELECT * FROM leads ORDER BY created_at DESC'));
}

export async function POST(req) {
  const user = getSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const leadName = String(b.lead_name || '').trim();
  if (!leadName) return NextResponse.json({ error: 'Lead name is required' }, { status: 400 });

  const ownerDept = CRM_DEPARTMENTS.includes(b.owner_dept) ? b.owner_dept : 'Sales';
  if (!canAccessDepartment(user, ownerDept)) {
    return NextResponse.json({ error: 'Not granted that department' }, { status: 403 });
  }

  const { lastId } = await execute(
    `INSERT INTO leads (lead_name, company_name, phone, email, source, campaign_id, owner_dept, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadName, b.company_name || null, b.phone || null, b.email || null, b.source || null,
      b.campaign_id || null, ownerDept, b.notes || null, user.username]
  );
  await audit('lead_created', { actor: user.username, detail: leadName });
  return NextResponse.json({ id: Number(lastId) });
}
