// Production's Planning module — a Backlog tab (durable notes, no DB table) plus a real Cut tab.
// See components/PlanningWorkspace.jsx for the actual content; this stays a thin server shell,
// same shape as app/production/workers/page.js -> components/WorkersPanel.jsx.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getInventoryItems } from '@/lib/data';
import PlanningWorkspace from '@/components/PlanningWorkspace';

export const dynamic = 'force-dynamic';

export default async function PlanningPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Production')) redirect(roleHome(user));

  const inventoryItems = await getInventoryItems();

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <PlanningWorkspace inventoryItems={inventoryItems} />
    </main>
  );
}
