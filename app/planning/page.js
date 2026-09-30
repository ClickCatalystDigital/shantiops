// Planning: Material Plan (Production + Stores + Procurement), plus Cut and Backlog (Production only).
// Thin server shell; see components/PlanningWorkspace.jsx.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { canPerformAction } from '@/lib/action-permissions';
import { getInventoryItems, getActiveProjectsList } from '@/lib/data';
import PlanningWorkspace from '@/components/PlanningWorkspace';

export const dynamic = 'force-dynamic';

export default async function PlanningPage({ searchParams }) {
  const user = await getFreshSessionUser();
  const isProduction = canAccessDepartment(user, 'Production');
  const inStores = canAccessDepartment(user, 'Stores');
  const inProcurement = canAccessDepartment(user, 'Procurement');
  if (!isProduction && !inStores && !inProcurement) redirect(roleHome(user));

  const [inventoryItems, projects, canReserve, canProcure] = await Promise.all([
    isProduction ? getInventoryItems() : [],
    isProduction ? getActiveProjectsList({ includeChildren: true }) : [],
    inStores ? canPerformAction(user, 'Stores', 'stores.reservation.reserve') : false,
    inStores ? canPerformAction(user, 'Stores', 'stores.procure') : false,
  ]);
  const fromDept = isProduction ? 'Production' : inStores ? 'Stores' : 'Procurement';

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <PlanningWorkspace inventoryItems={inventoryItems} projects={projects.map(p => ({ id: p.id, project_no: p.project_no }))} isProduction={isProduction} canReserve={canReserve}
        canProcure={canProcure} fromDept={fromDept} initialTab={searchParams?.tab} initialProject={searchParams?.project || ''} />
    </main>
  );
}
