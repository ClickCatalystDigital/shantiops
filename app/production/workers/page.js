import { redirect } from 'next/navigation';
import { getFreshSessionUser, inDepartment, roleHome } from '@/lib/auth';
import {
  getWorkerSheet, getWorkers, getProductionMilestoneOptions, getTrades,
  getJobCards, getOperations, getWorkstations,
} from '@/lib/data';
import { todayISO } from '@/lib/date';
import WorkersPanel from '@/components/WorkersPanel';

export const dynamic = 'force-dynamic';

export default async function ProductionWorkersPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!inDepartment(user, 'Production')) redirect(roleHome(user));

  // Validate before this reaches a SQL bound param.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams?.date || '') ? searchParams.date : todayISO();

  const [sheet, workers, projects, trades, jobCards, operations, workstations] = await Promise.all([
    getWorkerSheet(date),
    getWorkers(),
    getProductionMilestoneOptions(),
    getTrades(),
    getJobCards(),
    getOperations(),
    getWorkstations(),
  ]);

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <WorkersPanel date={date} sheet={sheet} workers={workers} projects={projects} trades={trades}
        jobCards={jobCards} operations={operations} workstations={workstations} />
    </main>
  );
}
