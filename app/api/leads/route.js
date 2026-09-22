// app/api/leads/route.js — V3_CHANGES.md §12 Phase 1. Same shape as app/api/opportunities/route.js:
// two-department gate (Sales|Marketing), GET open to any internal user, POST department-scoped.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
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
  const user = await getFreshSessionUser();
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
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  // Enquiry's own creation form (SalesWorkspace.jsx's AddEnquiryDialog) sends `organization`
  // instead of `lead_name`/`company_name` — there's no separate contact-name field on that form,
  // so Organization fills both, same as the plain Leads dialog fills lead_name only.
  const leadName = String(b.lead_name || b.organization || '').trim();
  if (!leadName) return NextResponse.json({ error: 'Lead name is required' }, { status: 400 });
  const address = String(b.address || '').trim();
  if (b.organization && !address) return NextResponse.json({ error: 'Address is required' }, { status: 400 });

  const ownerDept = CRM_DEPARTMENTS.includes(b.owner_dept) ? b.owner_dept
    : CRM_DEPARTMENTS.find(d => canAccessDepartment(user, d)) || 'Sales';
  if (!canAccessDepartment(user, ownerDept)) {
    return NextResponse.json({ error: 'Not granted that department' }, { status: 403 });
  }
  const actionDenied = await requireAction(user, ownerDept, 'crm.lead.create');
  if (actionDenied) return actionDenied;

  const assignedTo = b.assigned_to || await nextAssignee(ownerDept);
  const { lastId } = await execute(
    `INSERT INTO leads (
       lead_name, company_name, phone, email, source, campaign_id, owner_dept, notes,
       territory, industry, next_contact_date, assigned_to, created_by, status,
       enquiry_date, address, website, product, product_id, reference, short_name, district, sub_location,
       telephone, order_expected_in, week_number, account_manager, initiated_by, district_code, pin_code
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadName, b.company_name || b.organization || null, b.phone || null, b.email || null, b.source || null,
      b.campaign_id || null, ownerDept, b.notes || null, b.territory || null, b.industry || null,
      b.next_contact_date || null, assignedTo, user.username, b.status || 'new',
      b.enquiry_date || null, address || null, b.website || null, b.product || null, b.product_id || null, b.reference || null,
      b.short_name || null, b.district || null, b.sub_location || null, b.telephone || null,
      b.order_expected_in || null, b.week_number || null, b.account_manager || null, b.initiated_by || null,
      b.district_code || null, b.pin_code || null]
  );
  await audit('lead_created', { actor: user.username, detail: leadName });
  return NextResponse.json({ id: Number(lastId) });
}
