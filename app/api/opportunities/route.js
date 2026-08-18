// app/api/opportunities/route.js — V3_CHANGES.md A4. The light Sales+Marketing pipeline, same
// shape as app/api/sale-orders/route.js. Shared by both departments (owner_dept on the row decides
// whose it is), so the department gate accepts either — same two-department pattern as
// app/api/bom-items/[id]/cancel/route.js's CANCEL_DEPARTMENTS.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getOpportunities } from '@/lib/data';
import { audit } from '@/lib/usb';

const PIPELINE_DEPARTMENTS = ['Sales', 'Marketing'];

function canAccessPipeline(user) {
  return PIPELINE_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

// V3_CHANGES.md §12 decision 5 — stages are now DB-configurable (sales_stages), not a hardcoded
// array. Validated against the table's names (not an FK id) so a rename never needs a migration.
async function isValidStage(name) {
  const rows = await queryAll('SELECT 1 FROM sales_stages WHERE name = ? AND active = 1', [name]);
  return rows.length > 0;
}

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getOpportunities());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canAccessPipeline(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const title = String(b.title || '').trim();
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

  const ownerDept = PIPELINE_DEPARTMENTS.includes(b.owner_dept) ? b.owner_dept
    : PIPELINE_DEPARTMENTS.find(d => canAccessDepartment(user, d)) || 'Sales';
  if (!canAccessDepartment(user, ownerDept)) {
    return NextResponse.json({ error: 'Not granted that department' }, { status: 403 });
  }
  const actionDenied = await requireAction(user, ownerDept, 'crm.opportunity.create');
  if (actionDenied) return actionDenied;
  const stage = (b.stage && await isValidStage(b.stage)) ? b.stage : 'Lead';

  // customer_id — V3_CHANGES.md §12 Phase 1d wires up the previously-dead FK; customer_name stays
  // as a fallback/display cache when no real customer record is picked.
  const { lastId } = await execute(
    `INSERT INTO opportunities (customer_id, customer_name, title, stage, value_num, probability, expected_close, owner_dept, campaign_id, notes, source, next_contact_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.customer_id || null, b.customer_name || null, title, stage, b.value_num || null, b.probability || null,
      b.expected_close || null, ownerDept, b.campaign_id || null, b.notes || null, b.source || null,
      b.next_contact_date || null, user.username]
  );
  await audit('opportunity_created', { actor: user.username, detail: title });
  return NextResponse.json({ id: Number(lastId) });
}
