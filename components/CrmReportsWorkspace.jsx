'use client';

// components/CrmReportsWorkspace.jsx — CRM Reports, pulled out of the Sales sidebar into its own
// top-level tab (V3_CHANGES.md §18). Same sidebar-workspace pattern as SalesWorkspace.jsx/
// CalcWorkspace.jsx, grouped into Sales/Marketing sections instead of a flat list. Charts follow
// the app's own existing bar idiom (BomProgress.jsx: thin rounded rows on bg-muted, semantic
// tokens) rather than inventing a new chart kit — magnitude bars get one hue (chart-1), Won/Lost/
// Converted rows get the reserved status tokens (success/destructive), never both on one row.
// "Download PDF" is the browser's native print-to-PDF against a scoped print stylesheet
// (app/globals.css) — no charting/PDF dependency added.
import { useState } from 'react';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart3Icon, TrendingUpIcon, UsersIcon, MegaphoneIcon, DownloadIcon, PieChartIcon } from 'lucide-react';
import { formatMoney } from '@/lib/format';

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

// One hue for magnitude (dataviz skill: sequential = one hue), reserved status tokens only when
// the row itself is a status (Won/Lost/Converted) — never mixed on the same chart.
function BarList({ items, valueFmt = String, colorFor = () => 'bg-chart-1' }) {
  const max = Math.max(1, ...items.map(i => i.value));
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {items.map(i => (
        <div key={i.label} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 truncate text-muted-foreground" title={i.label}>{i.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${colorFor(i)}`} style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
          <span className="w-20 shrink-0 text-right tnum text-xs text-muted-foreground">{valueFmt(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

function StatRow({ stats }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {stats.map(s => (
        <div key={s.label}>
          <span className="text-muted-foreground">{s.label}: </span>
          <span className={`font-semibold tnum ${s.warn ? 'text-destructive' : ''}`}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

function ReportShell({ title, description, children }) {
  return (
    <Card id="report-print-area">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Button size="sm" variant="outline" onClick={() => window.print()}><DownloadIcon />Download PDF</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

function LeadFunnelReport({ leads }) {
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

function LeadsBySourceReport({ leads }) {
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

function CampaignPerformanceReport({ leads, opportunities, campaigns }) {
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

function SalesPipelineReport({ opportunities, stages }) {
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

function ByDepartmentReport({ leads, opportunities, stages }) {
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

const REPORTS = [
  { key: 'sales_pipeline', label: 'Sales Pipeline', icon: TrendingUpIcon, group: 'Sales' },
  { key: 'by_department', label: 'By Department', icon: PieChartIcon, group: 'Sales' },
  { key: 'lead_funnel', label: 'Lead Funnel', icon: UsersIcon, group: 'Marketing' },
  { key: 'leads_by_source', label: 'Leads by Source', icon: BarChart3Icon, group: 'Marketing' },
  { key: 'campaign_performance', label: 'Campaign Performance', icon: MegaphoneIcon, group: 'Marketing' },
];
const GROUPS = ['Sales', 'Marketing'];

export default function CrmReportsWorkspace({ leads, opportunities, campaigns, stages, departments = ['Sales', 'Marketing'] }) {
  const items = REPORTS.filter(r => departments.includes(r.group));
  const [report, setReport] = useState(items[0]?.key);
  const active = items.find(r => r.key === report) || items[0];

  const reportGroups = GROUPS.filter(g => departments.includes(g)).map(group => ({
    label: group,
    items: items.filter(r => r.group === group),
  }));

  return (
    <WorkspaceSidebar
      title="Reports"
      icon={BarChart3Icon}
      groups={reportGroups}
      activeKey={report}
      onChange={setReport}
      header={
        <>
          {active && <active.icon className="size-4 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">{active?.label}</h1>
            <Badge variant="outline" className="mt-0.5">{active?.group}</Badge>
          </div>
        </>
      }
    >
      {active?.key === 'lead_funnel' && <LeadFunnelReport leads={leads} />}
      {active?.key === 'leads_by_source' && <LeadsBySourceReport leads={leads} />}
      {active?.key === 'campaign_performance' && <CampaignPerformanceReport leads={leads} opportunities={opportunities} campaigns={campaigns} />}
      {active?.key === 'sales_pipeline' && <SalesPipelineReport opportunities={opportunities} stages={stages} />}
      {active?.key === 'by_department' && <ByDepartmentReport leads={leads} opportunities={opportunities} stages={stages} />}
    </WorkspaceSidebar>
  );
}
