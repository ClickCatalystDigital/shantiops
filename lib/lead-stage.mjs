// lib/lead-stage.mjs — the one set of rules for an enquiry's stage (docs/sales-crm-plan.md 1a).
//
// The 9-stage Sales Call funnel (`sales_stages`, DB-configurable) is the only status a user sees
// or sets. `leads.status` is kept, but only as a system-maintained summary of that stage:
//   'won'  — the stage is an is_won stage (Order Received)
//   'lost' — the stage is an is_lost stage (Order Lost, Lead Project - Dropped)
//   'open' — anything else
// Linking an enquiry to a customer (`converted_customer_id`) is a separate fact, not a status:
// under "the enquiry is the deal" a converted enquiry keeps moving through the funnel.
//
// Pure — no DB import — so the API, client components and reports all share it, and
// `node lib/lead-stage-selfcheck.mjs` can check it without booting the app.

export const DEFAULT_STAGE = 'Lead - Cold';
export const LEAD_STATES = ['open', 'won', 'lost'];

// First-response SLA: an enquiry nobody has touched since it was created. Same 24h threshold the
// old `status === 'new'` check used.
export const SLA_HOURS = 24;

function findStage(stages, name) {
  return (stages || []).find(s => s.name === name) || null;
}

export function isKnownStage(stages, name) {
  return !!findStage(stages, name);
}

export function leadStateForStage(stages, name) {
  const s = findStage(stages, name);
  if (s?.is_won) return 'won';
  if (s?.is_lost) return 'lost';
  return 'open';
}

// The Enquiry tab: still-open leads sitting before the "Proposals" stage (i.e. not yet quoted).
// Stages are configurable, so if no stage is literally named Proposals, fall back to the first two
// open stages by sort order. A lead whose stage name no longer exists counts as an enquiry, so it
// never silently disappears from every list.
export function isEnquiryStage(stages, name) {
  const s = findStage(stages, name);
  if (!s) return true;
  if (s.is_won || s.is_lost) return false;
  const proposals = findStage(stages, 'Proposals');
  if (proposals) return s.sort_order < proposals.sort_order;
  const open = (stages || []).filter(x => !x.is_won && !x.is_lost).sort((a, b) => a.sort_order - b.sort_order);
  return open.slice(0, 2).some(x => x.name === s.name);
}

// Untouched since creation: still at the default stage, never edited (updated_at === created_at —
// every lead edit, stage change and Diary entry bumps updated_at), not closed, older than the SLA.
export function isSlaBreached(lead, now = Date.now()) {
  if (!lead) return false;
  if ((lead.sales_call_status || DEFAULT_STAGE) !== DEFAULT_STAGE) return false;
  if (lead.status && lead.status !== 'open') return false;
  if (lead.sales_call_closed_at) return false;
  if (lead.updated_at && lead.created_at && lead.updated_at !== lead.created_at) return false;
  return (now - new Date(lead.created_at).getTime()) / 36e5 > SLA_HOURS;
}
