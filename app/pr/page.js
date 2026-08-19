// app/pr/page.js — Group 5 Bundle A. Shared "Requests" surface for Engineering/Design/Stores to
// raise a PR (bundle items + project ids + qty split); materializes straight to Enquiry, no
// acceptance gate. One page, gated to whichever of the three departments the viewer holds — not
// three separate builds.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, headDepartments, isPM, roleHome } from '@/lib/auth';
import { getActiveProjectsList, getInventoryItems } from '@/lib/data';
import PrWorkspace from '@/components/PrWorkspace';

export const dynamic = 'force-dynamic';

const PR_DEPARTMENTS = ['Engineering', 'Design', 'Stores'];

export default async function PrPage() {
  const user = await getFreshSessionUser();
  if (!PR_DEPARTMENTS.some(d => canAccessDepartment(user, d))) redirect(roleHome(user));

  const departments = isPM(user) ? PR_DEPARTMENTS : headDepartments(user).filter(d => PR_DEPARTMENTS.includes(d));
  // inventoryItems only matters for Stores' stock source (Phase 6.4) — small table, cheap to fetch
  // regardless of whether Stores is among this viewer's departments.
  const [projects, inventoryItems] = await Promise.all([
    getActiveProjectsList(), getInventoryItems(),
  ]);

  // No PageHeader/<main container> here — PrWorkspace owns the full sidebar layout itself (its
  // own WorkspaceSidebar header already renders the "Requests" title), same rule every other
  // WorkspaceSidebar-based page follows (app/stores/page.js, app/qc/page.js, ...). This page
  // carried the old pre-sidebar-redesign PageHeader forward by mistake, same bug already fixed on
  // Stores — it rendered behind/above the fixed sidebar instead of in a real header row.
  return <PrWorkspace departments={departments} projects={projects} inventoryItems={inventoryItems} />;
}
