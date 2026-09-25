// app/pipeline/page.js — V3_CHANGES.md A4. Sales+Marketing's shared opportunity pipeline, same
// "gated to whichever of N departments the viewer holds" shape as app/pr/page.js.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, headDepartments, isPM, roleHome } from '@/lib/auth';
import { getOpportunities, getCustomers, getSalesStages, getFunctionalHeads } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import PipelineWorkspace from '@/components/PipelineWorkspace';

export const dynamic = 'force-dynamic';

// Sales CRM plan 1b: Sales works its deals on the enquiry Board now, so this page is Marketing's
// own opportunity pipeline only (Marketing-owned rows). A Sales-only user is sent to the Board.
const PIPELINE_DEPARTMENTS = ['Marketing'];

export default async function PipelinePage() {
  const user = await getFreshSessionUser();
  if (!PIPELINE_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    if (canAccessDepartment(user, 'Sales')) redirect('/sales?tab=leads&view=board');
    redirect(roleHome(user));
  }

  const departments = isPM(user) ? PIPELINE_DEPARTMENTS : headDepartments(user).filter(d => PIPELINE_DEPARTMENTS.includes(d));
  const [allOpportunities, customers, stages, heads] = await Promise.all([
    getOpportunities(), [], getSalesStages(), getFunctionalHeads(),
  ]);
  const opportunities = allOpportunities.filter(o => o.owner_dept === 'Marketing');
  const crmUsers = heads.filter(h => h.active && h.departments.some(d => PIPELINE_DEPARTMENTS.includes(d)));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Pipeline" description="Marketing opportunities. Sales deals live on the Leads board in Sales." />
      <PipelineWorkspace opportunities={opportunities} departments={departments} customers={customers} stages={stages} users={crmUsers} />
    </main>
  );
}
