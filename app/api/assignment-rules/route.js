// app/api/assignment-rules/route.js — Frappe CRM parity: Assignment Rule, scoped down to the one
// pattern that matters here — round-robin a department's new leads across a configured username
// list. One row per department (crm_assignment_rules). GET lists all (both departments, so the
// Team panel can show them side by side); PUT upserts the caller's own department only.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getSessionUser, canAccessDepartment } from '@/lib/auth';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function GET() {
  const user = getSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const rows = await queryAll('SELECT * FROM crm_assignment_rules');
  return NextResponse.json(rows.map(r => ({ ...r, usernames: JSON.parse(r.usernames || '[]') })));
}

export async function PUT(req) {
  const user = getSessionUser();
  const b = await req.json();
  const ownerDept = CRM_DEPARTMENTS.includes(b.owner_dept) ? b.owner_dept : null;
  if (!ownerDept) return NextResponse.json({ error: 'A valid department is required' }, { status: 400 });
  // Each department manages its own round-robin list — a Marketing head can't reassign who Sales
  // routes leads to, same boundary as everywhere else in CRM (Customers/Quotations gate the same way).
  if (!canAccessDepartment(user, ownerDept)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const usernames = Array.isArray(b.usernames) ? b.usernames.filter(Boolean) : [];
  const existing = await queryOne('SELECT id FROM crm_assignment_rules WHERE owner_dept = ?', [ownerDept]);
  if (existing) {
    await execute(
      'UPDATE crm_assignment_rules SET usernames = ?, next_index = 0, updated_at = CURRENT_TIMESTAMP WHERE owner_dept = ?',
      [JSON.stringify(usernames), ownerDept]
    );
  } else {
    await execute('INSERT INTO crm_assignment_rules (owner_dept, usernames) VALUES (?, ?)', [ownerDept, JSON.stringify(usernames)]);
  }
  return NextResponse.json({ ok: true });
}
