// app/api/crm-tasks/route.js — Frappe CRM parity: Task, reusing the shared `tasks` table (see
// lib/db.js) rather than a new one. Same shape/gating as app/api/crm-notes/route.js: GET filters
// by whichever id query param is passed (none = every CRM task, for the Tasks sidebar panel);
// POST requires exactly one of lead_id/opportunity_id/customer_id.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { getCrmTasks } from '@/lib/data';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const leadId = sp.get('lead_id');
  const opportunityId = sp.get('opportunity_id');
  const customerId = sp.get('customer_id');
  return NextResponse.json(await getCrmTasks({ leadId, opportunityId, customerId }));
}

export async function POST(req) {
  const user = getSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const title = String(b.title || '').trim();
  if (!title) return NextResponse.json({ error: 'Task title is required' }, { status: 400 });
  const dueDate = String(b.due_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json({ error: 'A valid due date is required' }, { status: 400 });
  }
  const setCount = [b.lead_id, b.opportunity_id, b.customer_id].filter(Boolean).length;
  if (setCount !== 1) {
    return NextResponse.json({ error: 'Exactly one of lead_id, opportunity_id, customer_id is required' }, { status: 400 });
  }
  const department = CRM_DEPARTMENTS.includes(b.department) ? b.department
    : CRM_DEPARTMENTS.find(d => canAccessDepartment(user, d)) || 'Sales';

  // Unassigned by default — unlike Production's own task board (app/api/production/tasks/
  // route.js), a CRM task falling back to its creator would hide that nobody's actually
  // responsible for following up. Left null on purpose when no assignee is picked.
  const assignedTo = b.assigned_to ? String(b.assigned_to).trim() : null;
  const { lastId } = await execute(
    `INSERT INTO tasks (title, due_date, department, assigned_to, created_by, lead_id, opportunity_id, customer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, dueDate, department, assignedTo, user.username, b.lead_id || null, b.opportunity_id || null, b.customer_id || null]
  );
  return NextResponse.json({ id: Number(lastId) });
}
