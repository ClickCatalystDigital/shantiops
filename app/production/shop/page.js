import { redirect } from 'next/navigation';
import { getFreshSessionUser, inDepartment, isDepartmentHead, roleHome } from '@/lib/auth';
import {
  getWorkerSheet, getWorkers, getProductionMilestoneOptions, getTrades,
  getOperations, getWorkstations, getPendingPreDispatchApprovals,
} from '@/lib/data';
import { todayISO } from '@/lib/date';
import WorkersPanel from '@/components/WorkersPanel';

export const dynamic = 'force-dynamic';

export default async function ProductionWorkersPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!inDepartment(user, 'Production')) redirect(roleHome(user));

  // Validate before this reaches a SQL bound param.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams?.date || '') ? searchParams.date : todayISO();

  const [sheet, workers, projects, trades, operations, workstations, preDispatchApprovals] = await Promise.all([
    getWorkerSheet(date),
    getWorkers(),
    getProductionMilestoneOptions(),
    getTrades(),
    getOperations(),
    getWorkstations(),
    // Inward + Pre-Dispatch QC/Production Approval Workflow — Production's own department-local
    // Approvals tab (superseded the shared /material-review route).
    getPendingPreDispatchApprovals(),
  ]);

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <WorkersPanel date={date} sheet={sheet} workers={workers} projects={projects} trades={trades}
        operations={operations} workstations={workstations}
        preDispatchApprovals={preDispatchApprovals} canDecideProduction={isDepartmentHead(user, 'Production')} />
    </main>
  );
}
