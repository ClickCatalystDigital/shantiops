// app/pr/page.js — Group 5 Bundle A. Shared "Requests" surface for Engineering/Design/Stores to
// raise a PR (bundle items + project ids + qty split); materializes straight to Enquiry, no
// acceptance gate. One page, gated to whichever of the three departments the viewer holds — not
// three separate builds.
import { redirect } from 'next/navigation';
import { getSessionUser, canAccessDepartment, headDepartments, isPM, roleHome } from '@/lib/auth';
import { getActiveProjectsList } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import PrWorkspace from '@/components/PrWorkspace';

export const dynamic = 'force-dynamic';

const PR_DEPARTMENTS = ['Engineering', 'Design', 'Stores'];

export default async function PrPage() {
  const user = getSessionUser();
  if (!PR_DEPARTMENTS.some(d => canAccessDepartment(user, d))) redirect(roleHome(user));

  const departments = isPM(user) ? PR_DEPARTMENTS : headDepartments(user).filter(d => PR_DEPARTMENTS.includes(d));
  const projects = await getActiveProjectsList();

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Requests" description="Raise a purchase requisition — it lands on Procurement's Enquiry tab immediately" />
      <PrWorkspace departments={departments} projects={projects} />
    </main>
  );
}
