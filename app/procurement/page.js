// Procurement's own cross-project workspace (§5a) — the daily workbench, distinct from
// ProcurementQueue.jsx (the per-project glance on the project page): sourcing, quotes, supplier
// selection and purchase orders all need to see across every active project at once, since the
// same material gets bought once for several boilers, not per project.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getSourcingItems, getSuppliers, getPurchaseOrders, getAllQuotes, getRfqSummaryByItem, getPurchaseReturns, getInventoryItems, getVendorBills, getPurchaseDebitNotes, getVendorTdsRates } from '@/lib/data';
import ProcurementWorkspace from '@/components/ProcurementWorkspace';

export const dynamic = 'force-dynamic';

export default async function ProcurementPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Procurement')) redirect(roleHome(user));

  const sp = await searchParams;
  const [sourcingItems, suppliers, purchaseOrders, quotes, rfqSummaryByItem, purchaseReturns, inventoryItems, vendorBills, debitNotes, tdsRates] = await Promise.all([
    getSourcingItems(),
    getSuppliers(),
    getPurchaseOrders(),
    getAllQuotes(),
    getRfqSummaryByItem(),
    getPurchaseReturns(),
    getInventoryItems(),
    getVendorBills(),
    getPurchaseDebitNotes(),
    getVendorTdsRates(),
  ]);

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <ProcurementWorkspace
        sourcingItems={sourcingItems}
        suppliers={suppliers}
        purchaseOrders={purchaseOrders}
        quotes={quotes}
        rfqSummaryByItem={rfqSummaryByItem}
        purchaseReturns={purchaseReturns}
        inventoryItems={inventoryItems}
        vendorBills={vendorBills}
        debitNotes={debitNotes}
        tdsRates={tdsRates}
        initialTab={sp?.tab}
      />
    </main>
  );
}
