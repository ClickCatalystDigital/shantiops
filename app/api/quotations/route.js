// app/api/quotations/route.js — V3_CHANGES.md §12 Phase 2d. quotation_no follows the same
// FY-format sequence po_no uses (app/api/purchase-orders/route.js), a distinct counter/prefix.
// POST accepts the full item list at once (small form, not a separate line-item endpoint like
// opportunities' bulk-PUT — a quotation is created whole, not built up incrementally in the UI).
import { NextResponse } from 'next/server';
import { execute, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { getQuotations } from '@/lib/data';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/company-profiles.js';
import { setLeadStage } from '@/lib/crm';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getQuotations());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.quotation.create');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.customer_id) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  const items = Array.isArray(b.items) ? b.items.filter(it => String(it.item_description || '').trim()) : [];
  if (!items.length) return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 });

  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // FY = Apr-Mar
  const seq = await nextCounterValue('quotation_no', 0);
  // Company-aware numbering (real bug, previously always hardcoded /SB/ regardless of which
  // company the quotation was actually for) — reads the same invoice_prefix company_settings
  // already carries for every other document.
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  const companyRow = await queryOne('SELECT invoice_prefix FROM company_settings WHERE company = ?', [company]);
  const quotationNo = `QTN-${seq}/${companyRow?.invoice_prefix || 'SB'}/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;

  // Rate after Discount stays derived, never stored — amount = qty * rate * (1 - discount_pct/100).
  const lineAmount = (it) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const discountPct = Number(it.discount_pct) || 0;
    return qty * rate * (1 - discountPct / 100);
  };
  const subtotal = items.reduce((a, it) => a + lineAmount(it), 0);
  const taxPct = Number(b.tax_pct) || 0;
  const taxAmount = subtotal * taxPct / 100;
  const total = subtotal + taxAmount;

  const { lastId } = await execute(
    `INSERT INTO quotations
       (quotation_no, customer_id, opportunity_id, lead_id, quotation_date, valid_until, subtotal, tax_pct, tax_amount, total, terms, notes, created_by, company, quotation_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [quotationNo, b.customer_id, b.opportunity_id || null, b.lead_id || null, b.quotation_date || null, b.valid_until || null,
      subtotal, taxPct, taxAmount, total, b.terms || null, b.notes || null, user.username, company, b.quotation_type || null]
  );
  const quotationId = Number(lastId);
  let sortOrder = 0;
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const discountPct = Number(it.discount_pct) || 0;
    await execute(
      `INSERT INTO quotation_items (quotation_id, item_description, hsn_code, qty, uom, rate, discount_pct, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [quotationId, it.item_description.trim(), it.hsn_code || null, qty, it.uom || null, rate, discountPct, lineAmount(it), sortOrder++]
    );
  }
  await audit('quotation_created', { actor: user.username, detail: quotationNo });

  // A quotation existing is real proof the opportunity has reached the "offer sent" stage —
  // advance it forward if it hasn't already, same one-way/rank idiom as advancePurchaseStatus
  // (lib/procurement.js). sort_order (not stage name) is the rank source since sales_stages is
  // DB-configurable. 'Hot Offers' is the 9-value funnel's own stage for this (Sales CRM expansion
  // Phase 0c — was 'Quoted' under the old 5-value pipeline, remapped here to match).
  if (b.opportunity_id) {
    try {
      const opp = await queryOne(
        `SELECT o.stage, s.sort_order FROM opportunities o
           JOIN sales_stages s ON s.name = o.stage WHERE o.id = ?`, [b.opportunity_id]);
      const quoted = await queryOne(`SELECT sort_order FROM sales_stages WHERE name = 'Hot Offers' AND active = 1`);
      if (opp && quoted && opp.sort_order < quoted.sort_order) {
        await execute('UPDATE opportunities SET stage = ? WHERE id = ?', ['Hot Offers', b.opportunity_id]);
      }
    } catch (err) { /* best-effort, quotation creation is the user's real intent */ }
  }
  // Same rule for the enquiry the quotation was raised from (the enquiry is the deal, plan 1b):
  // an open enquiry earlier than Hot Offers moves forward to it. Never pulls a won/lost one back.
  if (b.lead_id) {
    try {
      const lead = await queryOne(
        `SELECT s.sort_order, s.is_won, s.is_lost FROM leads l
           JOIN sales_stages s ON s.name = l.sales_call_status WHERE l.id = ?`, [b.lead_id]);
      const quoted = await queryOne(`SELECT sort_order FROM sales_stages WHERE name = 'Hot Offers' AND active = 1`);
      if (lead && quoted && !lead.is_won && !lead.is_lost && lead.sort_order < quoted.sort_order) {
        await setLeadStage(b.lead_id, 'Hot Offers', user.username);
      }
    } catch (err) { /* best-effort, quotation creation is the user's real intent */ }
  }

  return NextResponse.json({ id: quotationId, quotation_no: quotationNo });
}
