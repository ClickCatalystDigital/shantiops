// app/api/leads/[id]/convert/route.js — V3_CHANGES.md §12 decision 2/7. Lead → Customer +
// Opportunity, the first of four uses of the same "accept → auto-create the next record" playbook
// this plan establishes (also: Quotation→Sale Order, Applicant→Employee). Reuses an existing
// customer matched by exact name rather than always creating a duplicate.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { resolveLeadToCustomer } from '@/lib/crm';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const lead = await queryOne('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (lead.status === 'converted') return NextResponse.json({ error: 'Already converted' }, { status: 409 });
  const actionDenied = await requireAction(user, lead.owner_dept, 'crm.lead.convert');
  if (actionDenied) return actionDenied;

  const b = await req.json().catch(() => ({}));
  // The new Opportunity's stage is seeded from the Lead's own current sales_call_status (the
  // 9-value Sales Call funnel, Sales CRM expansion Phase 0c/2.0) rather than left to
  // `opportunities.stage`'s own DB-level DEFAULT — that default was 'Lead', a name the funnel
  // reseed retired, and SQLite can't cheaply ALTER a column's DEFAULT on an already-created table,
  // so every INSERT here must supply a real, current stage explicitly. Starting the Opportunity
  // mid-funnel exactly where the Lead already was avoids a real inconsistency (a Lead already at
  // "Hot Offers" silently reappearing as a brand-new "Lead - Cold" Opportunity).
  const { customerId, opportunityId } = await resolveLeadToCustomer(lead, { title: b.title, username: user.username });
  return NextResponse.json({ customer_id: customerId, opportunity_id: opportunityId });
}
