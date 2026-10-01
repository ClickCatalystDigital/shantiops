// Planning (Production only): Material Plan, Schedule, Capacity, Cut, Backlog. Stores uses its Demand tab; Procurement has no Planning tab.
// Thin server shell; see components/PlanningWorkspace.jsx.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getInventoryItems, getActiveProjectsList } from '@/lib/data';
import PlanningWorkspace from '@/components/PlanningWorkspace';

export const dynamic = 'force-dynamic';

export default async function PlanningPage({ searchParams }) {
  const user = await getFreshSessionUser();
  const isProduction = canAccessDepartment(user, 'Production');
  if (!isProduction) redirect(roleHome(user));

  const [inventoryItems, projects] = await Promise.all([
    isProduction ? getInventoryItems() : [],
    isProduction ? getActiveProjectsList({ includeChildren: true }) : [],
  ]);
  const fromDept = 'Production';

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <PlanningWorkspace inventoryItems={inventoryItems} projects={projects.map(p => ({ id: p.id, project_no: p.project_no }))} isProduction={isProduction}
        fromDept={fromDept} initialTab={searchParams?.tab} initialProject={searchParams?.project || ''} />
    </main>
  );
}
