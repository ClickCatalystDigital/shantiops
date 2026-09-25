// app/api/crm-notes/route.js — V3_CHANGES.md §12 decision 4. Shared activity/notes log across
// lead/opportunity/customer, exactly one FK set per row (notifications-style). GET filters by
// whichever id query param is passed; POST requires exactly one of the three.
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getCrmNotes } from '@/lib/data';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
// 'diary' isn't its own note_type — a Diary entry's real Action Type is still call/email/meeting/
// note (the legacy form's "Action Type*" field), and diary-ness is signaled by which diary fields
// (below) are actually populated, not by a separate enum value. 'feedback' IS a distinct, real
// note_type (Phase 5's 3 Feedback reports filter on it directly).
const NOTE_TYPES = ['call', 'email', 'meeting', 'note', 'feedback'];
// Any of these present means this is a Diary entry (Phase 1) — its own authority (sales.diary.write),
// distinct from just leaving a plain note.
const DIARY_FIELDS = ['visit_date', 'action_taken', 'plan_date', 'plan_of_action', 'next_plan_date', 'in_time', 'out_time', 'plan_note_type'];

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const leadId = sp.get('lead_id');
  const opportunityId = sp.get('opportunity_id');
  const customerId = sp.get('customer_id');
  const hidden = leadId ? await hiddenSalesRecord(user, 'lead', leadId) : null; // plan 2a
  if (hidden) return hidden;
  return NextResponse.json(await getCrmNotes({ leadId, opportunityId, customerId }));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const b = await req.json();
  const content = String(b.content || '').trim();
  if (!content) return NextResponse.json({ error: 'Content is required' }, { status: 400 });
  const setCount = [b.lead_id, b.opportunity_id, b.customer_id].filter(Boolean).length;
  if (setCount !== 1) {
    return NextResponse.json({ error: 'Exactly one of lead_id, opportunity_id, customer_id is required' }, { status: 400 });
  }
  const noteType = NOTE_TYPES.includes(b.note_type) ? b.note_type : 'note';
  // Call Log fields (Frappe CRM parity) — only meaningful when note_type is 'call', silently
  // ignored otherwise rather than 400ing, since the client always sends whatever the form has.
  const callType = noteType === 'call' && ['incoming', 'outgoing'].includes(b.call_type) ? b.call_type : null;
  const durationSeconds = noteType === 'call' && b.duration_seconds ? Number(b.duration_seconds) : null;

  // Diary (Phase 1) — its own gate (Gap #17: actions on a Lead follow the record's own owner_dept,
  // never hardcoded to Sales) since it's a distinct authority from just leaving a plain note.
  const isDiaryEntry = DIARY_FIELDS.some(k => b[k]);
  if (isDiaryEntry && b.lead_id) {
    const lead = await queryOne('SELECT owner_dept FROM leads WHERE id = ?', [b.lead_id]);
    if (lead) {
      const denied = await requireAction(user, lead.owner_dept, 'sales.diary.write');
      if (denied) return denied;
    }
  }

  const { lastId } = await execute(
    `INSERT INTO crm_notes (
       lead_id, opportunity_id, customer_id, note_type, content, call_type, duration_seconds,
       visit_date, action_taken, is_value_addition, in_time, out_time, plan_date, plan_time,
       plan_for, plan_of_action, next_plan_date, alert_mode, send_alert_sms, contact_id,
       product_id, location, feedback_responded, plan_note_type, created_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.lead_id || null, b.opportunity_id || null, b.customer_id || null, noteType, content, callType, durationSeconds,
      b.visit_date || null, b.action_taken || null, b.is_value_addition ? 1 : 0, b.in_time || null, b.out_time || null,
      b.plan_date || null, b.plan_time || null, b.plan_for || null, b.plan_of_action || null, b.next_plan_date || null,
      b.alert_mode || null, b.send_alert_sms || null, b.contact_id || null, b.product_id || null, b.location || null,
      b.feedback_responded != null ? (b.feedback_responded ? 1 : 0) : null,
      // Plan 1j — the Action Type of the PLANNED follow-up (call/email/meeting/other).
      NOTE_TYPES.includes(b.plan_note_type) && b.plan_note_type !== 'feedback' ? b.plan_note_type : null, user.username]
  );
  // A note/Diary entry is real activity on the enquiry — bump its updated_at so the first-response
  // SLA check (lib/lead-stage.mjs isSlaBreached: "untouched since creation") sees it.
  if (b.lead_id) await execute('UPDATE leads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [b.lead_id]);
  return NextResponse.json({ id: Number(lastId) });
}
