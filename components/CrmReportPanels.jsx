'use client';

// components/CrmReportPanels.jsx — the 6 CRM analytics report bodies (Sales Pipeline, By
// Department, Agent Performance, Lead Funnel, Leads by Source, Campaign Performance), extracted
// from CrmReportsWorkspace.jsx (2026-08-23) so both the standalone /crm-reports compatibility
// route and the consolidated Report Engine (components/ReportsWorkspace.jsx, via
// lib/reports/catalog.js's `hasOwnControls` entries) render the exact same components — one
// implementation, not two copies to keep in sync. Charts follow the app's own existing bar idiom
// (BomProgress.jsx: thin rounded rows on bg-muted, semantic tokens), not a new chart kit.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatMoney } from '@/lib/format';
import { BarList, StatRow, ReportShell } from '@/components/ReportKit';

const SLA_HOURS = 24;
function isSlaBreached(lead) {
  if (lead.status !== 'new') return false;
  return (Date.now() - new Date(lead.created_at).getTime()) / 36e5 > SLA_HOURS;
}
function countBy(rows, key) {
  const counts = {};
  for (const r of rows) { const k = r[key] || '—'; counts[k] = (counts[k] || 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
function mostCommon(values) {
  const counts = {};
  for (const v of values) { if (!v) continue; counts[v] = (counts[v] || 0) + 1; }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] || null;
}

export function LeadFunnelReport({ leads }) {
  const statuses = ['new', 'contacted', 'qualified', 'converted', 'lost'];
  const totalLeads = leads.length;
  const converted = leads.filter(l => l.status === 'converted').length;
  const conversionRate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : null;
  const slaBreached = leads.filter(isSlaBreached).length;
  const items = statuses.map(s => ({ label: s, value: leads.filter(l => l.status === s).length }));
  const colorFor = i => i.label === 'converted' ? 'bg-success' : i.label === 'lost' ? 'bg-destructive' : 'bg-chart-1';

  return (
    <ReportShell title="Lead Funnel" description="Every lead by status, narrowing from first contact to converted.">
      <StatRow stats={[
        { label: 'Total leads', value: totalLeads },
        { label: 'Conversion rate', value: conversionRate == null ? '—' : `${conversionRate}%` },
        { label: `SLA overdue (${SLA_HOURS}h)`, value: slaBreached, warn: slaBreached > 0 },
      ]} />
      <BarList items={items} colorFor={colorFor} />
    </ReportShell>
  );
}

export function LeadsBySourceReport({ leads }) {
  const items = countBy(leads, 'source').map(([label, value]) => ({ label, value }));
  return (
    <ReportShell title="Leads by Source" description="Which channel is generating leads.">
      <BarList items={items} />
      <Table>
        <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Leads</TableHead></TableRow></TableHeader>
        <TableBody>{items.map(i => <TableRow key={i.label}><TableCell className="font-medium">{i.label}</TableCell><TableCell className="tnum">{i.value}</TableCell></TableRow>)}</TableBody>
      </Table>
    </ReportShell>
  );
}

export function CampaignPerformanceReport({ leads, opportunities, campaigns }) {
  const rows = campaigns.map(c => ({
    label: c.name,
    leadCount: leads.filter(l => l.campaign_id === c.id).length,
    oppValue: opportunities.filter(o => o.campaign_id === c.id).reduce((s, o) => s + (o.value_num || 0), 0),
  }));
  return (
    <ReportShell title="Campaign Performance" description="Leads generated and opportunity value attributed to each campaign.">
      <BarList items={rows.map(r => ({ label: r.label, value: r.oppValue }))} valueFmt={formatMoney} />
      <Table>
        <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Leads</TableHead><TableHead>Opportunity value</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableRow><TableCell colSpan={3} className="text-muted-foreground">No campaigns yet.</TableCell></TableRow> : rows.map(r => (
            <TableRow key={r.label}><TableCell className="font-medium">{r.label}</TableCell><TableCell className="tnum">{r.leadCount}</TableCell><TableCell className="tnum">{formatMoney(r.oppValue)}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

export function SalesPipelineReport({ opportunities, stages }) {
  const wonStages = new Set(stages.filter(s => s.is_won).map(s => s.name));
  const lostStages = new Set(stages.filter(s => s.is_lost).map(s => s.name));
  const stageValue = {}, stageCount = {};
  for (const o of opportunities) {
    stageValue[o.stage] = (stageValue[o.stage] || 0) + (o.value_num || 0);
    stageCount[o.stage] = (stageCount[o.stage] || 0) + 1;
  }
  const wonValue = opportunities.filter(o => wonStages.has(o.stage)).reduce((s, o) => s + (o.value_num || 0), 0);
  const wonN = opportunities.filter(o => wonStages.has(o.stage)).length;
  const lostN = opportunities.filter(o => lostStages.has(o.stage)).length;
  const winRate = (wonN + lostN) > 0 ? Math.round((wonN / (wonN + lostN)) * 100) : null;
  const items = Object.keys(stageCount).map(stage => ({ label: stage, value: stageValue[stage] }));
  const colorFor = i => wonStages.has(i.label) ? 'bg-success' : lostStages.has(i.label) ? 'bg-destructive' : 'bg-chart-1';

  return (
    <ReportShell title="Sales Pipeline" description="Open, won and lost opportunity value by stage.">
      <StatRow stats={[
        { label: 'Won value', value: formatMoney(wonValue) },
        { label: 'Win rate', value: winRate == null ? '—' : `${winRate}% (${wonN} won / ${lostN} lost)` },
      ]} />
      <BarList items={items} valueFmt={formatMoney} colorFor={colorFor} />
    </ReportShell>
  );
}

export function ByDepartmentReport({ leads, opportunities, stages }) {
  const depts = ['Sales', 'Marketing'];
  const wonStages = new Set(stages.filter(s => s.is_won).map(s => s.name));
  const lostStages = new Set(stages.filter(s => s.is_lost).map(s => s.name));
  const rows = depts.map(dept => {
    const deptLeads = leads.filter(l => l.owner_dept === dept);
    const deptOpps = opportunities.filter(o => o.owner_dept === dept);
    const deptWon = deptOpps.filter(o => wonStages.has(o.stage));
    const deptLost = deptOpps.filter(o => lostStages.has(o.stage));
    const deptOpen = deptOpps.filter(o => !wonStages.has(o.stage) && !lostStages.has(o.stage));
    return {
      dept, leadCount: deptLeads.length,
      conversionRate: deptLeads.length > 0 ? Math.round((deptLeads.filter(l => l.status === 'converted').length / deptLeads.length) * 100) : null,
      openValue: deptOpen.reduce((s, o) => s + (o.value_num || 0), 0),
      wonValue: deptWon.reduce((s, o) => s + (o.value_num || 0), 0),
      winRate: (deptWon.length + deptLost.length) > 0 ? Math.round((deptWon.length / (deptWon.length + deptLost.length)) * 100) : null,
    };
  });
  return (
    <ReportShell title="By Department" description="The one shared pipeline, sliced by which department is driving it — not two separate funnels.">
      <BarList items={rows.map(r => ({ label: r.dept, value: r.openValue }))} valueFmt={formatMoney} />
      <Table>
        <TableHeader><TableRow><TableHead>Department</TableHead><TableHead>Leads</TableHead><TableHead>Conversion</TableHead><TableHead>Open pipeline</TableHead><TableHead>Won value</TableHead><TableHead>Win rate</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map(d => (
            <TableRow key={d.dept}>
              <TableCell className="font-medium">{d.dept}</TableCell>
              <TableCell className="tnum">{d.leadCount}</TableCell>
              <TableCell className="tnum">{d.conversionRate == null ? '—' : `${d.conversionRate}%`}</TableCell>
              <TableCell className="tnum">{formatMoney(d.openValue)}</TableCell>
              <TableCell className="tnum">{formatMoney(d.wonValue)}</TableCell>
              <TableCell className="tnum">{d.winRate == null ? '—' : `${d.winRate}%`}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// STERP "Sales Agent Performance" (SYSTEM.md §5e) — every metric here is real, per-agent data
// EXCEPT two, both flagged in the description and in the table's own column headers rather than
// silently presented as equivalent to the rest:
//  - Won value / lost reasons: `opportunities` has no per-agent owner column, only `created_by`
//    and department-level `owner_dept`. `created_by` is the closest real field, used as a labeled
//    approximation — it's who created the record, not necessarily who's been running the deal.
//  - Avg. response time: no first-contact timestamp exists anywhere. Approximated as the time from
//    `leads.created_at` to that lead's first `crm_notes` row (getLeadNotes()) — the earliest real
//    sign the lead was actually worked, not a defined SLA field.
export function AgentPerformanceReport({ leads, opportunities, tasks, notes, stages, users }) {
  const wonStages = new Set(stages.filter(s => s.is_won).map(s => s.name));
  const lostStages = new Set(stages.filter(s => s.is_lost).map(s => s.name));
  const displayName = { ...Object.fromEntries(users.map(u => [u.username, u.display_name || u.username])) };
  const nameFor = u => displayName[u] || u;

  const firstNoteByLead = {};
  for (const n of notes) if (!firstNoteByLead[n.lead_id]) firstNoteByLead[n.lead_id] = n; // notes arrive pre-sorted by created_at

  const agents = [...new Set([
    ...leads.map(l => l.assigned_to),
    ...tasks.map(t => t.assigned_to),
    ...opportunities.map(o => o.created_by),
  ].filter(Boolean))];

  const rows = agents.map(agent => {
    const agentLeads = leads.filter(l => l.assigned_to === agent);
    const converted = agentLeads.filter(l => l.status === 'converted').length;
    const agentTasks = tasks.filter(t => t.assigned_to === agent);
    const tasksDone = agentTasks.filter(t => t.status === 'done').length;
    const agentOpps = opportunities.filter(o => o.created_by === agent);
    const won = agentOpps.filter(o => wonStages.has(o.stage));
    const lost = agentOpps.filter(o => lostStages.has(o.stage));
    const responseHours = agentLeads
      .map(l => firstNoteByLead[l.id])
      .filter(Boolean)
      .map(n => (new Date(n.created_at).getTime() - new Date(agentLeads.find(l => l.id === n.lead_id).created_at).getTime()) / 36e5)
      .filter(h => h >= 0);
    return {
      agent, name: nameFor(agent),
      leadCount: agentLeads.length,
      conversionRate: agentLeads.length ? Math.round((converted / agentLeads.length) * 100) : null,
      taskCount: agentTasks.length,
      followUpRate: agentTasks.length ? Math.round((tasksDone / agentTasks.length) * 100) : null,
      wonValue: won.reduce((s, o) => s + (o.value_num || 0), 0),
      topLostReason: mostCommon(lost.map(o => o.lost_reason)),
      avgResponseHours: responseHours.length ? Math.round(responseHours.reduce((a, b) => a + b, 0) / responseHours.length) : null,
    };
  }).sort((a, b) => b.wonValue - a.wonValue || b.leadCount - a.leadCount);

  const ratedConversion = rows.filter(r => r.conversionRate != null);
  const avgConversion = ratedConversion.length ? Math.round(ratedConversion.reduce((s, r) => s + r.conversionRate, 0) / ratedConversion.length) : null;
  const ratedResponse = rows.filter(r => r.avgResponseHours != null);
  const avgResponse = ratedResponse.length ? Math.round(ratedResponse.reduce((s, r) => s + r.avgResponseHours, 0) / ratedResponse.length) : null;
  const topByWon = rows.filter(r => r.wonValue > 0).slice(0, 8).map(r => ({ label: r.name, value: r.wonValue }));

  return (
    <ReportShell title="Agent Performance"
      description="Leads assigned, follow-up completion, and pipeline outcomes per Sales agent. Won value and response time are labeled approximations — see the column notes below.">
      <StatRow stats={[
        { label: 'Agents tracked', value: rows.length },
        { label: 'Avg conversion rate', value: avgConversion == null ? '—' : `${avgConversion}%` },
        { label: 'Avg response time (approx.)', value: avgResponse == null ? '—' : `${avgResponse}h` },
      ]} />
      {topByWon.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Top agents by won value (attributed by opportunity creator)</h3>
          <BarList items={topByWon} valueFmt={formatMoney} />
        </div>
      )}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No leads, opportunities, or tasks are assigned to anyone yet.</p> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead><TableHead>Leads</TableHead><TableHead>Conversion</TableHead>
              <TableHead>Follow-ups done</TableHead><TableHead>Won value*</TableHead>
              <TableHead>Response time*</TableHead><TableHead>Top lost reason*</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.agent}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="tnum">{r.leadCount}</TableCell>
                <TableCell className="tnum">{r.conversionRate == null ? '—' : `${r.conversionRate}%`}</TableCell>
                <TableCell className="tnum">{r.taskCount ? `${r.followUpRate}% (${r.taskCount})` : '—'}</TableCell>
                <TableCell className="tnum">{formatMoney(r.wonValue)}</TableCell>
                <TableCell className="tnum">{r.avgResponseHours == null ? '—' : `${r.avgResponseHours}h`}</TableCell>
                <TableCell className="text-muted-foreground">{r.topLostReason || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        * Won value and Top lost reason are attributed by who created the opportunity — Opportunities has no dedicated per-agent owner field.
        Response time is the gap to a lead's first logged note, not a real first-contact timestamp.
      </p>
    </ReportShell>
  );
}
