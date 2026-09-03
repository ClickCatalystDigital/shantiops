// Engineering's own cross-project workspace (STERP items 16-19, SYSTEM.md §5o) — BOM Structure
// (multi-level assemblies + roll-up), Where-Used, Common/Uncommon, and Engineering Change Notes.
// Same shape as app/installation/page.js. Per-project BOM *editing* stays on the project page
// (Engineering's BomPanel) — this workspace is the cross-project oversight/reporting surface.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome, isPM, headDepartments } from '@/lib/auth';
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

  // Requests' three tabs (Purchase Requests/Release BOM/PR Templates) are now also reachable from
  // this workspace's own sidebar (RaisePrTab/ReleaseBomTab, imported from PrWorkspace.jsx) — same
  // three departments app/pr/page.js's own PR_DEPARTMENTS filters against, kept as a literal here
  // rather than a shared import (page.js files stay to their own default export + config exports by
  // convention in this codebase). Must be the full three, not just Design/Engineering: this
  // codebase already anticipates a head holding Stores alongside Design/Engineering
  // (PrWorkspace.jsx's own showBomTemplatesHere check exists for exactly that combination), and a
  // PM gets the full three on /pr today — narrowing it here would make the same login see different
  // editable BOM fields / a different source-selector depending on which page they used.
  const departments = isPM(user)
    ? ['Engineering', 'Design', 'Stores']
    : headDepartments(user).filter(d => ['Engineering', 'Design', 'Stores'].includes(d));

  return <EngineeringWorkspace projects={projects} changeNotes={changeNotes} partUsage={partUsage}
    canApproveEcn={canApproveEcn} initialTab={sp?.tab} departments={departments} />;
}
