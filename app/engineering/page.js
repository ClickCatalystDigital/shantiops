// Engineering's own cross-project workspace (STERP items 16-19, SYSTEM.md §5o) — BOM Structure
// (multi-level assemblies + roll-up), Where-Used, Common/Uncommon, and Engineering Change Notes.
// Same shape as app/installation/page.js. Per-project BOM *editing* stays on the project page
// (Engineering's BomPanel) — this workspace is the cross-project oversight/reporting surface.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { canPerformAction } from '@/lib/action-permissions';
import { getActiveProjectsList, getEngineeringChangeNotes, getPartUsage } from '@/lib/data';
import EngineeringWorkspace from '@/components/EngineeringWorkspace';

export const dynamic = 'force-dynamic';

export default async function EngineeringPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) {
    redirect(roleHome(user));
  }

  const sp = await searchParams;
  const [projects, changeNotes, partUsage, canApproveEcn] = await Promise.all([
    getActiveProjectsList(),
    getEngineeringChangeNotes(),
    getPartUsage(),
    canPerformAction(user, 'Engineering', 'engineering.ecn.approve'),
  ]);

  return <EngineeringWorkspace projects={projects} changeNotes={changeNotes} partUsage={partUsage}
    canApproveEcn={canApproveEcn} initialTab={sp?.tab} />;
}
