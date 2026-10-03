// lib/morning-brief.mjs — the owner's morning brief as plain text. Pure: numbers in, text out, so
// the same builder can feed email today and a WhatsApp template later. No model involved.
const inr = n => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// kpi/topRisks/forecast: getExecutiveSummary(); biz: getExecutiveBusiness(); today: 'YYYY-MM-DD' (IST).
export function buildBrief({ kpi, topRisks = [], forecast = [], biz, today, link = null }) {
  const weekEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);
  const due = forecast.filter(p => p.roll?.code !== 'done' && p.estDispatch && p.estDispatch >= today && p.estDispatch <= weekEnd)
    .sort((a, b) => a.estDispatch.localeCompare(b.estDispatch));
  const a = biz.approvals || {};
  const waiting = (a.discounts || 0) + (a.expenses || 0) + (a.registrations || 0);

  const lines = [
    `Good morning. SB Ops brief for ${today.split('-').reverse().join('/')}.`,
    '',
    `PROJECTS: ${kpi.total - kpi.completed} active — ${kpi.healthy} on track, ${kpi.delayed} at risk, ${kpi.critical} delayed.`,
    ...topRisks.slice(0, 3).map(r => `  - ${r.project_no} (${r.customer_name || 'no customer'}): ${r.milestone_label}, ${r.impactDays} days late`),
    '',
    `DISPATCH in the next 7 days: ${due.length ? '' : 'none.'}`,
    ...due.slice(0, 5).map(p => `  - ${p.project_no} (${p.customer_name || 'no customer'}) on ${p.estDispatch.split('-').reverse().join('/')}`),
    '',
    `CASH: ${inr(biz.outstanding)} outstanding from ${plural(biz.owingCustomers || 0, 'customer')}. Collected this month: ${inr(biz.collectedMonth)}.`,
    '',
    waiting
      ? `APPROVALS waiting on you: ${[a.discounts && plural(a.discounts, 'quotation discount'), a.expenses && plural(a.expenses, 'service expense'), a.registrations && plural(a.registrations, 'access request')].filter(Boolean).join(', ')}.`
      : 'APPROVALS: nothing waiting.',
    ...(link ? ['', `Open: ${link}`] : []),
  ];
  return {
    subject: `Morning brief — ${kpi.critical} delayed, ${inr(biz.outstanding)} outstanding, ${plural(waiting, 'approval')} waiting`,
    text: lines.join('\n'),
  };
}
