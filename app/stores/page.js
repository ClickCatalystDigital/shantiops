// app/stores/page.js — V2-CHANGES.md Group 6 Phase 6.2/6.3. Stores' own cross-project inventory
// workbench, same gating mechanism as /procurement, /qc, /sales.
//
// No PageHeader/<main container> — StoresWorkspace owns the full sidebar layout itself (its own
// WorkspaceSidebar header already renders the "Inventory" title), same rule app/sales/page.js and
// app/qc/page.js already follow. This page carried the old pre-sidebar-redesign PageHeader forward
// by mistake — it rendered behind/above the fixed sidebar instead of in a real header row.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import {
  getInventoryItems, getOpenBomItems, getActiveReservations, getActiveProjectsList,
  getGateInwardReceipts, getTestCertificates, getSourcingItems,
  getSplitOrdersNeedingStoresAction, attachDeliveryLotDates, getPendingInwardApprovals,
  getUnroutedReceivedItems,
} from '@/lib/data';
import { attachCombinablePlateHints } from '@/lib/remnant-match';
import { packRows } from '@/lib/row-pack.mjs';
import StoresWorkspace from '@/components/StoresWorkspace';

export const dynamic = 'force-dynamic';

export default async function StoresPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Stores')) redirect(roleHome(user));

  // Only the open tab's large lists are sent (live: Inward's list 6 MB, open requests 4.4 MB). A tab
  // switch asks the server again (StoresWorkspace), so router.refresh() after a save reloads that tab.
  const sp = await searchParams;
  const tab = sp?.tab === 'reservations' ? 'allocate' : (sp?.tab || 'inventory');
  const needInward = tab === 'receive';
  const [inventoryItems, allOpen, activeReservations, projects, gateInwardReceipts, certificates, bomItems, splitOrders, pendingInwardApprovals, unroutedItems] = await Promise.all([
    getInventoryItems(), getOpenBomItems(), getActiveReservations(), getActiveProjectsList(),
    getGateInwardReceipts(), getTestCertificates(), needInward ? getSourcingItems() : [],
    getSplitOrdersNeedingStoresAction(), getPendingInwardApprovals(), getUnroutedReceivedItems(),
  ]);

  // Lot-aware expected-delivery dates for Receive a Delivery only — merged in after the shared
  // Promise.all so /procurement's own getSourcingItems() calls stay untouched (see attachDeliveryLotDates).
  if (needInward) await attachDeliveryLotDates(bomItems);
  // Trade Orders (source 'sas') need full rows; the Inventory tab only matches requests to an
  // item (AddPieceDialog), so it gets the few fields that needs.
  const tradeRequests = allOpen.filter(r => r.source === 'sas');
  // Manual-only "could these be combined?" hint for unmatched plate lines (OpenRequestsCard).
  await attachCombinablePlateHints(tradeRequests);
  const openRequests = tab === 'inventory'
    ? [...tradeRequests, ...allOpen.filter(r => r.source !== 'sas').map(r => ({ id: r.id, item_id: r.item_id, material_description: r.material_description, source: r.source, sale_order_no: r.sale_order_no, project_no: r.project_no }))]
    : tradeRequests;
  return <StoresWorkspace inventoryItems={inventoryItems} openRequests={openRequests} activeReservations={activeReservations}
    projects={projects} gateInwardReceipts={gateInwardReceipts}
    certificates={certificates} bomItems={packRows(bomItems)} splitOrders={splitOrders}
    pendingInwardApprovals={pendingInwardApprovals} unroutedItems={unroutedItems} initialTab={sp?.tab}
    loaded={{ inward: needInward, openRequests: tab === 'inventory' }} />;
}
