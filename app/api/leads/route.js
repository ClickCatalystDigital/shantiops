// app/api/leads/route.js — V3_CHANGES.md §12 Phase 1. Same shape as app/api/opportunities/route.js:
// two-department gate (Sales|Marketing), GET open to any internal user, POST department-scoped.
import { scopeRows } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { checkSalesPerson } from '@/lib/sales-people';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { DEFAULT_STAGE, leadStateForStage } from '@/lib/lead-stage.mjs';
import { resolveProductLines, writeLeadProducts, nextAssignee } from '@/lib/crm';
import { notifyUsername } from '@/lib/notify';
import { tabLink } from '@/lib/alert-links.mjs';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
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
    return NextResponse.json(await scopeRows(user, 'leads', rows));
  }
  return NextResponse.json(await scopeRows(user, 'leads', await queryAll('SELECT * FROM leads ORDER BY created_at DESC')));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  // Enquiry's own creation form (SalesWorkspace.jsx's AddEnquiryDialog) sends `organization`
  // instead of `lead_name`/`company_name` — there's no separate contact-name field on that form,
  // so Organization fills both, same as the plain Leads dialog fills lead_name only.
  if (b.organization) b.organization = String(b.organization).toUpperCase(); // orgs are always stored in caps
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

  // Every enquiry starts with a real funnel stage (plan 1a) — previously it was left NULL until the
  // next server restart's migrate() backfill.
  const stage = b.sales_call_status || DEFAULT_STAGE;
  const stageRow = await queryOne('SELECT name, is_won, is_lost FROM sales_stages WHERE name = ? AND active = 1', [stage]);
  if (!stageRow) return NextResponse.json({ error: `Unknown stage "${stage}"` }, { status: 400 });

  // Plan 1e — product lines (the older single product_id/product fields still work as one line).
  // Validated before the enquiry exists, so a bad line never leaves a half-saved enquiry.
  const productInput = Array.isArray(b.products) ? b.products
    : (b.product_id || b.product ? [{ product_id: b.product_id, description: b.product }] : null);
  let productLines = null;
  if (productInput) {
    try { productLines = await resolveProductLines(productInput); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: err.status || 500 }); }
  }

  // Plan 1i — a Sales enquiry's A/C manager / Initiated by are Sales usernames, not free text.
  if (ownerDept === 'Sales') {
    for (const [k, label] of [['account_manager', 'A/C Manager'], ['initiated_by', 'Initiated by']]) {
      const chk = await checkSalesPerson(b[k], { label });
      if (chk.error) return NextResponse.json({ error: chk.error }, { status: 400 });
      b[k] = chk.value;
    }
  }
  const assignedTo = b.assigned_to || await nextAssignee(ownerDept);
  const { lastId } = await execute(
    `INSERT INTO leads (
       lead_name, company_name, phone, email, source, campaign_id, owner_dept, notes,
       territory, industry, next_contact_date, assigned_to, created_by, status, sales_call_status,
       enquiry_date, address, website, product, product_id, reference, short_name, district, sub_location,
       telephone, order_expected_in, week_number, account_manager, initiated_by, district_code, pin_code, expected_value
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadName, b.company_name || b.organization || null, b.phone || null, b.email || null, b.source || null,
      b.campaign_id || null, ownerDept, b.notes || null, b.territory || null, b.industry || null,
      b.next_contact_date || null, assignedTo, user.username, leadStateForStage([stageRow], stage), stage,
      b.enquiry_date || null, address || null, b.website || null, b.product || null, b.product_id || null, b.reference || null,
      b.short_name || null, b.district || null, b.sub_location || null, b.telephone || null,
      b.order_expected_in || null, b.week_number || null, b.account_manager || null, b.initiated_by || null,
      b.district_code || null, b.pin_code || null,
      Number(b.expected_value) > 0 ? Number(b.expected_value) : null]
  );
  const id = Number(lastId);
  // First stage-history row (from: none). Written directly rather than via setLeadStage() so
  // updated_at stays equal to created_at — "untouched since creation" is what the SLA check reads.
  await execute('INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, changed_by) VALUES (?, ?, ?, ?)',
    [id, null, stage, user.username]);
  if (productLines?.length) {
    await writeLeadProducts(id, productLines, { setExpectedValue: !(Number(b.expected_value) > 0) });
  }
  // Add-on / cross-sell and AMC enquiries (SYSTEM.md §5dr): linked to an existing customer, tagged by type.
  const enquiryType = b.enquiry_type === 'amc' ? 'amc' : 'sales';
  const linkedCustomer = b.converted_customer_id ? await queryOne('SELECT id FROM customers WHERE id = ?', [b.converted_customer_id]) : null;
  if (enquiryType !== 'sales' || b.product_type || linkedCustomer) {
    await execute('UPDATE leads SET enquiry_type = ?, product_type = COALESCE(?, product_type), converted_customer_id = COALESCE(?, converted_customer_id) WHERE id = ?',
      [enquiryType, b.product_type || null, linkedCustomer?.id || null, id]);
  }
  for (const who of new Set([b.account_manager, assignedTo])) {
    await notifyUsername(who, {
      kind: 'lead_assigned', title: `New enquiry for you — ${leadName}`, body: `Added by ${user.display_name || user.username}`,
      link: tabLink('/sales', 'leads', { highlight: `LD-${id}` }), dedupe_key: `lead_assigned:${id}:${who}`,
    }, { except: user.username }).catch(() => {});
  }
  await audit('lead_created', { actor: user.username, detail: leadName });
  return NextResponse.json({ id });
}
