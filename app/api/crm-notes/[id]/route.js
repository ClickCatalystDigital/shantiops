// app/api/crm-notes/[id]/route.js — move or reassign a planned follow-up (Weekly Planner, SYSTEM.md §5dr).
// Date / time: anyone who can see the note. Reassigning to a different person: Sales Head / PM only.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isDepartmentHead } from '@/lib/auth';
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { notifyUser } from '@/lib/notify';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const hidden = await hiddenSalesRecord(user, 'note', params.id);
  if (hidden) return hidden;
  const note = await queryOne(
    `SELECT n.id, n.lead_id, n.next_plan_date, n.plan_time, n.plan_for, n.plan_of_action, COALESCE(l.company_name, c.name) AS org
       FROM crm_notes n LEFT JOIN leads l ON l.id = n.lead_id LEFT JOIN customers c ON c.id = n.customer_id WHERE n.id = ?`, [params.id]);
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json().catch(() => ({}));

  const sets = [], vals = [];
  if (b.next_plan_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.next_plan_date || '')) return NextResponse.json({ error: 'Date must be YYYY-MM-DD' }, { status: 400 });
    sets.push('next_plan_date = ?'); vals.push(b.next_plan_date);
    if (note.next_plan_date) { /* plan_date mirrors next_plan_date when it was set */ sets.push('plan_date = ?'); vals.push(b.next_plan_date); }
  }
  if (b.plan_time !== undefined) { sets.push('plan_time = ?'); vals.push(b.plan_time || null); }
  let newOwner = null;
  if (b.plan_for !== undefined && (b.plan_for || null) !== (note.plan_for || null)) {
    if (!isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Only the Sales Head can reassign a follow-up' }, { status: 403 });
    newOwner = b.plan_for ? await queryOne("SELECT id, username FROM users WHERE active = 1 AND username = ? AND (',' || COALESCE(departments,'') || ',') LIKE '%,Sales,%'", [b.plan_for]) : null;
    if (b.plan_for && !newOwner) return NextResponse.json({ error: 'That person is not an active Sales user' }, { status: 400 });
    sets.push('plan_for = ?'); vals.push(b.plan_for || null);
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  await execute(`UPDATE crm_notes SET ${sets.join(', ')} WHERE id = ?`, [...vals, params.id]);
  await audit('crm_note_replanned', { actor: user.username, detail: JSON.stringify({ id: Number(params.id), ...b }) }).catch(() => {});
  if (newOwner && newOwner.id !== user.id) {
    const when = b.next_plan_date || note.next_plan_date;
    await notifyUser(newOwner.id, { kind: 'diary_plan', title: `Follow-up reassigned to you — ${note.org || 'enquiry'} on ${when}`, body: String(note.plan_of_action || '').slice(0, 200) || null, dedupe_key: `diary:${note.id}:reassign:${newOwner.id}:${when}` }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
