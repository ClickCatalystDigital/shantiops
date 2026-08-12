// app/pipeline/page.js — V3_CHANGES.md A4. Sales+Marketing's shared opportunity pipeline, same
// "gated to whichever of N departments the viewer holds" shape as app/pr/page.js.
import { redirect } from 'next/navigation';
import { getSessionUser, canAccessDepartment, headDepartments, isPM, roleHome } from '@/lib/auth';
import { getOpportunities, getCustomers, getSalesStages, getFunctionalHeads } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import PipelineWorkspace from '@/components/PipelineWorkspace';

export const dynamic = 'force-dynamic';

const PIPELINE_DEPARTMENTS = ['Sales', 'Marketing'];

export default async function PipelinePage() {
  const user = getSessionUser();
  if (!PIPELINE_DEPARTMENTS.some(d => canAccessDepartment(user, d))) redirect(roleHome(user));

  const departments = isPM(user) ? PIPELINE_DEPARTMENTS : headDepartments(user).filter(d => PIPELINE_DEPARTMENTS.includes(d));
  const [opportunities, customers, stages, heads] = await Promise.all([
    getOpportunities(), getCustomers(), getSalesStages(), getFunctionalHeads(),
  ]);
  const crmUsers = heads.filter(h => h.active && h.departments.some(d => PIPELINE_DEPARTMENTS.includes(d)));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Pipeline" description="Sales + Marketing — leads through won/lost, shared by both departments" />
      <PipelineWorkspace opportunities={opportunities} departments={departments} customers={customers} stages={stages} users={crmUsers} />
    </main>
  );
}
