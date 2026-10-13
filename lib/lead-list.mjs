// The Enquiries list, board and "other enquiries from this customer", computed on the server one
// page at a time (5,000+ enquiries; GET /api/leads/list). Pure: rows in, page out (selfcheck:
// node lib/lead-list-selfcheck.mjs). Rows are LEAD_LIST_FIELDS (lib/sales-tab-data.mjs), newest first.
import { customerKey } from './customer-match.mjs';
import { DEFAULT_STAGE, isClosedCall } from './lead-stage.mjs';

// Same customer = linked customer, else the name with Pvt/Ltd/etc. ignored ('n' = no usable name).
export const enquiryGroupKey = (l) =>
  (l.converted_customer_id ? `c${l.converted_customer_id}` : `n${customerKey(l.company_name || l.lead_name || '')}`);
const stageOf = (l) => l.sales_call_status || DEFAULT_STAGE;

// f: { stage, source, branch ('all' = no filter), unassigned, amc, search, group }
export function filterLeads(leads, f = {}) {
  const q = String(f.search || '').trim().toLowerCase();
  const rows = leads.filter((l) =>
    (!f.stage || f.stage === 'all' || stageOf(l) === f.stage) &&
    (!f.source || f.source === 'all' || l.source === f.source) &&
    (!f.branch || f.branch === 'all' || String(l.branch_id) === String(f.branch)) &&
    (!f.unassigned || !l.account_manager) &&
    (!f.amc || l.enquiry_type === 'amc') &&
    (!q || String(l.lead_name || '').toLowerCase().includes(q) || String(l.company_name || '').toLowerCase().includes(q)));
  if (!f.group) return rows;
  // "Group by customer": same-customer enquiries together, in the order their first one appears.
  const order = new Map();
  rows.forEach((l) => { const k = enquiryGroupKey(l); if (!order.has(k)) order.set(k, order.size); });
  return [...rows].sort((a, b) => order.get(enquiryGroupKey(a)) - order.get(enquiryGroupKey(b)));
}

function groupCounts(leads) {
  const m = new Map();
  for (const l of leads) { const k = enquiryGroupKey(l); if (k !== 'n') m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

// One page of the list, plus what the toolbar needs from the whole (visible) set.
export function leadsPage(leads, f, offset = 0, limit = 25) {
  const filtered = filterLeads(leads, f);
  const counts = groupCounts(leads);
  const rows = filtered.slice(offset, offset + limit).map((l) => ({ ...l, group_count: counts.get(enquiryGroupKey(l)) || 1 }));
  return {
    rows, total: filtered.length,
    sources: [...new Set(leads.map((l) => l.source).filter(Boolean))].sort(),
    unassignedCount: leads.filter((l) => !l.account_manager).length,
    amcCount: leads.filter((l) => l.enquiry_type === 'amc').length,
  };
}

// Board: per stage the count, value and the first `perStage` cards (newest enquiry first); a
// closed sales call isn't pipeline. `more` = { stage, offset } fetches further cards of one stage.
export function leadBoard(leads, f, stages, perStage = 40, more = null) {
  const pipe = filterLeads(leads, { ...f, group: false }).filter((l) => !isClosedCall(l, stages));
  const won = new Set(stages.filter((s) => s.is_won).map((s) => s.name));
  const lost = new Set(stages.filter((s) => s.is_lost).map((s) => s.name));
  const byStage = (name) => pipe.filter((l) => stageOf(l) === name)
    .sort((a, b) => String(b.enquiry_date || '').localeCompare(String(a.enquiry_date || '')));
  if (more) return { stage: more.stage, cards: byStage(more.stage).slice(more.offset, more.offset + perStage) };
  const wonCount = pipe.filter((l) => won.has(stageOf(l))).length;
  const lostCount = pipe.filter((l) => lost.has(stageOf(l))).length;
  return {
    openValue: pipe.filter((l) => !won.has(stageOf(l)) && !lost.has(stageOf(l))).reduce((a, l) => a + (Number(l.expected_value) || 0), 0),
    wonCount, lostCount,
    columns: [...stages].sort((a, b) => a.sort_order - b.sort_order).map((s) => {
      const cards = byStage(s.name);
      return { name: s.name, count: cards.length, total: cards.reduce((a, l) => a + (Number(l.expected_value) || 0), 0), cards: cards.slice(0, perStage) };
    }),
  };
}

// The other enquiries of the same customer as `lead` (newest first).
export function relatedLeads(leads, lead) {
  const key = enquiryGroupKey(lead);
  if (key === 'n') return [];
  return leads.filter((l) => l.id !== lead.id && enquiryGroupKey(l) === key)
    .sort((a, b) => String(b.enquiry_date || b.created_at).localeCompare(String(a.enquiry_date || a.created_at)));
}

// What New Enquiry suggests: enquiries already under this organization name, and the values
// already used for district / sub-location / source.
export function enquiryFormHints(leads, organization) {
  const key = organization ? customerKey(organization) : '';
  const distinct = (field) => [...new Set(leads.map((l) => l[field]).filter(Boolean))].sort();
  return {
    sameOrg: key ? leads.filter((l) => customerKey(l.company_name || l.lead_name || '') === key)
      .map((l) => ({ id: l.id, sales_call_status: l.sales_call_status })) : [],
    districts: distinct('district'), subLocations: distinct('sub_location'), sources: distinct('source'),
  };
}
