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

// Sales CRM plan 1b — "the enquiry is the deal". Reports and the Executive tile were written
// against opportunity rows ({stage, value_num, owner_dept, created_by, lost_reason, campaign_id});
// this maps Sales enquiries into that same shape so their math is unchanged, and keeps
// Marketing's own opportunities as they are (Marketing is out of scope until it gets its own plan).
// `created_by` carries the deal owner: the enquiry's A/C manager, else its assignee, else creator.
export function dealsFromLeads(leads = [], opportunities = []) {
  const salesDeals = leads
    .filter(l => (l.owner_dept || 'Sales') === 'Sales')
    .map(l => ({
      id: `LD-${l.id}`, lead_id: l.id, source: 'lead',
      stage: l.sales_call_status || DEFAULT_STAGE,
      value_num: l.expected_value || 0,
      owner_dept: 'Sales',
      created_by: l.account_manager || l.assigned_to || l.created_by || null,
      lost_reason: l.lost_reason || null,
      campaign_id: l.campaign_id || null,
      title: l.company_name || l.lead_name,
    }));
  const marketingOpps = opportunities
    .filter(o => o.owner_dept === 'Marketing')
    .map(o => ({ ...o, source: 'opportunity' }));
  return [...salesDeals, ...marketingOpps];
}

// Sales CRM plan 3d — win probability of a funnel stage. A Head sets sales_stages.probability_pct
// (Masters → Funnel Stages); until then won = 100, lost = 0, and open stages fall back to a
// declining default by position so the report is never blank.
export function stageProbability(stage) {
  if (!stage) return 0;
  if (stage.probability_pct != null && stage.probability_pct !== '') return Number(stage.probability_pct);
  if (stage.is_won) return 100;
  if (stage.is_lost) return 0;
  return Math.max(0, 100 - Number(stage.sort_order || 0) * 12);
}

// One row per stage: enquiry count, Value = Σ expected_value, weighted Value = Value × probability.
export function funnelRows(leads = [], stages = []) {
  return [...stages].sort((a, b) => a.sort_order - b.sort_order).map(s => {
    const matching = leads.filter(l => l.sales_call_status === s.name);
    const value = matching.reduce((t, l) => t + (Number(l.expected_value) || 0), 0);
    const probability = stageProbability(s);
    return { stage: s.name, isWon: !!s.is_won, isLost: !!s.is_lost, count: matching.length, value, probability, weighted: Math.round(value * probability) / 100 };
  });
}

// Sales CRM plan 3c — average days an enquiry spent in each stage, from lead_stage_history rows
// ({lead_id, to_stage, changed_at}). Only completed stays count (a stage the enquiry has since
// left); the stage it's in now is still running, so it isn't averaged. Returns { stage: days }.
export function avgDaysInStage(history = []) {
  const byLead = new Map();
  for (const h of history) {
    if (!byLead.has(h.lead_id)) byLead.set(h.lead_id, []);
    byLead.get(h.lead_id).push(h);
  }
  const sums = new Map();
  for (const rows of byLead.values()) {
    rows.sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)) || (a.id ?? 0) - (b.id ?? 0));
    for (let i = 0; i < rows.length - 1; i++) {
      const ms = Date.parse(String(rows[i + 1].changed_at).replace(' ', 'T')) - Date.parse(String(rows[i].changed_at).replace(' ', 'T'));
      if (!(ms >= 0)) continue;
      const s = sums.get(rows[i].to_stage) || { total: 0, n: 0 };
      s.total += ms / 86400000; s.n++;
      sums.set(rows[i].to_stage, s);
    }
  }
  return Object.fromEntries([...sums].map(([stage, s]) => [stage, Math.round((s.total / s.n) * 10) / 10]));
}
