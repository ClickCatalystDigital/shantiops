// app/api/leads/route.js — V3_CHANGES.md §12 Phase 1. Same shape as app/api/opportunities/route.js:
// two-department gate (Sales|Marketing), GET open to any internal user, POST department-scoped.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

// Assignment Rule (Frappe CRM parity) — round-robin the department's configured username list.
// Advances next_index every call, wrapping via modulo; returns null (unassigned) if no rule or
// an empty list exists, same "leave it visibly unowned" choice as the POST handler below.
async function nextAssignee(ownerDept) {
  const rule = await queryOne('SELECT * FROM crm_assignment_rules WHERE owner_dept = ?', [ownerDept]);
  if (!rule) return null;
  const usernames = JSON.parse(rule.usernames || '[]');
  if (!usernames.length) return null;
  const index = rule.next_index % usernames.length;
  await execute('UPDATE crm_assignment_rules SET next_index = ? WHERE id = ?', [(index + 1) % usernames.length, rule.id]);
  return usernames[index];
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

  const ownerDept = CRM_DEPARTMENTS.includes(b.owner_dept) ? b.owner_dept
    : CRM_DEPARTMENTS.find(d => canAccessDepartment(user, d)) || 'Sales';
  if (!canAccessDepartment(user, ownerDept)) {
    return NextResponse.json({ error: 'Not granted that department' }, { status: 403 });
  }

  const assignedTo = await nextAssignee(ownerDept);
  const { lastId } = await execute(
    `INSERT INTO leads (lead_name, company_name, phone, email, source, campaign_id, owner_dept, notes, territory, industry, next_contact_date, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadName, b.company_name || null, b.phone || null, b.email || null, b.source || null,
      b.campaign_id || null, ownerDept, b.notes || null, b.territory || null, b.industry || null,
      b.next_contact_date || null, assignedTo, user.username]
  );
  await audit('lead_created', { actor: user.username, detail: leadName });
  return NextResponse.json({ id: Number(lastId) });
}
