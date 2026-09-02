// app/dispatch/page.js — Dispatch's own dedicated workspace, same gating shape as /procurement,
// /stores, /qc. No PageHeader/<main> — DispatchWorkspace's own WorkspaceSidebar owns the full-page
// layout, same rule app/stores/page.js and app/qc/page.js already follow.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getPackingLists, getPendingPackingItems, getDispatchFlowCounts } from '@/lib/data';
import DispatchWorkspace from '@/components/DispatchWorkspace';

export const dynamic = 'force-dynamic';

export default async function DispatchPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Dispatch')) redirect(roleHome(user));

  const [lists, pendingItems, flowCounts] = await Promise.all([
    getPackingLists(), getPendingPackingItems(), getDispatchFlowCounts(),
  ]);

  const sp = await searchParams;
  return <DispatchWorkspace lists={lists} pendingItems={pendingItems} flowCounts={flowCounts} initialTab={sp?.tab} />;
}
