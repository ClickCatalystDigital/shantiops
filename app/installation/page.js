// Installation workspace (STERP items 36/37/38) — department-gated top-level route, same shape as
// app/qc/page.js.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getActiveProjectsList, getServiceCalls, getServiceContracts, getInstallationMilestones } from '@/lib/data';
import InstallationWorkspace from '@/components/InstallationWorkspace';

export const dynamic = 'force-dynamic';

export default async function InstallationPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Installation')) redirect(roleHome(user));

  const sp = await searchParams;
  // Multi-unit split — a real, per-physical-unit gap found the same way QC's own exception was:
  // Service Calls/Contracts are inherently about one physical boiler ("unit #23 broke down"), not
  // the master order, so this picker needs children visible — same reasoning app/qc/page.js already
  // documents for its own includeChildren:true. Before this fix, the "Project / equipment" picker on
  // both the Service Call and Service Contract forms only ever offered the master project, so there
  // was no way to raise a service call against a specific one of 50 real units.
  const [projects, serviceCalls, serviceContracts, installationMilestones] = await Promise.all([
    getActiveProjectsList({ includeChildren: true }),
    getServiceCalls(),
    getServiceContracts(),
    getInstallationMilestones(),
  ]);

  return <InstallationWorkspace projects={projects} serviceCalls={serviceCalls} serviceContracts={serviceContracts}
    installationMilestones={installationMilestones} initialTab={sp?.tab} />;
}
