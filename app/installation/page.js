// Installation workspace — Visits + Documentation. (The old Service Calls / Contracts / Reports tabs are
// hidden for now; their tables and routes are untouched.)
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getActiveProjectsList, getFunctionalHeads } from '@/lib/data';
import InstallationWorkspace from '@/components/InstallationWorkspace';

export const dynamic = 'force-dynamic';

export default async function InstallationPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Installation')) redirect(roleHome(user));

  const sp = await searchParams;
  // includeChildren: a visit/report is about one physical unit, not the master order (same reasoning as app/qc/page.js).
  const [projects, heads] = await Promise.all([getActiveProjectsList({ includeChildren: true }), getFunctionalHeads()]);
  // "Who visited" pool — every active user who holds Installation.
  const team = heads.filter(h => h.active && h.departments.includes('Installation')).map(h => ({ username: h.username, display_name: h.display_name }));

  return <InstallationWorkspace projects={projects} team={team} initialTab={sp?.tab} />;
}
