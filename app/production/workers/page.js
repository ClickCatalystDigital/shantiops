import { redirect } from 'next/navigation';
import { getSessionUser, inDepartment, roleHome } from '@/lib/auth';
import { getWorkerSheet, getWorkers, getProductionMilestoneOptions } from '@/lib/data';
import { todayISO } from '@/lib/date';
import PageHeader from '@/components/PageHeader';
import WorkersPanel from '@/components/WorkersPanel';

export const dynamic = 'force-dynamic';

export default async function ProductionWorkersPage({ searchParams }) {
  const user = getSessionUser();
  if (!inDepartment(user, 'Production')) redirect(roleHome(user));

  // Validate before this reaches a SQL bound param.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams?.date || '') ? searchParams.date : todayISO();

  const [sheet, workers, projects] = await Promise.all([
    getWorkerSheet(date),
    getWorkers(),
    getProductionMilestoneOptions(),
  ]);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Workers" description="Daily attendance and work for the shop floor" />
      <WorkersPanel date={date} sheet={sheet} workers={workers} projects={projects} />
    </main>
  );
}
