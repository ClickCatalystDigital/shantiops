// Installation's own Requests tab — the same PR workspace /pr uses, trimmed to Purchase Requests +
// History (PR + TR sub tabs), plus a Trade Request button (routes to Sales, not a PR).
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getActiveProjectsList } from '@/lib/data';
import PrWorkspace from '@/components/PrWorkspace';

export const dynamic = 'force-dynamic';

export default async function InstallationRequestsPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Installation')) redirect(roleHome(user));
  const projects = await getActiveProjectsList();
  return <PrWorkspace mode="installation" departments={['Installation']} projects={projects} />;
}
