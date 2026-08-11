// app/api/crm-notes/route.js — V3_CHANGES.md §12 decision 4. Shared activity/notes log across
// lead/opportunity/customer, exactly one FK set per row (notifications-style). GET filters by
// whichever id query param is passed; POST requires exactly one of the three.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { getCrmNotes } from '@/lib/data';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
const NOTE_TYPES = ['call', 'email', 'meeting', 'note'];

export async function GET(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const leadId = sp.get('lead_id');
  const opportunityId = sp.get('opportunity_id');
  const customerId = sp.get('customer_id');
  return NextResponse.json(await getCrmNotes({ leadId, opportunityId, customerId }));
}

export async function POST(req) {
  const user = getSessionUser();
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

  const { lastId } = await execute(
    `INSERT INTO crm_notes (lead_id, opportunity_id, customer_id, note_type, content, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [b.lead_id || null, b.opportunity_id || null, b.customer_id || null, noteType, content, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
