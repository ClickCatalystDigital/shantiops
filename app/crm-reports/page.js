// app/crm-reports/page.js — V3_CHANGES.md §18. Reports pulled out of the Sales sidebar into its
// own top-level tab, shared by Sales + Marketing, same gating shape as app/sales/page.js. No
// PageHeader/<main container> — CrmReportsWorkspace owns the full sidebar layout itself, same as
// SalesWorkspace/CalcWorkspace.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, headDepartments, isPM, roleHome } from '@/lib/auth';
import { getLeads, getOpportunities, getCampaigns, getSalesStages } from '@/lib/data';
import CrmReportsWorkspace from '@/components/CrmReportsWorkspace';

export const dynamic = 'force-dynamic';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export default async function CrmReportsPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Sales') && !canAccessDepartment(user, 'Marketing')) redirect(roleHome(user));

  const departments = isPM(user) ? CRM_DEPARTMENTS : headDepartments(user).filter(d => CRM_DEPARTMENTS.includes(d));
  const [leads, opportunities, campaigns, stages] = await Promise.all([
    getLeads(), getOpportunities(), getCampaigns(), getSalesStages(),
  ]);

  return <CrmReportsWorkspace leads={leads} opportunities={opportunities} campaigns={campaigns} stages={stages} departments={departments} />;
}
