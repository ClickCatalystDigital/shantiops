// app/stores/page.js — V2-CHANGES.md Group 6 Phase 6.2/6.3. Stores' own cross-project inventory
// workbench, same gating mechanism as /procurement, /qc, /sales.
//
// No PageHeader/<main container> — StoresWorkspace owns the full sidebar layout itself (its own
// WorkspaceSidebar header already renders the "Inventory" title), same rule app/sales/page.js and
// app/qc/page.js already follow. This page carried the old pre-sidebar-redesign PageHeader forward
// by mistake — it rendered behind/above the fixed sidebar instead of in a real header row.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getInventoryItems, getOpenBomItems, getActiveReservations, getActiveProjectsList } from '@/lib/data';
import StoresWorkspace from '@/components/StoresWorkspace';

export const dynamic = 'force-dynamic';

export default async function StoresPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Stores')) redirect(roleHome(user));

  const [inventoryItems, openRequests, activeReservations, projects] = await Promise.all([
    getInventoryItems(), getOpenBomItems(), getActiveReservations(), getActiveProjectsList(),
  ]);

  return <StoresWorkspace inventoryItems={inventoryItems} openRequests={openRequests} activeReservations={activeReservations} projects={projects} />;
}
