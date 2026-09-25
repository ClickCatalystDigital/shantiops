// lib/sales-visibility.mjs — Sales CRM plan 2a: a Sales member sees only their own records; the
// Sales Head and PMs see everything. Pure predicates (selfcheck); lib/sales-visibility.js applies
// them to the DB and API routes. `me` is the username; `visibleLeadIds` a Set of lead ids.

// Marketing-owned enquiries are out of scope (Marketing gets its own plan) — never hidden here.
export function leadVisible(lead, me) {
  if ((lead.owner_dept || 'Sales') !== 'Sales') return true;
  return [lead.account_manager, lead.assigned_to, lead.initiated_by, lead.created_by].includes(me);
}
export function quotationVisible(q, me, visibleLeadIds) {
  return q.created_by === me || (q.lead_id != null && visibleLeadIds.has(Number(q.lead_id)));
}
export function saleOrderVisible(so, me, visibleLeadIds) {
  return so.sales_person_override === me || so.created_by === me || (so.lead_id != null && visibleLeadIds.has(Number(so.lead_id)));
}

// Filter the /sales page lists for a member. Invoices/credit notes/payments follow their order or
// quotation. Returns the same shape it was given.
export function scopeSalesLists(me, lists) {
  const leads = (lists.leads || []).filter(l => leadVisible(l, me));
  const leadIds = new Set(leads.map(l => Number(l.id)));
  const quotations = (lists.quotations || []).filter(q => quotationVisible(q, me, leadIds));
  const saleOrders = (lists.saleOrders || []).filter(so => saleOrderVisible(so, me, leadIds));
  const qIds = new Set(quotations.map(q => Number(q.id))), soIds = new Set(saleOrders.map(s => Number(s.id)));
  const invoices = (lists.invoices || []).filter(i => soIds.has(Number(i.sale_order_id)) || qIds.has(Number(i.quotation_id)) || i.created_by === me);
  const invIds = new Set(invoices.map(i => Number(i.id)));
  return {
    ...lists, leads, quotations, saleOrders, invoices,
    creditNotes: (lists.creditNotes || []).filter(c => invIds.has(Number(c.sales_invoice_id))),
    salePayments: (lists.salePayments || []).filter(p => soIds.has(Number(p.sale_order_id))),
    diaryNotes: lists.diaryNotes && lists.diaryNotes.filter(n => n.lead_id == null ? n.created_by === me : leadIds.has(Number(n.lead_id))),
  };
}
