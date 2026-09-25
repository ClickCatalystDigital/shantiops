// app/dispatch/page.js — Dispatch's own dedicated workspace, same gating shape as /procurement,
// /stores, /qc. No PageHeader/<main> — DispatchWorkspace's own WorkspaceSidebar owns the full-page
// layout, same rule app/stores/page.js and app/qc/page.js already follow.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getPackingLists, getPendingPackingItems, getDispatchFlowCounts, getDispatchApprovalQueue, getGatePasses } from '@/lib/data';
import DispatchWorkspace from '@/components/DispatchWorkspace';
import { getSelectedCompanyFor } from '@/lib/company-filter-server';
import { filterByCompany } from '@/lib/company-filter.mjs';

export const dynamic = 'force-dynamic';

export default async function DispatchPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Dispatch')) redirect(roleHome(user));

  let [lists, pendingItems, flowCounts, approvalQueue, gatePasses] = await Promise.all([
    getPackingLists(), getPendingPackingItems(), getDispatchFlowCounts(),
    // Inward + Pre-Dispatch QC/Production Approval Workflow — Dispatch's own Approvals tab
    // (superseded the shared /material-review route).
    getDispatchApprovalQueue(),
    // Stores IA redesign — Gate Passes moved here from Stores.
    getGatePasses(),
  ]);

  // Global company selector: packing lists / pending lines / approvals follow their project's company.
  // Gate passes and the flow counts stay all-company (no project link to derive one from).
  const company = getSelectedCompanyFor(user);
  [lists, pendingItems, approvalQueue] = [lists, pendingItems, approvalQueue].map(r => filterByCompany(r, company));

  const sp = await searchParams;
  return <DispatchWorkspace lists={lists} pendingItems={pendingItems} flowCounts={flowCounts}
    approvalQueue={approvalQueue} gatePasses={gatePasses} initialTab={sp?.tab} />;
}
