// Requests tab (§4.0) — where Engineering/Design's asks land before they're Procurement's problem.
// Two modules: the acceptance inbox (new-item + cancel requests) and the split Tickets view (moved
// here from Operations, §2).
import { redirect } from 'next/navigation';
import { getSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import {
  getProcurementRequests, getDepartmentTasks, getBomItemsByIds, getItemQuotes, getBomItemPoInfo,
} from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import RequestsWorkspace from '@/components/RequestsWorkspace';

export const dynamic = 'force-dynamic';

export default async function RequestsPage() {
  const user = getSessionUser();
  if (!canAccessDepartment(user, 'Procurement')) redirect(roleHome(user));

  const [requests, tasks] = await Promise.all([
    getProcurementRequests('pending'),
    getDepartmentTasks('Procurement'),
  ]);
  // Cancel requests are tasks.bom_item_id-linked, open, aimed at Procurement — the existing flow
  // (§ Procurement cancel-request flow), just surfaced in this inbox instead of only the project-page
  // queue. Plain cross-department asks (no bom_item_id) are the two Raised-by/Raised-for feeds below.
  const cancelRequests = tasks.filter(t => t.bom_item_id && t.department === 'Procurement' && t.status === 'open');
  const raisedByProcurement = tasks.filter(t => t.from_department === 'Procurement' && !t.bom_item_id);
  const raisedForProcurement = tasks.filter(t => t.department === 'Procurement' && t.from_department && t.from_department !== 'Procurement' && !t.bom_item_id);

  // Full item context for the cancel-request detail overlay (§ Phase 4 point 6) — a `tasks` row
  // alone only carries the title/from_department, not the item's spec, selected supplier, quote
  // history, or PO info. Prefetched here (same "fetch server-side, pass as props" pattern as every
  // other page) rather than a new client-fetched route, since the set is small (open cancel-requests).
  const cancelItemIds = [...new Set(cancelRequests.map(t => t.bom_item_id))];
  const [cancelItems, quotesPerItem, poPerItem] = await Promise.all([
    getBomItemsByIds(cancelItemIds),
    Promise.all(cancelItemIds.map(id => getItemQuotes(id))),
    Promise.all(cancelItemIds.map(id => getBomItemPoInfo(id))),
  ]);
  const cancelItemById = Object.fromEntries(cancelItems.map(it => [it.id, it]));
  const cancelQuotesById = Object.fromEntries(cancelItemIds.map((id, i) => [id, quotesPerItem[i]]));
  const cancelPoById = Object.fromEntries(cancelItemIds.map((id, i) => [id, poPerItem[i]]));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Requests" description="New-item and cancel requests from other departments, plus what Procurement has raised or been asked" />
      <RequestsWorkspace
        requests={requests}
        cancelRequests={cancelRequests}
        cancelItemById={cancelItemById}
        cancelQuotesById={cancelQuotesById}
        cancelPoById={cancelPoById}
        raisedByProcurement={raisedByProcurement}
        raisedForProcurement={raisedForProcurement}
      />
    </main>
  );
}
