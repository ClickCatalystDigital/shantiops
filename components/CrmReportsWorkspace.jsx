'use client';

// components/CrmReportsWorkspace.jsx — CRM Reports' original standalone tab (V3_CHANGES.md §18).
// Superseded as the primary access path by the Report Engine merge (SYSTEM.md §5an, 2026-08-23) —
// components/Nav.jsx no longer links here, every one of these 6 reports is now also a first-class
// catalog entry (lib/reports/catalog.js) reachable from the unified "Reports" tab. Kept as a
// compatibility route (/crm-reports still works if bookmarked) rendering the exact same panel
// components from components/CrmReportPanels.jsx — never a second copy to drift out of sync.
import { useState } from 'react';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import { Badge } from '@/components/ui/badge';
import { BarChart3Icon, TrendingUpIcon, UsersIcon, MegaphoneIcon, PieChartIcon, UserRoundIcon } from 'lucide-react';
import {
  LeadFunnelReport, LeadsBySourceReport, CampaignPerformanceReport,
  SalesPipelineReport, ByDepartmentReport, AgentPerformanceReport,
} from '@/components/CrmReportPanels';

const REPORTS = [
  { key: 'sales_pipeline', label: 'Sales Pipeline', icon: TrendingUpIcon, group: 'Sales' },
  { key: 'by_department', label: 'By Department', icon: PieChartIcon, group: 'Sales' },
  { key: 'agent_performance', label: 'Agent Performance', icon: UserRoundIcon, group: 'Sales' },
  { key: 'lead_funnel', label: 'Lead Funnel', icon: UsersIcon, group: 'Marketing' },
  { key: 'leads_by_source', label: 'Leads by Source', icon: BarChart3Icon, group: 'Marketing' },
  { key: 'campaign_performance', label: 'Campaign Performance', icon: MegaphoneIcon, group: 'Marketing' },
];
const GROUPS = ['Sales', 'Marketing'];

export default function CrmReportsWorkspace({ leads, opportunities, campaigns, stages, tasks = [], notes = [], users = [], departments = ['Sales', 'Marketing'] }) {
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
      {active?.key === 'agent_performance' && <AgentPerformanceReport leads={leads} opportunities={opportunities} tasks={tasks} notes={notes} stages={stages} users={users} />}
    </WorkspaceSidebar>
  );
}
