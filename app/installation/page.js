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
  const [projects, serviceCalls, serviceContracts, installationMilestones] = await Promise.all([
    getActiveProjectsList(),
    getServiceCalls(),
    getServiceContracts(),
    getInstallationMilestones(),
  ]);

  return <InstallationWorkspace projects={projects} serviceCalls={serviceCalls} serviceContracts={serviceContracts}
    installationMilestones={installationMilestones} initialTab={sp?.tab} />;
}
