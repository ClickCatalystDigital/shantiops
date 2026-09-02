// app/dispatch/page.js — Dispatch's own dedicated workspace, same gating shape as /procurement,
// /stores, /qc. Kanban only (DispatchBoard) — the flow diagram + incidents + running-projects
// summary moved to the unified Operations card (app/page.js), matching every other department.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import DispatchBoard from '@/components/DispatchBoard';
import PageHeader from '@/components/PageHeader';

export const dynamic = 'force-dynamic';

export default async function DispatchPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Dispatch')) redirect(roleHome(user));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Packing & Dispatch"
        description="Packing lists generated from each project's BOM — Pending → Ready → Dispatched." />
      <DispatchBoard />
    </main>
  );
}
