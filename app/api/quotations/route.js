// app/api/quotations/route.js — V3_CHANGES.md §12 Phase 2d. quotation_no follows the same
// FY-format sequence po_no uses (app/api/purchase-orders/route.js), a distinct counter/prefix.
// POST accepts the full item list at once (small form, not a separate line-item endpoint like
// opportunities' bulk-PUT — a quotation is created whole, not built up incrementally in the UI).
import { scopeRows } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { execute, queryOne, nextCounterValue, getAppSetting } from '@/lib/db';
import { approvalFor, maxDiscount, DEFAULT_DISCOUNT_APPROVAL_PCT, revisionNumber } from '@/lib/quotation-approval.mjs';
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { notifyDepartmentHeads } from '@/lib/notify';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { getQuotations } from '@/lib/data';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/company-profiles.js';
import { setLeadStage } from '@/lib/crm';
import { quotationTotals } from '@/lib/sales-lines.mjs';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await scopeRows(user, 'quotations', await getQuotations()));
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

  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  // Plan 1f/1g — each line carries its own GST % (defaulted from its product; a blank line falls
  // back to the document's GST %). Rate after Discount stays derived, never stored. CGST+SGST vs
  // IGST follows the issuing company's and the customer's states, same rule as invoices and the PO
  // wizard (lib/sales-lines.mjs quotationTotals -> lib/gst-calc.mjs gstSplit).
  for (const it of items) {
    for (const k of ['qty', 'rate', 'discount_pct', 'gst_pct']) {
      const v = it[k];
      if (v !== '' && v != null && !(Number.isFinite(Number(v)) && Number(v) >= 0)) {
        return NextResponse.json({ error: `${k} must be a number ≥ 0` }, { status: 400 });
      }
    }
    if (Number(it.discount_pct) > 100 || Number(it.gst_pct) > 100) {
      return NextResponse.json({ error: 'Discount % and GST % must be 100 or less' }, { status: 400 });
    }
  }
  const productIds = [...new Set(items.map(it => Number(it.product_id)).filter(Boolean))];
  if (productIds.length) {
    const found = await queryOne(`SELECT COUNT(*) AS n FROM sales_products WHERE id IN (${productIds.map(() => '?').join(',')})`, productIds);
    if (Number(found?.n) !== productIds.length) return NextResponse.json({ error: 'Unknown product on a line' }, { status: 400 });
  }
  const customer = await queryOne('SELECT state_code FROM customers WHERE id = ?', [b.customer_id]);
  if (!customer) return NextResponse.json({ error: 'Unknown customer' }, { status: 400 });
  // Plan 4 — a revision ("Revise" on an existing quotation) keeps the chain's first number with an
  // -R<n> suffix and doesn't use a new number from the sequence; the one it replaces becomes 'revised'.
  if (b.lead_id) { // plan 2a — only on an enquiry this user can see
    const hiddenLead = await hiddenSalesRecord(user, 'lead', b.lead_id);
    if (hiddenLead) return hiddenLead;
  }
  let revision = null;
  if (b.revision_of) {
    const hidden = await hiddenSalesRecord(user, 'quotation', b.revision_of);
    if (hidden) return hidden;
    const prev = await queryOne('SELECT id, status, parent_quotation_id, customer_id FROM quotations WHERE id = ?', [b.revision_of]);
    if (!prev) return NextResponse.json({ error: 'The quotation being revised was not found' }, { status: 404 });
    if (prev.status === 'accepted' || prev.status === 'revised') return NextResponse.json({ error: `A ${prev.status} quotation can't be revised` }, { status: 409 });
    const rootId = prev.parent_quotation_id || prev.id;
    const root = await queryOne('SELECT id, quotation_no FROM quotations WHERE id = ?', [rootId]);
    const top = await queryOne('SELECT MAX(revision_no) AS n FROM quotations WHERE id = ? OR parent_quotation_id = ?', [rootId, rootId]);
    const n = (Number(top?.n) || 0) + 1;
    revision = { prevId: prev.id, rootId, n, no: revisionNumber(root.quotation_no, n) };
  }
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // FY = Apr-Mar
  const seq = revision ? null : await nextCounterValue('quotation_no', 0);
  // Company-aware numbering (real bug, previously always hardcoded /SB/ regardless of which
  // company the quotation was actually for) — reads the same invoice_prefix company_settings
  // already carries for every other document.
  const companyRow = await queryOne('SELECT invoice_prefix, state_code FROM company_settings WHERE company = ?', [company]);
  const quotationNo = revision ? revision.no : `QTN-${seq}/${companyRow?.invoice_prefix || 'SB'}/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;

  const t = quotationTotals(items, {
    companyStateCode: companyRow?.state_code || null,
    customerStateCode: customer.state_code || null,
    fallbackGstPct: b.tax_pct === '' || b.tax_pct == null ? 18 : Number(b.tax_pct),
  });

  // Plan 4 — a discount above the Head's threshold needs approval before it can be sent.
  const threshold = await getAppSetting('sales_discount_approval_pct', String(DEFAULT_DISCOUNT_APPROVAL_PCT));
  const approvalStatus = approvalFor(items, threshold);

  const { lastId } = await execute(
    `INSERT INTO quotations
       (quotation_no, customer_id, opportunity_id, lead_id, quotation_date, valid_until, subtotal, tax_pct, tax_amount, total,
        cgst_amount, sgst_amount, igst_amount, terms, notes, created_by, company, quotation_type, max_discount_pct, approval_status,
        parent_quotation_id, revision_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [quotationNo, b.customer_id, b.opportunity_id || null, b.lead_id || null, b.quotation_date || null, b.valid_until || null,
      t.subtotal, t.uniformGstPct ?? 0, t.taxAmount, t.total, t.cgst, t.sgst, t.igst,
      b.terms || null, b.notes || null, user.username, company, b.quotation_type || null, maxDiscount(items), approvalStatus,
      revision ? revision.rootId : null, revision ? revision.n : 0]
  );
  const quotationId = Number(lastId);
  let sortOrder = 0;
  for (const it of t.lines) {
    await execute(
      `INSERT INTO quotation_items (quotation_id, item_description, hsn_code, qty, uom, rate, discount_pct, gst_pct, product_id, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [quotationId, String(it.item_description).trim(), it.hsn_code || null, Number(it.qty) || 0, it.uom || null, Number(it.rate) || 0,
        Number(it.discount_pct) || 0, it.gst_pct, it.product_id ? Number(it.product_id) : null, it.amount, sortOrder++]
    );
  }
  await audit('quotation_created', { actor: user.username, detail: quotationNo });
  if (revision) {
    await execute(`UPDATE quotations SET status = 'revised', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [revision.prevId]);
    await audit('quotation_revised', { actor: user.username, detail: `#${revision.prevId} → ${quotationNo}` });
  }
  if (approvalStatus === 'pending') {
    await notifyDepartmentHeads('Sales', {
      kind: 'quotation_approval', title: `Discount approval needed — ${quotationNo}`,
      body: `${maxDiscount(items)}% discount (limit ${threshold}%), raised by ${user.display_name || user.username}`,
      dedupe_key: `quotation_approval:${quotationId}`,
    }).catch(() => {});
  }

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
