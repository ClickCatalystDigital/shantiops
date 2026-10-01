// Planning: Material Plan (Production + Procurement; Stores uses its Demand tab), plus Schedule, Capacity, Cut and Backlog (Production only).
// Thin server shell; see components/PlanningWorkspace.jsx.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getInventoryItems, getActiveProjectsList } from '@/lib/data';
import PlanningWorkspace from '@/components/PlanningWorkspace';

export const dynamic = 'force-dynamic';

export default async function PlanningPage({ searchParams }) {
  const user = await getFreshSessionUser();
  const isProduction = canAccessDepartment(user, 'Production');
  const inProcurement = canAccessDepartment(user, 'Procurement');
  if (!isProduction && !inProcurement) redirect(roleHome(user));

  const [inventoryItems, projects] = await Promise.all([
    isProduction ? getInventoryItems() : [],
    isProduction ? getActiveProjectsList({ includeChildren: true }) : [],
  ]);
  const fromDept = isProduction ? 'Production' : 'Procurement';

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <PlanningWorkspace inventoryItems={inventoryItems} projects={projects.map(p => ({ id: p.id, project_no: p.project_no }))} isProduction={isProduction}
        fromDept={fromDept} initialTab={searchParams?.tab} initialProject={searchParams?.project || ''} />
    </main>
  );
}
