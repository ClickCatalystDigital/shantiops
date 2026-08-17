// app/stores/page.js — V2-CHANGES.md Group 6 Phase 6.2/6.3. Stores' own cross-project inventory
// workbench, same gating mechanism as /procurement, /qc, /sales.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getInventoryItems, getOpenBomItems, getActiveReservations, getActiveProjectsList } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import StoresWorkspace from '@/components/StoresWorkspace';

export const dynamic = 'force-dynamic';

export default async function StoresPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Stores')) redirect(roleHome(user));

  const [inventoryItems, openRequests, activeReservations, projects] = await Promise.all([
    getInventoryItems(), getOpenBomItems(), getActiveReservations(), getActiveProjectsList(),
  ]);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Inventory" description="On-hand stock — available nets out active reservations" />
      <StoresWorkspace inventoryItems={inventoryItems} openRequests={openRequests} activeReservations={activeReservations} projects={projects} />
    </main>
  );
}
