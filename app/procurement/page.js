// Procurement's own cross-project workspace (§5a) — the daily workbench, distinct from
// ProcurementQueue.jsx (the per-project glance on the project page): sourcing, quotes, supplier
// selection and purchase orders all need to see across every active project at once, since the
// same material gets bought once for several boilers, not per project.
import { redirect } from 'next/navigation';
import { getSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getSourcingItems, getSuppliers, getPurchaseOrders, getAllQuotes } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import ProcurementWorkspace from '@/components/ProcurementWorkspace';

export const dynamic = 'force-dynamic';

export default async function ProcurementPage() {
  const user = getSessionUser();
  if (!canAccessDepartment(user, 'Procurement')) redirect(roleHome(user));

  const [sourcingItems, suppliers, purchaseOrders, quotes] = await Promise.all([
    getSourcingItems(),
    getSuppliers(),
    getPurchaseOrders(),
    getAllQuotes(),
  ]);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Procurement" description="Sourcing, supplier quotes, and purchase orders — across every active project" />
      <ProcurementWorkspace
        sourcingItems={sourcingItems}
        suppliers={suppliers}
        purchaseOrders={purchaseOrders}
        quotes={quotes}
      />
    </main>
  );
}
