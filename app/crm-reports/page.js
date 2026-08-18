// app/crm-reports/page.js — V3_CHANGES.md §18. Reports pulled out of the Sales sidebar into its
// own top-level tab, shared by Sales + Marketing, same gating shape as app/sales/page.js. No
// PageHeader/<main container> — CrmReportsWorkspace owns the full sidebar layout itself, same as
// SalesWorkspace/CalcWorkspace.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, headDepartments, isPM, roleHome } from '@/lib/auth';
import { getLeads, getOpportunities, getCampaigns, getSalesStages, getCrmTasks, getLeadNotes, getFunctionalHeads } from '@/lib/data';
import CrmReportsWorkspace from '@/components/CrmReportsWorkspace';

export const dynamic = 'force-dynamic';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export default async function CrmReportsPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Sales') && !canAccessDepartment(user, 'Marketing')) redirect(roleHome(user));

  const departments = isPM(user) ? CRM_DEPARTMENTS : headDepartments(user).filter(d => CRM_DEPARTMENTS.includes(d));
  // tasks/notes/heads feed the Agent Performance report only — same "fetch once, group
  // client-side" idiom every other report on this page already uses.
  const [leads, opportunities, campaigns, stages, tasks, notes, heads] = await Promise.all([
    getLeads(), getOpportunities(), getCampaigns(), getSalesStages(), getCrmTasks(), getLeadNotes(), getFunctionalHeads(),
  ]);
  const crmUsers = heads.filter(h => h.active && h.departments.some(d => CRM_DEPARTMENTS.includes(d)));

  return <CrmReportsWorkspace leads={leads} opportunities={opportunities} campaigns={campaigns} stages={stages}
    tasks={tasks} notes={notes} users={crmUsers} departments={departments} />;
}
