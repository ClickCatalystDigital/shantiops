// lib/morning-brief.mjs — the morning brief. Pure: numbers in, { subject, text, html } out. Three
// briefs: Executive (money + risk), Project Manager (schedule), Department (that team's own work).
// No model involved; the same data can feed a WhatsApp template later.
const inr = n => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dmy = d => String(d || '').slice(0, 10).split('-').reverse().join('/');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const dueWithin = (forecast, today, days = 7) => {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
  return forecast.filter(p => p.roll?.code !== 'done' && p.estDispatch && p.estDispatch >= today && p.estDispatch <= end)
    .sort((a, b) => a.estDispatch.localeCompare(b.estDispatch));
};
const riskRows = (topRisks, n) => topRisks.slice(0, n).map(r => ({ left: `${r.project_no} · ${r.customer_name || 'no customer'}`, sub: r.milestone_label, right: `${r.impactDays}d late`, bad: true }));
const dispatchRows = due => due.slice(0, 5).map(p => ({ left: `${p.project_no} · ${p.customer_name || 'no customer'}`, right: dmy(p.estDispatch) }));
function approvalRows(a = {}) {
  return [[a.discounts, 'quotation discount'], [a.expenses, 'service expense'], [a.registrations, 'access request']]
    .filter(([n]) => n > 0).map(([n, w]) => ({ left: plural(n, w), right: 'waiting' }));
}
const projectStats = kpi => [
  { label: 'Active', value: kpi.total - kpi.completed },
  { label: 'On track', value: kpi.healthy },
  { label: 'At risk', value: kpi.delayed },
  { label: 'Delayed', value: kpi.critical, bad: kpi.critical > 0 },
];

// kpi/topRisks/forecast: getExecutiveSummary(); biz: getExecutiveBusiness(); today: 'YYYY-MM-DD' (IST).
export function executiveBrief({ kpi, topRisks = [], forecast = [], biz, today }) {
  const due = dueWithin(forecast, today), appr = approvalRows(biz.approvals);
  return {
    kind: 'Executive brief', path: '/executive',
    subject: `Morning brief — ${kpi.critical} delayed, ${inr(biz.outstanding)} outstanding`,
    sections: [
      { heading: 'Projects', stats: projectStats(kpi), rows: riskRows(topRisks, 3) },
      { heading: 'Cash', stats: [
        { label: 'Outstanding', value: inr(biz.outstanding) },
        { label: 'Collected this month', value: inr(biz.collectedMonth) },
        { label: 'Customers owing', value: biz.owingCustomers || 0 },
      ] },
      { heading: 'Dispatch in the next 7 days', rows: dispatchRows(due), empty: 'Nothing scheduled.' },
      { heading: 'Waiting on you', rows: appr, empty: 'No approvals waiting.' },
    ],
  };
}

export function pmBrief({ kpi, topRisks = [], forecast = [], biz, today }) {
  const due = dueWithin(forecast, today), appr = approvalRows(biz?.approvals);
  return {
    kind: 'Project Manager brief', path: '/projects',
    subject: `Morning brief — ${plural(topRisks.length, 'project')} need attention, ${plural(due.length, 'dispatch')} this week`.replace('dispatchs', 'dispatches'),
    sections: [
      { heading: 'Projects', stats: projectStats(kpi) },
      { heading: 'Needs attention', rows: riskRows(topRisks, 6), empty: 'No delayed or blocked projects.' },
      { heading: 'Dispatch in the next 7 days', rows: dispatchRows(due), empty: 'Nothing scheduled.' },
      { heading: 'Waiting on you', rows: appr, empty: 'No approvals waiting.' },
    ],
  };
}

// overdue / due: [{ project_no, label, planned_end }] for one department; tasks: open task count.
export function departmentBrief({ department, overdue = [], due = [], tasks = 0, today }) {
  const daysLate = d => Math.max(1, Math.round((Date.parse(today) - Date.parse(d)) / 864e5));
  const name = department === 'Installation' ? 'Service' : department;
  return {
    kind: `${name} brief`, path: `/ops?dept=${encodeURIComponent(department)}`,
    empty: !overdue.length && !due.length && !tasks,
    subject: `Morning brief · ${name} — ${overdue.length} overdue, ${due.length} due this week`,
    sections: [
      { heading: name, stats: [
        { label: 'Overdue', value: overdue.length, bad: overdue.length > 0 },
        { label: 'Due in 7 days', value: due.length },
        { label: 'Open tasks', value: tasks },
      ] },
      { heading: 'Overdue', rows: overdue.slice(0, 6).map(m => ({ left: m.project_no, sub: m.label, right: `${daysLate(m.planned_end)}d late`, bad: true })), empty: 'Nothing overdue.' },
      { heading: 'Due in the next 7 days', rows: due.slice(0, 6).map(m => ({ left: m.project_no, sub: m.label, right: dmy(m.planned_end) })), empty: 'Nothing due this week.' },
    ],
  };
}

// Turns a brief into the email: plain text (fallback) and the designed HTML version.
export function renderBrief(brief, { today, link = null, footer = '' }) {
  const text = [
    `${brief.kind} — ${dmy(today)}`,
    ...brief.sections.flatMap(s => ['', s.heading.toUpperCase(),
      ...(s.stats ? [s.stats.map(x => `${x.label}: ${x.value}`).join('   ')] : []),
      ...(s.rows?.length ? s.rows.map(r => `  - ${r.left}${r.sub ? ` (${r.sub})` : ''} — ${r.right}`) : s.empty ? [`  ${s.empty}`] : [])]),
    ...(link ? ['', `Open: ${link}`] : []),
  ].join('\n') + footer;

  const INK = '#18181b', MUTE = '#71717a', LINE = '#e4e4e7', BAD = '#b91c1c';
  const stat = x => `<td style="padding:12px 14px;border:1px solid ${LINE};border-radius:10px;">
      <div style="font-size:20px;font-weight:600;color:${x.bad ? BAD : INK};letter-spacing:-0.01em;">${esc(x.value)}</div>
      <div style="font-size:11px;color:${MUTE};margin-top:2px;">${esc(x.label)}</div></td>`;
  const row = r => `<tr><td style="padding:9px 0;border-top:1px solid ${LINE};font-size:13px;color:${INK};">${esc(r.left)}${r.sub ? `<div style="font-size:12px;color:${MUTE};margin-top:1px;">${esc(r.sub)}</div>` : ''}</td>
      <td align="right" style="padding:9px 0;border-top:1px solid ${LINE};font-size:12px;font-weight:500;white-space:nowrap;color:${r.bad ? BAD : MUTE};">${esc(r.right)}</td></tr>`;
  const section = s => `<tr><td style="padding:22px 32px 0;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${MUTE};margin-bottom:10px;">${esc(s.heading)}</div>
      ${s.stats ? `<table role="presentation" cellpadding="0" cellspacing="6" style="width:100%;border-collapse:separate;margin:0 -6px 4px;"><tr>${s.stats.map(stat).join('')}</tr></table>` : ''}
      ${s.rows?.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${s.rows.map(row).join('')}</table>`
        : s.empty ? `<div style="font-size:13px;color:${MUTE};">${esc(s.empty)}</div>` : ''}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;">
    <tr><td style="padding:28px 32px 0;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;color:${MUTE};">SB OPS · ${esc(dmy(today))}</div>
      <div style="font-size:22px;font-weight:600;color:${INK};letter-spacing:-0.02em;margin-top:6px;">Good morning.</div>
      <div style="font-size:13px;color:${MUTE};margin-top:2px;">${esc(brief.kind)}</div>
    </td></tr>
    ${brief.sections.map(section).join('')}
    <tr><td style="padding:26px 32px 28px;">
      ${link ? `<a href="${esc(link)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-size:13px;font-weight:500;padding:10px 18px;border-radius:8px;">Open SB Ops</a>` : ''}
    </td></tr>
  </table>
  <div style="max-width:560px;margin:14px auto 0;text-align:center;font-size:11px;color:#a1a1aa;">SB Ops — an ahromlabs.com product. Change this in Settings → Alerts.</div>
</body></html>`;
  return { subject: brief.subject, text, html };
}
