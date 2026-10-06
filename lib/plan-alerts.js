// lib/plan-alerts.js — daily material alerts from the Planning coverage engine. One notification per
// project per owning department per day (dedupe key), only for lines Procurement/Stores can act on
// (released BOM) whose production start is within 14 days or already passed.
import { getPlan } from './plan-coverage';
import { notifyDepartment } from './notify';
import { todayISO } from './date';
import { tabLink, enquiryForProject } from './alert-links.mjs';

const OWNER = { decision: 'Stores', sourcing: 'Procurement', late: 'Procurement', held_qc: 'QC' };
const WHAT = {
  decision: 'need a Stores decision (reserve from stock or send to Procurement)',
  sourcing: 'are not ordered yet', late: 'are due after production needs them', held_qc: 'are waiting on inward QC',
};

export async function sweepPlanAlerts({ withinDays = 14 } = {}) {
  const today = todayISO();
  const limit = new Date(today + 'T00:00:00Z'); limit.setUTCDate(limit.getUTCDate() + withinDays);
  const cutoff = limit.toISOString().slice(0, 10);
  const { rows } = await getPlan();
  const groups = new Map();
  for (const r of rows) {
    const dept = OWNER[r.status];
    if (!dept || !r.needBy || r.needBy > cutoff) continue;
    const k = `${dept}|${r.project_id}|${r.status}`;
    const g = groups.get(k) || { dept, project_id: r.project_id, label: r.project_label, status: r.status, n: 0, first: r.needBy };
    g.n++; if (r.needBy < g.first) g.first = r.needBy;
    groups.set(k, g);
  }
  let sent = 0;
  for (const g of groups.values()) {
    sent += (await notifyDepartment(g.dept, {
      kind: 'plan_alert', project_id: g.project_id,
      title: `${g.label}: ${g.n} material line${g.n > 1 ? 's' : ''} ${WHAT[g.status]}`,
      body: g.first < today ? 'Production start date has passed.' : `Production starts ${g.first}.`,
      link: g.dept === 'Stores' ? tabLink('/stores', 'requests', { q: g.label })
        : g.dept === 'QC' ? tabLink('/qc', 'inward-approvals') : enquiryForProject(g.label),
      dedupe_key: `plan_alert:${g.dept}:${g.project_id}:${g.status}:${today}`,
    })) || 0;
  }
  return { planAlertGroups: groups.size, planAlertsSent: sent };
}
