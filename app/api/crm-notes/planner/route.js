// app/api/crm-notes/planner/route.js — Weekly Planner data (SYSTEM.md §5dr): follow-ups planned in [from, to]
// plus overdue ones (planned before `from`, last 90 days, nothing logged since on that enquiry/customer).
// A Sales member sees follow-ups planned for them or on their own enquiries; the Head / PMs see all Sales ones.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { salesScope } from '@/lib/sales-visibility';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from'), to = sp.get('to');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return NextResponse.json({ error: 'from and to are required (YYYY-MM-DD)' }, { status: 400 });
  const me = salesScope(user);
  const rows = await queryAll(
    `SELECT n.id, n.next_plan_date AS date, n.plan_time, n.plan_for, n.plan_of_action, n.plan_note_type, n.created_by, n.lead_id, n.customer_id,
            COALESCE(l.company_name, cu.name) AS org, COALESCE(c.name, l.lead_name) AS contact_name, COALESCE(c.phone, l.phone) AS phone,
            COALESCE(l.sub_location, l.district) AS location,
            CASE WHEN n.next_plan_date < ? THEN 1 ELSE 0 END AS overdue
       FROM crm_notes n LEFT JOIN leads l ON l.id = n.lead_id LEFT JOIN customers cu ON cu.id = n.customer_id LEFT JOIN contacts c ON c.id = n.contact_id
      WHERE COALESCE(l.owner_dept, 'Sales') = 'Sales' AND n.next_plan_date IS NOT NULL
        AND ( (n.next_plan_date BETWEEN ? AND ?)
           OR (n.next_plan_date < ? AND n.next_plan_date >= date(?, '-90 day') AND n.import_tag IS NULL
               AND NOT EXISTS (SELECT 1 FROM crm_notes n2 WHERE n2.id > n.id AND ((n.lead_id IS NOT NULL AND n2.lead_id = n.lead_id) OR (n.customer_id IS NOT NULL AND n2.customer_id = n.customer_id)))) )
        ${me ? 'AND (n.plan_for = ? OR ? IN (l.account_manager, l.assigned_to, l.initiated_by, l.created_by))' : ''}
      ORDER BY n.next_plan_date, n.plan_time, n.id LIMIT 600`,
    [from, from, to, from, from, ...(me ? [me, me] : [])]);
  return NextResponse.json(rows);
}
